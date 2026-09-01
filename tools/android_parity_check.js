/* Can the Android app actually do what the iOS app does, or does it merely BUILD?
 *
 *   node tools/android_parity_check.js [baseUrl]      default https://little-cubby.com
 *
 * WHY THIS EXISTS. android/app/build.gradle reads google-services.json inside a try, and when the file
 * is absent it catches the exception and calls logger.info, which is invisible at Gradle's default log
 * level. So a release build SUCCEEDS and ships an app whose Firebase sign-in and push are dead, and
 * nothing anywhere says so. That is the same shape as the four-day sign-in outage: not a miswired
 * alarm, no alarm, and a remedy that looks alive from outside.
 *
 * The app itself needs no porting. One web codebase is remote-loaded by both wrappers and only two
 * places in it branch per OS, so everything here is about the native shell and the store plumbing,
 * which is where a joint launch actually breaks.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = (process.argv[2] || 'https://little-cubby.com').replace(/\/$/, '');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
};
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; } };
const exists = (p) => fs.existsSync(path.join(ROOT, p));

(async () => {
  console.log('\nandroid parity: does it work, or does it only build\n');

  const pkg = JSON.parse(read('package.json') || '{}');
  const deps = Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies));
  const firebasePlugins = deps.filter((d) => /^@capacitor-firebase\//.test(d));
  const hasAndroid = deps.indexOf('@capacitor/android') >= 0;

  console.log('1. the silent one: Firebase plugins that need a config file nobody notices is missing');
  ok('the project ships the Android platform', hasAndroid);
  ok('and it declares @capacitor-firebase plugins, so sign-in and push depend on them',
     firebasePlugins.length > 0, firebasePlugins.join(', '));
  /* THE POINT OF THIS FILE. Not "is the file there" as a style rule, but: these plugins are declared,
     the Gradle apply is conditional and silent, so without the file the app builds and cannot sign in. */
  ok('google-services.json is present, or those plugins are dead in a build that still SUCCEEDS',
     !firebasePlugins.length || exists('android/app/google-services.json'),
     'android/app/google-services.json is missing while ' + firebasePlugins.join(' + ') +
     ' are declared. build.gradle applies the plugin inside a try/catch that logs at info level, so the\n'
     + '         release will build clean and ship with Firebase auth and push silently dead.');
  /* Paired, so the line above cannot pass by the plugins quietly disappearing from package.json. */
  ok('and the conditional-apply trap is still the one described above',
     /if\s*\(\s*servicesJSON\.text\s*\)/.test(read('android/app/build.gradle')),
     'build.gradle no longer guards google-services the way this gate assumes; re-read it');
  ok('iOS has its counterpart config, which is why iOS works today',
     exists('ios/App/App/GoogleService-Info.plist'));

  console.log('\n2. a release has to be signable, or there is nothing to upload');
  const gradle = read('android/app/build.gradle');
  ok('the release buildType names a signingConfig',
     /release\s*\{[^}]*signingConfig/s.test(gradle),
     'android/app/build.gradle release block has no signingConfig, so a release build is unsigned and\n'
     + '         Play will not take it. The upload keystore is the founder\'s to generate and to BACK UP:\n'
     + '         lose it and the listing can never be updated again.');

  console.log('\n3. deep links, which is where iOS already learned this lesson the hard way');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  ok('the manifest declares an autoVerify App Links intent filter',
     /autoVerify\s*=\s*"true"/.test(manifest),
     'no autoVerify intent-filter. A sign-in link or a /app/?go= deep link opens Chrome, not the app,\n'
     + '         which is the same class of failure as the installed-iOS storage container.');
  let assetlinks = 0;
  try {
    const r = await fetch(BASE + '/.well-known/assetlinks.json');
    assetlinks = r.status;
  } catch (e) { assetlinks = 0; }
  ok('and ' + BASE + '/.well-known/assetlinks.json is served', assetlinks === 200,
     'got ' + assetlinks + '. Android verifies App Links against this file, and it must carry the SHA-256\n'
     + '         fingerprint of the RELEASE signing key, so it cannot be written until the keystore exists.');
  ok('iOS serves its equivalent, so this is a gap and not a design choice',
     /apple-app-site-association/.test(read('worker.js')));

  console.log('\n4. versions, so the two stores cannot drift apart');
  ok('Android is not still on the Capacitor scaffold defaults',
     !(/versionCode\s+1\b/.test(gradle) && /versionName\s+"1\.0"/.test(gradle)),
     'versionCode 1 / versionName "1.0" are untouched scaffold values. iOS derives its version at build\n'
     + '         time in tools/cap_ios_build.sh (year.week.release); Android has no equivalent, so the two\n'
     + '         stores will not agree on what a release is called.');
  ok('there is an Android build script the way there is an iOS one',
     exists('tools/cap_android_build.sh'),
     'tools/cap_ios_build.sh exists and mentions android zero times. There is no scripted path to an AAB,\n'
     + '         so the first Play upload would be hand-driven, which is how the entitlements trap happened on iOS.');

  console.log('\n5. the part that is genuinely fine, asserted so a refactor is not invented');
  const cap = JSON.parse(read('capacitor.config.json') || '{}');
  ok('both platforms remote-load ONE web app, so there is no second codebase to port',
     !!(cap.server && cap.server.url), (cap.server || {}).url);
  ok('and the Worker already sends push via FCM, which serves both stores',
     /fcm\.googleapis/.test(read('worker.js')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ANDROID-PARITY: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})();
