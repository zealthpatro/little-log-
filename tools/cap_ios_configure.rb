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
#
# Requires: gem install --user-install xcodeproj
# See docs/plans/2026-07-15-native-wrapper-app-store.md

require 'xcodeproj'
require 'fileutils'

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

unless File.exist?(ENTITLEMENTS)
  File.write(ENTITLEMENTS, <<~PLIST)
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
    	<key>com.apple.developer.applesignin</key>
    	<array>
    		<string>Default</string>
    	</array>
    </dict>
    </plist>
  PLIST
  puts '✓ Wrote App.entitlements (Sign in with Apple)'
end

# WKAppBoundDomains: the Service Worker / offline unlock (see header). Applied with PlistBuddy because
# `npx cap add ios` regenerates Info.plist.
INFO = File.join(APP_DIR, 'Info.plist')
DOMAINS = ['little-cubby.com']
if File.exist?(INFO)
  pb = '/usr/libexec/PlistBuddy'
  system(pb, '-c', 'Delete :WKAppBoundDomains', INFO, out: File::NULL, err: File::NULL)
  system(pb, '-c', 'Add :WKAppBoundDomains array', INFO)
  DOMAINS.each_with_index { |d, i| system(pb, '-c', "Add :WKAppBoundDomains:#{i} string #{d}", INFO) }
  abort('✖ Info.plist is malformed after the WKAppBoundDomains edit') unless system('plutil', '-lint', INFO, out: File::NULL)
  puts "✓ WKAppBoundDomains = #{DOMAINS.join(', ')} (Service Workers / offline)"
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
end
puts '✓ CODE_SIGN_ENTITLEMENTS set on all configurations'

project.save
puts '✓ Saved. Xcode project is configured for native sign-in.'
