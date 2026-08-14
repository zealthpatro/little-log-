/* The shared household record must survive two people using it.
 *
 * The household `app` blob is ONE Firestore field holding babies, medicines, vaccines, illnesses
 * and milestones. It was written as a whole-object replace from local state, which lost data two
 * ways, both silent, both with a success toast on every phone:
 *
 *   1. A device pushed before it had received the household snapshot, replacing the family's
 *      record with its own empty or stale copy. pushNow guarded only on hhRef existing.
 *   2. Two phones editing DIFFERENT areas clobbered each other anyway, because each wrote the
 *      whole field. Mother records a penicillin allergy; father's phone, which has not seen it,
 *      logs a milestone; the allergy is gone.
 *
 * This mirrors the push logic in app/store-firebase.js and drives both cases directly, then
 * asserts against the real source that the mirror has not drifted.
 *
 *   node test/blob-clobber.test.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

function stableStringify(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

/* A phone. Holds local state, a hydration flag and a baseline of what it believes the server has,
 * exactly as store-firebase.js does. */
function Phone(name) {
  return {
    name, state: null, hydrated: false, base: null, deferred: false,
    receive(serverApp) {                       // the household onSnapshot
      this.state = JSON.parse(JSON.stringify(serverApp));
      this.base = {}; Object.keys(this.state).forEach((k) => { this.base[k] = stableStringify(this.state[k]); });
      this.hydrated = true;
      if (this.deferred) { this.deferred = false; return this.push; }
    },
    edit(key, val) { if (!this.state) this.state = {}; this.state[key] = val; },
    // Returns the field-path update this phone would send, or null if it writes nothing.
    push(server) {
      if (!this.hydrated) { this.deferred = true; return null; }
      const upd = {}, dirty = [];
      Object.keys(this.state).forEach((k) => {
        const ser = stableStringify(this.state[k]);
        if (!this.base || this.base[k] !== ser) { upd['app.' + k] = this.state[k]; dirty.push([k, ser]); }
      });
      if (!dirty.length) return null;
      // Apply it the way Firestore applies field paths: only the named keys move.
      dirty.forEach(([k, ser]) => { server[k] = JSON.parse(JSON.stringify(this.state[k])); this.base[k] = ser; });
      return upd;
    },
  };
}

console.log('\n1. a phone that has not read the record cannot write it');
{
  const server = { babies: [{ id: 'b1', name: 'Robin' }], meds: [{ id: 'm1', name: 'Penicillin allergy' }], milestones: [] };
  const fresh = Phone('fresh');
  fresh.state = { babies: [], meds: [], milestones: [] };   // signed in, nothing loaded yet
  const wrote = fresh.push(server);
  ok('it writes nothing at all', wrote === null, wrote);
  ok('and the family record is untouched', server.meds.length === 1 && server.babies.length === 1, server);
  ok('the write is deferred, not dropped', fresh.deferred === true);

  fresh.receive(server);                                     // snapshot lands
  ok('after hydrating it holds what the server holds', fresh.state.meds[0].name === 'Penicillin allergy');
  ok('and a push now is a no-op, because nothing local changed', fresh.push(server) === null);
}

console.log('\n2. the exact case from the report: an offline phone comes back');
{
  const server = { babies: [{ id: 'b1', name: 'Robin' }], meds: [], vaccines: {}, milestones: [] };
  const mum = Phone('mum'), dad = Phone('dad');
  mum.receive(server); dad.receive(server);                  // both in sync

  dad.goesOffline = true;                                    // dad stops receiving snapshots here

  mum.edit('meds', [{ id: 'm1', name: 'Penicillin allergy' }]);
  mum.edit('vaccines', { b1: { mmr: 1 } });
  mum.push(server);
  ok('mum records an allergy and a vaccine', server.meds.length === 1 && !!server.vaccines.b1, server);

  // Dad's phone never saw either. Under the old whole-field write this push erased both.
  dad.edit('milestones', [{ id: 'x1', t: 'First smile' }]);
  const upd = dad.push(server);
  ok('dad writes ONLY the key he touched', Object.keys(upd).join(',') === 'app.milestones', Object.keys(upd));
  ok('the penicillin allergy survives', server.meds.length === 1 && server.meds[0].name === 'Penicillin allergy', server.meds);
  ok('the vaccine survives', !!(server.vaccines.b1 && server.vaccines.b1.mmr), server.vaccines);
  ok('and his milestone landed', server.milestones.length === 1, server.milestones);
}

console.log('\n3. a key this build has never heard of is left alone, not deleted');
{
  const server = { babies: [], meds: [], somethingNewer: { fromAFutureBuild: true } };
  const old = Phone('old');
  old.receive({ babies: [], meds: [] });                     // this build does not know the key
  old.edit('meds', [{ id: 'm2' }]);
  old.push(server);
  ok('the unknown key is still there', !!server.somethingNewer, server);
}

console.log('\n4. the same edit twice does not write twice');
{
  const server = { babies: [], meds: [] };
  const p = Phone('p'); p.receive(server);
  p.edit('meds', [{ id: 'm1' }]);
  ok('first push writes', p.push(server) !== null);
  ok('second push is a no-op', p.push(server) === null);
}

console.log('\n5. app/store-firebase.js really works this way');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');
  ok('a push before the first snapshot is refused', src.includes('if (!hhHydrated) { pushWhenHydrated = true; return; }'));
  ok('and is re-armed once the snapshot lands', src.includes('if (pushWhenHydrated) { pushWhenHydrated = false; scheduledPush(); }'));
  ok('the baseline is taken AFTER applying the remote blob', src.includes('blobBase = snapshotBlobBase();'));
  ok('the write uses app.<key> field paths, not a whole-field replace',
     src.includes("upd['app.' + k] = appBlob[k];"));
  ok('the old whole-blob replace is gone', !/update\(\{\s*app:\s*appBlob/.test(src));
  ok('the baseline only advances after the write RESOLVES',
     src.includes('if (blobBase) dirty.forEach(function (p) { blobBase[p[0]] = p[1]; });'));
  ok('nothing is written when nothing changed', src.includes('if (dirty.length) {'));
  ok('signing out clears hydration and the baseline',
     src.includes('hhHydrated = false; pushWhenHydrated = false; blobBase = null;'));
}

console.log('\n6. guardians are derived from the labels the app actually stores');
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const m = app.match(/const GUARDIAN_WORDS=\[([\s\S]*?)\];/);
  ok('GUARDIAN_WORDS exists', !!m);
  const words = m ? m[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)) : [];
  const isGuardianRel = (rel) => String(rel == null ? '' : rel).toLowerCase().split(/[^a-z]+/)
    .some((w) => w && words.indexOf(w) >= 0);

  // What the circle actually writes.
  ok('"Mama Bear" is a guardian', isGuardianRel('Mama Bear'));
  ok('"Papa Bear" is a guardian', isGuardianRel('Papa Bear'));
  ok('"Mummy" is a guardian', isGuardianRel('Mummy'));
  ok('"Amma" is a guardian', isGuardianRel('Amma'));
  // The false positives a substring match would have created.
  ok('"Nana Bear" is NOT', !isGuardianRel('Nana Bear'));
  ok('"Grandma Bear" is NOT', !isGuardianRel('Grandma Bear'));
  ok('"Grandmother" is NOT', !isGuardianRel('Grandmother'));
  ok('"Godmother" is NOT', !isGuardianRel('Godmother'));
  ok('"Uncle Bear" is NOT', !isGuardianRel('Uncle Bear'));
  ok('a custom role like "Ayah" is NOT', !isGuardianRel('Ayah'));
  ok('empty is NOT', !isGuardianRel('') && !isGuardianRel(null) && !isGuardianRel(undefined));
  // The bug itself: the old code compared the whole string.
  ok('the old whole-string compare is gone',
     !app.includes("const rels=['mother','mom','mama','father','dad','papa','parent','guardian'];"));
  ok('householdGuardians uses the word matcher', app.includes('parents=uids.filter(u=>isGuardianRel('));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'BLOB-CLOBBER: FAIL' : 'BLOB-CLOBBER: PASS');
process.exit(fail ? 1 : 0);
