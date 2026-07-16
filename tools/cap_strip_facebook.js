#!/usr/bin/env node
/* Strip the Facebook SDK out of @capacitor-firebase/authentication before `npx cap sync`.
 *
 * WHY THIS EXISTS
 * Cubby's brand promise is "no third-party trackers", and the standing rule is that no Meta/Google
 * ad or analytics SDK ever enters the product. The auth plugin's CocoaPods podspec respects that by
 * defaulting to a "Lite" subspec with no third-party deps (Google and Facebook are opt-in subspecs),
 * but its Swift Package Manager manifest hardcodes BOTH google/GoogleSignIn-iOS AND
 * facebook/facebook-ios-sdk. Capacitor 8 uses SPM, so a plain `npm i` would link Meta's SDK into the
 * Cubby binary. We use Google sign-in, so GoogleSignIn stays. We do not offer Facebook sign-in, so
 * FacebookCore/FacebookLogin are removed along with the RGCFA_INCLUDE_FACEBOOK compile flag.
 *
 * SAFE BECAUSE: every Facebook reference in the plugin's Swift sits behind `#if RGCFA_INCLUDE_FACEBOOK`
 * (including the `import FBSDKLoginKit`). FacebookAuthProviderHandler's *class* is declared outside the
 * guard, so FirebaseAuthentication.swift still type-checks; its bodies just compile to no-ops, and
 * signInWithFacebook() is never called from Cubby.
 *
 * node_modules/ and package.json are gitignored (the Worker serves the whole repo), so the native
 * project is regenerated from scratch on the build machine. That is exactly why this is a committed
 * script and not a hand-edit: run it after `npm i`, before `npx cap sync`.
 * See docs/plans/2026-07-15-native-wrapper-app-store.md
 */
const fs = require('fs');
const path = require('path');

const PKG = path.join(__dirname, '..', 'node_modules', '@capacitor-firebase', 'authentication', 'Package.swift');

if (!fs.existsSync(PKG)) {
  console.error('✖ Not found: ' + PKG + '\n  Run `npm i` first.');
  process.exit(1);
}

const before = fs.readFileSync(PKG, 'utf8');
let after = before
  .replace(/^\s*\.package\(url: "https:\/\/github\.com\/facebook\/facebook-ios-sdk\.git".*\n/m, '')
  .replace(/^\s*\.product\(name: "FacebookCore", package: "facebook-ios-sdk"\),?\s*\n/m, '')
  .replace(/^\s*\.product\(name: "FacebookLogin", package: "facebook-ios-sdk"\),?\s*\n/m, '')
  .replace(/^\s*\.define\("RGCFA_INCLUDE_FACEBOOK"\),?\s*\n/m, '');

// A dangling comma before a closing bracket is a Swift syntax error, so tidy up after the removals.
after = after.replace(/,(\s*\])/g, '$1');

if (/facebook|Facebook/.test(after)) {
  console.error('✖ Facebook references survived the strip. The plugin layout changed; update this script.');
  console.error(after.split('\n').filter((l) => /facebook/i.test(l)).join('\n'));
  process.exit(1);
}

if (after === before) {
  console.log('✓ Already clean: no Facebook SDK in the auth plugin.');
  process.exit(0);
}

fs.writeFileSync(PKG, after);
console.log('✓ Stripped the Facebook SDK from @capacitor-firebase/authentication (GoogleSignIn kept).');
