#!/usr/bin/env bash
# Build the production app as a signed release and upload it to TestFlight.
# Used by the `testflight` CI job on the Mac mini runner; works by hand too
# (in Terminal on the Mac, not over SSH: SSH can't unlock the signing key).
#
#   ASC_KEY_ID=... ASC_ISSUER_ID=... scripts/testflight.sh
#
# Signing is automatic and Apple signs the upload in the cloud, so the Mac
# needs no distribution certificate: the App Store Connect API key (Admin
# role) does it. The key lives on the Mac at
# ~/.appstoreconnect/AuthKey_<ASC_KEY_ID>.p8 (or ASC_KEY_PATH), never in git.
# Each upload gets a new build number (UTC time, so it always goes up).
set -euo pipefail

key_id="${ASC_KEY_ID:?set ASC_KEY_ID (App Store Connect API key id)}"
issuer_id="${ASC_ISSUER_ID:?set ASC_ISSUER_ID (App Store Connect issuer id)}"
key_path="${ASC_KEY_PATH:-$HOME/.appstoreconnect/AuthKey_${key_id}.p8}"
team_id="${IOS_TEAM_ID:-D36AR26A38}"
variant=production
bundle_id=com.austinkoske.hacksgiving
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="${TESTFLIGHT_WORK_DIR:-$here/ios/build/testflight}"
cd "$here"

[ -f "$key_path" ] || { echo "No App Store Connect key at $key_path." >&2; exit 1; }
if [ -f .env.local ]; then
  echo ".env.local would override .env.$variant; move it aside first." >&2
  exit 1
fi

export IOS_BUILD_NUMBER="${IOS_BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
auth=(-allowProvisioningUpdates
  -authenticationKeyPath "$key_path"
  -authenticationKeyID "$key_id"
  -authenticationKeyIssuerID "$issuer_id")

# CocoaPods crashes without a UTF-8 locale, and the CI runner's shell has none.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

rm -rf "$work"
mkdir -p "$work"
log="$work/xcodebuild.log"
# xcodebuild's output runs to megabytes (more than a CI log keeps): it goes
# to a file, and only its tail is shown when a step fails.
quietly() {
  if ! "$@" >>"$log" 2>&1; then
    echo "Failed: $*" >&2
    tail -60 "$log" >&2
    exit 1
  fi
}

npm ci --no-audit --no-fund
scripts/variant.sh "$variant" npx expo prebuild --platform ios --clean
# prebuild exits 0 even when `pod install` fails.
[ -d ios/Hacksgiving.xcworkspace ] || { echo "prebuild didn't create ios/Hacksgiving.xcworkspace (see pod install above)." >&2; exit 1; }

echo "Archiving $bundle_id build $IOS_BUILD_NUMBER..."
archive="$work/Hacksgiving.xcarchive"
quietly scripts/variant.sh "$variant" xcodebuild \
  -workspace ios/Hacksgiving.xcworkspace -scheme Hacksgiving -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive" \
  DEVELOPMENT_TEAM="$team_id" "${auth[@]}" archive

app="$archive/Products/Applications/Hacksgiving.app"
api_url="$(set -a; . "./.env.$variant"; echo "$EXPO_PUBLIC_API_BASE_URL")"
grep -qF "$api_url" "$app/main.jsbundle" || {
  echo "The bundle doesn't contain $api_url; refusing to upload the wrong build." >&2; exit 1
}
/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist" | grep -qx "$bundle_id" || {
  echo "Built app isn't $bundle_id." >&2; exit 1
}

cat >"$work/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$team_id</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>testFlightInternalTestingOnly</key><false/>
</dict>
</plist>
PLIST

echo "Uploading to App Store Connect..."
quietly xcodebuild -exportArchive -archivePath "$archive" \
  -exportOptionsPlist "$work/ExportOptions.plist" -exportPath "$work/export" "${auth[@]}"

echo "Uploaded $bundle_id build $IOS_BUILD_NUMBER. Apple processes it (usually 10-30 min);"
echo "then it appears under TestFlight for your internal testers."
