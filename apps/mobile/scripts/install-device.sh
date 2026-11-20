#!/usr/bin/env bash
# Build one app variant as a signed Release and install it on a paired iPhone.
# Used by the ios-device-* CI jobs on the Mac mini runner; works by hand too
# (in Terminal on the Mac, not over SSH: SSH can't unlock the signing key).
#
#   IOS_DEVICE_ID=<udid> scripts/install-device.sh staging
#   IOS_DEVICE_ID=<udid> scripts/install-device.sh production
#
# The phone must already be paired with this Mac, with Developer Mode on
# (README.md, "Run it on your iPhone"). It can be on the cable or on the
# same Wi-Fi. `xcrun devicectl list devices` shows the identifier.
set -euo pipefail

variant="${1:?usage: scripts/install-device.sh <production|staging>}"
device="${IOS_DEVICE_ID:?set IOS_DEVICE_ID to the identifier of the phone}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
derived="${DERIVED_DATA_PATH:-$here/ios/build}"
cd "$here"

case "$variant" in
  production) bundle_id=com.austinkoske.hacksgiving ;;
  staging) bundle_id=com.austinkoske.hacksgiving.staging ;;
  *) echo "Unknown variant: $variant" >&2; exit 1 ;;
esac

# Fail before the build, not after it, if the phone can't be reached.
devices_json="$(mktemp)"
trap 'rm -f "$devices_json"' EXIT
xcrun devicectl list devices --json-output "$devices_json" >/dev/null
find_state='
import json, sys
device, path = sys.argv[1:]
states = [d["connectionProperties"].get("tunnelState", "unknown")
          for d in json.load(open(path))["result"]["devices"]
          if d["hardwareProperties"].get("udid") == device]
print(states[0] if states else "not-paired")
'
state="$(python3 -c "$find_state" "$device" "$devices_json")"
case "$state" in
  not-paired) echo "Phone $device isn't paired with this Mac. Pair it over USB first." >&2; exit 1 ;;
  unavailable) echo "Phone $device is paired but not reachable. Plug it in, or join the Mac's Wi-Fi, and unlock it." >&2; exit 1 ;;
esac
echo "Phone $device: $state"

if [ -f .env.local ]; then
  echo ".env.local would override .env.$variant; move it aside first." >&2
  exit 1
fi

# CocoaPods crashes without a UTF-8 locale, and the CI runner's shell has none.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

npm ci --no-audit --no-fund
scripts/variant.sh "$variant" npx expo prebuild --platform ios --clean
# prebuild exits 0 even when `pod install` fails.
[ -d ios/Hacksgiving.xcworkspace ] || { echo "prebuild didn't create ios/Hacksgiving.xcworkspace (see pod install above)." >&2; exit 1; }
scripts/variant.sh "$variant" xcodebuild \
  -workspace ios/Hacksgiving.xcworkspace -scheme Hacksgiving -configuration Release \
  -destination "id=$device" -derivedDataPath "$derived" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="${IOS_TEAM_ID:-D36AR26A38}" build

app="$derived/Build/Products/Release-iphoneos/Hacksgiving.app"
api_url="$(set -a; . "./.env.$variant"; echo "$EXPO_PUBLIC_API_BASE_URL")"
if ! grep -qF "$api_url" "$app/main.jsbundle"; then
  echo "The bundle doesn't contain $api_url; refusing to install the wrong build." >&2
  exit 1
fi
/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist" | grep -qx "$bundle_id" || {
  echo "Built app isn't $bundle_id." >&2; exit 1
}

xcrun devicectl device install app --device "$device" "$app"
echo "Installed $bundle_id ($variant, $api_url) on $device."
