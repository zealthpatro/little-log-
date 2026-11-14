# Changing the logo

Every Cubby logo (app icon, favicon, the site's top bar, sign-in card, emails, 1,245 share and promo
cards, the native app icon and splash) is made from ONE file, `icons/icon-master-1024.png`. Changing the
logo means changing that file with `tools/brand.py`, never by copying a PNG over it.

## To change the logo

```sh
python3 tools/brand.py compare a.png b.png c.png        # look and measure; opens nothing, prints the path
python3 tools/brand.py zoom b.png --subject-width 87 --out b87.png      # optional: make the face bigger
python3 tools/brand.py set b87.png --name "the honey teddy" --provenance "gpt-image-2 from the painted cub, founder's pick, 3 judges"
python3 tools/brand.py set b87.png --name "the honey teddy" --provenance "..." --yes
```

Then review the proof it prints (`before-after.png`), run `node tools/gates.js`, commit the files it lists
in `touched.txt` beside the proof, and push main (push = deploy). That is the whole change.

**Need candidates first?** `python3 tools/brand.py propose --ref app/journey-art/ov_hero-cub.webp
--variants v.json --dry-run` shows the requests; without `--dry-run` it calls gpt-image-2 (paid, key in
`art-src/openai.key`) and compares what comes back. `v.json` is
`{"base": "App icon of this painted cub, face and ears only...", "variants": [{"name": "honey", "prompt": "light honey wash"}]}`.

## What each step does

- **compare** writes `sizes.png` (512 to 16px, light and dark), `homescreen.png` (60px among other apps,
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
  `tools/brand-images.json`, moves the old master and everything made from it into a **retired** set (so
  its bytes can never come back unnoticed), runs the brand gate, `card_logo.py --check` and
  `gen_brand_icons.py --check`, and draws the proof.
- **ios/ and android/**: once the app has been built here, these gitignored folders hold the master's app
  icon, splash and offline-page logo. set remakes them in place and checks them, because the brand gate
  reads the whole tree and would fail on the old logo's bytes there. `python3 tools/brand.py native` does
  the same on its own; `--check` only reports.

## If you change your mind

- Before committing: `git restore --pathspec-from-file=<proof folder>/touched.txt`, the exact files set
  wrote (it refuses to start unless they are all committed, a new card git does not know yet included, so
  this undoes set and nothing else). The same list commits the change:
  `git commit --pathspec-from-file=<proof folder>/touched.txt`. If this checkout has ios/ or android/,
  follow it with `python3 tools/brand.py native`: git cannot reach those folders, so this puts them back
  on the restored master.
- After committing: `python3 tools/brand.py set <the old file> --yes`. A master that comes back leaves the
  retired list, and the files come out byte for byte as before.

## Good to know

- Returning visitors keep `/icons/*` in their browser cache for up to 30 days (`_headers`), so the old
  logo can linger on the site for them. Shortening that is an open founder decision.
- The iOS build (`tools/cap_ios_build.sh`) regenerates its icon and splash from the master, so the next
  app build picks the change up; App Store screenshots are not regenerated.
- Pages load `icons/logo-96.png` in the top bar (with `logo-192.png` for 3x screens): 9KB instead of the
  197KB `logo-512.png`, which stays for schema.org, emails and the app's own screens. The brand gate fails a
  page whose top bar asks for the 512 again, and a page that asks for both (any other mark of 96px or less
  on a page takes logo-96 with logo-192 in its srcset, as the 404 page's 64px bear does).
- `node tools/brand_image_check.js` is the gate behind all of this; `python3 tools/brand.py --self-test`
  proves the tool itself (both run in `node tools/gates.js`).
