# Changing the logo

Every Cubby logo (app icon, favicon, the site's top bar, sign-in card, emails, 1,245 share and promo
cards, the native app icon and splash) is made from ONE file, `icons/icon-master-1024.png`, dressed in ONE
frame, the `"frame"` in `tools/brand-images.json` (since 2026-11-15 the founder's "A + rim + light/shade": a
honey rim about 3% of the tile wide with a soft light across the top and shade across the bottom). Changing
the logo or its frame means `tools/brand.py set`, never copying a PNG over the master or editing the registry.

## To change the logo

```sh
python3 tools/brand.py compare a.png b.png c.png        # look and measure; opens nothing, prints the path
python3 tools/brand.py zoom b.png --subject-width 87 --out b87.png      # optional: make the face bigger
python3 tools/brand.py set b87.png --name "the honey teddy" --provenance "gpt-image-2 from the painted cub, founder's pick, 3 judges"
python3 tools/brand.py set b87.png --name "the honey teddy" --provenance "..." --yes
python3 tools/brand.py set icons/icon-master-1024.png --frame rim --yes   # the same master, another frame
```

Frames: `none`, `rim` (a rim of the tile's own shape), `rim-shade` (the rim, light over the top third and shade
over the bottom), `ring` (a thin cocoa ring). `--frame` starts from the style's preset in `tools/brand_style.py`;
without it set keeps the registry's frame.

Then review the proof it prints (`before-after.png`), run `node tools/gates.js`, commit the files it lists
in `touched.txt` beside the proof (the `git --literal-pathspecs commit` line it prints: it already holds the
pages whose logo URLs changed and the `app/sw.js` CACHE bump the pre-commit hook asks for), and push main
(push = deploy). That is the whole change.

**Need candidates first?** `python3 tools/brand.py propose --ref app/journey-art/ov_hero-cub.webp
--variants v.json --dry-run` shows the requests; without `--dry-run` it calls gpt-image-2 (paid, key in
`art-src/openai.key`) and compares what comes back. `v.json` is
`{"base": "App icon of this painted cub, face and ears only...", "variants": [{"name": "honey", "prompt": "light honey wash"}]}`.

## What each step does

- **compare** draws every candidate twice, as painted and framed (`--frame STYLE`, else the registry's frame,
  else rim-shade), and adds the **tile edge** against the site's cream and a dark ground both ways (the
  painted wash is nearly the page's own colour: 1.07:1 on the cream; the honey rim 2.17:1).
  It writes `sizes.png` (512 to 16px, light and dark), `homescreen.png` (60px among other apps,
  blue-grey and dark), `web.png` (the top bar beside the real Fraunces wordmark at 1x, 2x and 3x, and the
  favicon in a browser tab), `context-light.png` (white and the site's cream), `metrics.json` and
  `compare.html`. The current master is always the first column. Same inputs, same bytes.
  The numbers: **fur vs background** (WCAG contrast of the face's outer ring against the tile's edge colour;
  the retired white cub measures 1.3:1, W2+ 2.4:1), **edge energy** at 29 and 16px (visible detail at
  Settings-icon and favicon size), **subject width** (% of the tile), and how the maskable, Android round
  and adaptive icons will shrink it. "The generators can cut it" must say yes, or set refuses the file.
- **zoom** crops in, centred on the face, until it is that wide (the W2+ step), and refuses if an ear would
  come near an edge.
- **set** without `--yes` writes nothing: it checks the file (square, at least 1024px, RGB, no alpha), asks
  the generators whether they can cut the face from its ground, and lists what will change. With `--yes` it
  writes the master, regenerates the web icons (and the top bar's `logo-96.png` / `logo-192.png`), the
  native set into `native-build/brand-native/` (gitignored), every card's logo, re-pins
  `tools/brand-images.json` (the master, the frame and `url_version`), moves the old master (or, for a new
  frame alone, the old frame's icons and cards) into a **retired** set (so its bytes can never come back
  unnoticed), puts `?v=<url_version>` on every reference to a file made from the master and bumps
  `app/sw.js`'s CACHE, runs the brand gate, `card_logo.py --check` and `gen_brand_icons.py --check`, and
  draws the proof.
- **The frame** goes on every tile: the logo PNGs, the favicon, the apple-touch and manifest icons, the iOS
  AppIcon set (along the iOS corner, the square's corners rim too, so the system's mask never leaves a
  double edge), the legacy Android square, `cap-web/logo.png` and every card's logo. Never on the maskable
  icon, the Android adaptive or round icon (the launcher cuts those to its own shape) or the splash (the
  face alone on cream), and never below 32px (at 16px a 3% rim is half a pixel of noise).
  `favicon.png` is one 48px file, framed: a 2x tab draws it at 32px, but a 1x tab (a desktop at 100%)
  scales it to 16px itself, where the rim shows as a faint warm edge. A separate unframed 16px favicon would
  need a second `<link rel="icon" sizes="16x16">` on every page: an open choice, not made here.
- **Versioned URLs**: `/icons/*` is cached for 30 days (`_headers`) and the files keep their names, so after
  the 2026-11-14 change returning visitors kept the old logo for up to a month. Every reference to a file
  made from the master (pages, manifests, both service workers' lists, `worker.js`'s emails, `cap-web/`)
  carries `?v=` and the first 8 hex of sha256(master sha256 | frame), so a new logo is a new URL. The page
  generators stamp what they write; `python3 tools/brand.py stamp` re-stamps a page copied from an older
  one (`--check` only lists them); the brand gate recomputes the version and fails any other.
- **ios/ and android/**: once the app has been built here, these gitignored folders hold the master's app
  icon, splash and offline-page logo. set remakes them in place and checks them, because the brand gate
  reads them along with every file git tracks and would fail on the old logo's bytes there.
  `python3 tools/brand.py native` does the same on its own; `--check` only reports.
- **What the gate reads**: every file git tracks, plus ios/ and android/. Never a folder that is its own
  checkout (the worktrees under `.claude/worktrees/` in the main checkout), node_modules, .wrangler,
  `_local/` or `native-build/`, so old logos in other worktrees or scratch cannot fail set or a push.

## If you change your mind

- Before committing: `git --literal-pathspecs restore --pathspec-from-file=<proof folder>/touched.txt`, the
  exact files set wrote (it refuses to start unless they are all committed, a new card git does not know
  yet included, so this undoes set and nothing else). The same list commits the change:
  `git --literal-pathspecs commit --pathspec-from-file=<proof folder>/touched.txt`. Keep
  `--literal-pathspecs`: without it git reads `*`, `?` and `[` in a file name as a pattern and could restore
  or commit a file set never touched. If this checkout has ios/ or android/,
  follow it with `python3 tools/brand.py native`: git cannot reach those folders, so this puts them back
  on the restored master.
- After committing: `python3 tools/brand.py set <the old file> --yes`. A master that comes back leaves the
  retired list, and the files come out byte for byte as before.

## Good to know

- `/icons/*` stays cached for 30 days (`_headers`): a logo change reaches returning visitors anyway, because
  it changes every URL (`?v=`, above). Set the version by `brand.py set` or `stamp`, never by hand.
- The site's top bar and the app's landing draw the logo with a soft drop shadow (`filter: drop-shadow`,
  warm on cream, deeper in Night); the brand gate checks the rules and the computed style.
- The iOS build (`tools/cap_ios_build.sh`) regenerates its icon and splash from the master, so the next
  app build picks the change up; App Store screenshots are not regenerated.
- Pages load `icons/logo-96.png` in the top bar (with `logo-192.png` for 3x screens): 9KB instead of the
  197KB `logo-512.png`, which stays for schema.org, emails and the app's own screens. The brand gate fails a
  page whose top bar asks for the 512 again, and a page that asks for both (any other mark of 96px or less
  on a page takes logo-96 with logo-192 in its srcset, as the 404 page's 64px bear does).
- `node tools/brand_image_check.js` is the gate behind all of this; `python3 tools/brand.py --self-test`
  proves the tool itself (both run in `node tools/gates.js`).
