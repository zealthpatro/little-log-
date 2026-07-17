#!/usr/bin/env ruby
# Configure the generated iOS Xcode project for Cubby. Idempotent: safe to re-run.
#
# WHY THIS EXISTS
# `ios/` is gitignored (the Cloudflare Worker serves the whole repo, so the native project stays local)
# and is regenerated with `npx cap add ios`. Anything done by hand in Xcode is therefore LOST on the
# next regen. Every non-default project setting Cubby needs lives here instead, so a fresh machine can
# reproduce the exact build. Run after `npx cap sync ios`.
#
# What it does:
#   1. Bundles GoogleService-Info.plist as a resource. Without it FirebaseApp.configure() crashes on
#      launch, and native Google/Apple sign-in (the only sign-in that works in a WKWebView) can't run.
#   2. Adds the Sign in with Apple entitlement. Required by App Review 4.8 whenever Google sign-in is
#      offered, and it's the smoothest path on iOS anyway (Face ID, no account picker).
#   3. Declares WKAppBoundDomains. WKWebView does NOT expose Service Workers unless the app declares
#      app-bound domains, and Cubby's SW is what makes the PWA launch instantly and work offline — so
#      without this the wrapper is strictly worse than the website it wraps. The side effect is that the
#      webview may not navigate outside the listed domains, which we can now afford: sign-in is native
#      (no accounts.google.com in the webview) and articles/off-site links open in a separate process
#      (Browser.open / the system browser). Must be paired with
#      ios.limitsNavigationsToAppBoundDomains=true in capacitor.config.json, or script injection is
#      restricted and the Capacitor bridge itself breaks.
#   4. Patches AppDelegate.swift: FirebaseApp.configure() (nothing Firebase-native works without it) and
#      the Auth.auth().canHandle(url) guard that @capacitor-firebase/authentication REQUIRES when it is
#      used alongside @capacitor-firebase/messaging (both hook the URL/APNs delegates; without the guard
#      the auth callback URL is swallowed by the messaging plugin and sign-in never completes).
#   5. Re-applies the REVERSED_CLIENT_ID URL scheme that Google Sign-In needs to hand control back to
#      the app, read straight out of GoogleService-Info.plist.
#
# Requires: gem install --user-install xcodeproj
# See docs/plans/2026-07-15-native-wrapper-app-store.md

require 'xcodeproj'
require 'fileutils'

TEAM_ID = 'F5NVQV7NVB'
ROOT = File.expand_path('..', __dir__)
PROJ = File.join(ROOT, 'ios', 'App', 'App.xcodeproj')
APP_DIR = File.join(ROOT, 'ios', 'App', 'App')
# The plist is founder-downloaded from the Firebase console and lives in gitignored native-build/,
# so it never reaches the publicly-served repo.
PLIST_SRC = File.join(ROOT, 'native-build', 'GoogleService-Info.plist')
PLIST_DST = File.join(APP_DIR, 'GoogleService-Info.plist')
ENTITLEMENTS = File.join(APP_DIR, 'App.entitlements')

abort("✖ No Xcode project at #{PROJ}\n  Run: npx cap add ios && npx cap sync ios") unless File.exist?(PROJ)

unless File.exist?(PLIST_DST)
  abort("✖ Missing GoogleService-Info.plist.\n  Put it at native-build/GoogleService-Info.plist\n  (Firebase console -> project little-log-a9caa -> iOS app com.littlecubby.app -> download)") unless File.exist?(PLIST_SRC)
  FileUtils.cp(PLIST_SRC, PLIST_DST)
  puts '✓ Copied GoogleService-Info.plist into the app'
end

# Always (re)write, so a changed entitlement can never be left behind by an `unless File.exist?` guard.
# `aps-environment` is what actually turns on push: without it FirebaseMessaging fails registration with
# "no valid aps-environment entitlement string found" and no APNs token is ever issued, no matter what
# key is uploaded to Firebase. `development` is correct even for TestFlight/App Store builds — Apple
# rewrites it to `production` when it re-signs for distribution.
File.write(ENTITLEMENTS, <<~PLIST)
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
  	<key>com.apple.developer.applesignin</key>
  	<array>
  		<string>Default</string>
  	</array>
  	<key>aps-environment</key>
  	<string>development</string>
  	<key>com.apple.developer.associated-domains</key>
  	<array>
  		<string>applinks:little-cubby.com</string>
  	</array>
  </dict>
  </plist>
PLIST
puts '✓ Wrote App.entitlements (Sign in with Apple + push + universal links)'

# WKAppBoundDomains: the Service Worker / offline unlock (see header). Applied with PlistBuddy because
# `npx cap add ios` regenerates Info.plist.
INFO = File.join(APP_DIR, 'Info.plist')
DOMAINS = ['little-cubby.com']
pb = '/usr/libexec/PlistBuddy'
if File.exist?(INFO)
  system(pb, '-c', 'Delete :WKAppBoundDomains', INFO, out: File::NULL, err: File::NULL)
  system(pb, '-c', 'Add :WKAppBoundDomains array', INFO)
  DOMAINS.each_with_index { |d, i| system(pb, '-c', "Add :WKAppBoundDomains:#{i} string #{d}", INFO) }

  # Google Sign-In returns to the app through this custom URL scheme. Read from the plist rather than
  # hardcoded so a re-downloaded GoogleService-Info.plist can never silently desync it.
  rev = `#{pb} -c "Print :REVERSED_CLIENT_ID" "#{PLIST_DST}" 2>/dev/null`.strip
  abort('✖ No REVERSED_CLIENT_ID in GoogleService-Info.plist — Google sign-in cannot return to the app') if rev.empty?
  system(pb, '-c', 'Delete :CFBundleURLTypes', INFO, out: File::NULL, err: File::NULL)
  system(pb, '-c', 'Add :CFBundleURLTypes array', INFO)
  system(pb, '-c', 'Add :CFBundleURLTypes:0 dict', INFO)
  system(pb, '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array', INFO)
  system(pb, '-c', "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string #{rev}", INFO)

  # Cubby only uses the OS's standard HTTPS/TLS, so declare it and skip the export-compliance prompt
  # on every upload.
  system(pb, '-c', 'Delete :ITSAppUsesNonExemptEncryption', INFO, out: File::NULL, err: File::NULL)
  system(pb, '-c', 'Add :ITSAppUsesNonExemptEncryption bool false', INFO)

  # iOS KILLS the app instantly if it touches the camera/photo library without a usage string. The app
  # has photo upload + video capture, so these are required, not optional.
  # NOTE: no apostrophes. PlistBuddy parses its own -c string and dies on one ("Parse Error: Unclosed
  # Quotes") — and it FAILS SILENTLY, so the key is simply absent and the app crashes on first use.
  # That is exactly how NSPhotoLibraryUsageDescription went missing once already; the check below is
  # what turns a silent miss into a loud one.
  USAGE = {
    'NSCameraUsageDescription' => 'Cubby uses the camera so you can add a photo to a moment.',
    'NSPhotoLibraryUsageDescription' => 'Cubby needs your photo library so you can add photos to your moments and keepsakes.',
    'NSPhotoLibraryAddUsageDescription' => 'Cubby saves the keepsakes and photos you create back to your photo library.',
    'NSMicrophoneUsageDescription' => 'Cubby uses the microphone when you record a moment, and for voice logging.',
    'NSSpeechRecognitionUsageDescription' => 'Cubby uses speech recognition so you can log a feed or a nap by speaking.'
  }.freeze
  USAGE.each do |key, val|
    abort("✖ #{key} contains an apostrophe; PlistBuddy will drop it silently. Reword it.") if val.include?("'")
    system(pb, '-c', "Delete :#{key}", INFO, out: File::NULL, err: File::NULL)
    system(pb, '-c', "Add :#{key} string #{val}", INFO)
  end

  abort('✖ Info.plist is malformed after the edits') unless system('plutil', '-lint', INFO, out: File::NULL)

  # Verify every key actually landed. PlistBuddy reports failures on stdout and still exits 0.
  written = `plutil -p "#{INFO}"`
  missing = (USAGE.keys + ['WKAppBoundDomains', 'CFBundleURLTypes']).reject { |k| written.include?(k) }
  abort("✖ Info.plist keys missing after write: #{missing.join(', ')}") unless missing.empty?
  abort('✖ Google URL scheme did not land in Info.plist') unless written.include?(rev)
  puts "✓ Info.plist: WKAppBoundDomains=#{DOMAINS.join(',')}, Google URL scheme, encryption + usage strings"
end

# AppDelegate.swift is regenerated by `npx cap add ios`, so these two edits must live here or native
# sign-in silently dies on the next regen.
APPDELEGATE = File.join(APP_DIR, 'AppDelegate.swift')
if File.exist?(APPDELEGATE)
  src = File.read(APPDELEGATE)
  before = src.dup

  # Check each import on its own: a combined guard silently skipped FirebaseAuth when FirebaseCore was
  # already present, leaving Auth.auth() unresolved (a compile error, or worse a stale working build).
  %w[FirebaseCore FirebaseAuth].each do |mod|
    next if src.match?(/^import #{mod}$/)
    src.sub!(/^import Capacitor$/, "import Capacitor\nimport #{mod}")
  end

  unless src.include?('FirebaseApp.configure()')
    src.sub!(/(func application\(_ application: UIApplication, didFinishLaunchingWithOptions[^\n]*\n)/) do
      "#{$1}        // Nothing Firebase-native (incl. the only sign-in that works in a WKWebView) runs without this.\n        FirebaseApp.configure()\n"
    end
  end

  # REQUIRED because we ship @capacitor-firebase/authentication AND @capacitor-firebase/messaging: both
  # hook the URL/APNs delegates, and without this guard the auth callback URL is swallowed by messaging
  # and sign-in never completes. Documented in the auth plugin's README.
  unless src.include?('Auth.auth().canHandle(url)')
    src.sub!(/(func application\(_ app: UIApplication, open url: URL, options: \[UIApplication\.OpenURLOptionsKey: Any\] = \[:\]\) -> Bool \{\n)/) do
      "#{$1}        // Must run before Capacitor's proxy: @capacitor-firebase/messaging would otherwise swallow\n        // the auth callback URL and sign-in would hang forever.\n        if Auth.auth().canHandle(url) {\n            return true\n        }\n"
    end
  end

  if src == before
    puts '· AppDelegate.swift already patched'
  else
    File.write(APPDELEGATE, src)
    puts '✓ AppDelegate.swift: FirebaseApp.configure() + Auth.auth().canHandle(url)'
  end
  %w[FirebaseCore FirebaseAuth].each do |mod|
    abort("✖ AppDelegate.swift is missing `import #{mod}` — Capacitor changed the template. Fix this script.") unless src.match?(/^import #{mod}$/)
  end
  ['FirebaseApp.configure()', 'Auth.auth().canHandle(url)'].each do |needle|
    abort("✖ AppDelegate.swift patch did not apply (#{needle}) — Capacitor changed the template. Fix this script.") unless src.include?(needle)
  end
end

project = Xcodeproj::Project.open(PROJ)
target = project.targets.find { |t| t.name == 'App' } or abort('✖ No "App" target')
group = project.main_group.find_subpath('App', true)

# 1. GoogleService-Info.plist as a bundled resource.
if group.files.none? { |f| f.display_name == 'GoogleService-Info.plist' }
  ref = group.new_reference(PLIST_DST)
  target.add_resources([ref])
  puts '✓ Added GoogleService-Info.plist to Copy Bundle Resources'
else
  puts '· GoogleService-Info.plist already in the project'
end

# 2. Entitlements file: register it and point every build configuration at it.
if group.files.none? { |f| f.display_name == 'App.entitlements' }
  group.new_reference(ENTITLEMENTS)
  puts '✓ Added App.entitlements to the project'
end
target.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
  # 3. The development team. `npx cap add ios` leaves this EMPTY, so a signed archive dies with
  #    "Signing for App requires a development team". Builds 1-5 papered over that by archiving with
  #    CODE_SIGNING_ALLOWED=NO — which SKIPS the packaging step that embeds entitlements, so the app
  #    shipped with NO Sign in with Apple and NO aps-environment (verified by dumping the signed IPA).
  #    That is why Apple sign-in and push were both dead. Set the team and archive signed instead.
  config.build_settings['DEVELOPMENT_TEAM'] = TEAM_ID
  config.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
  # `npx cap add ios` hardcodes CODE_SIGN_IDENTITY = "iPhone Developer" on EVERY configuration. For a
  # Release archive that makes Xcode hunt for an "iOS App Development" profile, which needs a registered
  # device — the team has none, so the archive fails. That failure is what pushed builds 1-5 onto the
  # CODE_SIGNING_ALLOWED=NO workaround that silently dropped the entitlements. Ask for a distribution
  # identity instead: an App Store profile needs no device, and -allowProvisioningUpdates + the ADMIN
  # API key mints the cert and profile in the cloud.
  if config.name == 'Release'
    config.build_settings['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
    config.build_settings['CODE_SIGN_IDENTITY[sdk=iphoneos*]'] = 'Apple Distribution'
  end
end
puts "✓ CODE_SIGN_ENTITLEMENTS + DEVELOPMENT_TEAM=#{TEAM_ID} set on all configurations"

project.save
puts '✓ Saved. Xcode project is configured for native sign-in.'
