# Hacksgiving mobile

Expo (SDK 58) + React Native + TypeScript, with Expo Router.

```
src/app/         routes (screens); Expo Router treats every file here as one
  (main)/          the resident app: tabs (Home, Requests, Nearby, Me)
  help/            asking for help and following a request (works signed out)
  staff/           the staff app: its own tab bar (Today, Queue, Record, Map, Me)
src/components/  UI building blocks (staff/ for the staff app's)
src/services/    one module per API domain: API calls, query keys, hooks, mutations
src/api/         the HTTP client, and the API's types generated from openapi.json
src/lib/         sign-in, labels and formatting, small helpers
```

Each API domain has one service module, named after its router in
`api/routers/`: `user`, `staff`, `cases`, `requests` (a resident's view of
a case), `resources`, `tasks`, `oncall`, `notifications`, `voice`, `chat`
(staff team chat), `partners`, `export` (Me → Export my records) and
`health`. A module holds its
`<domain>Api` calls, its `<domain>Keys` query keys and its hooks.
`publicSafety`, `recentCalls` and `deviceLocation` read public data or
the device, not our API.

Screens call service hooks (`useMe()`), never the client. TanStack Query
caches what they load, under each domain's keys; each mutation refreshes
what it changed
([ADR 0008](../../docs/decisions/0008-mobile-services-and-query-cache.md)).

```bash
cp .env.example .env.local   # API base URL, Auth0 ids, optional dev token
npm ci
npx expo start --go          # Expo Go on the iPhone, or i for the simulator
npx tsc --noEmit && npx eslint . --max-warnings=0 && npm test
```

`--go` keeps Expo Go as the target: the project includes `expo-dev-client`
(for push, which Expo Go can't receive), and without the flag `expo start`
would wait for a development build instead. To try push, install a
development build from the Mac (`npx expo run:ios --device`, signed with
team D36AR26A38) and run `npm run start:dev-client`.

### API types

`src/api/schema.ts` is generated; don't edit it. After changing an API model:

```bash
cd ../../api && uv run python scripts/export_openapi.py ../apps/mobile/openapi.json
cd ../apps/mobile && npm run gen:api
```

CI fails when either file is out of date.

On a physical iPhone, `EXPO_PUBLIC_API_BASE_URL` must use your computer's LAN
(or Tailscale) IP, and the API must listen on it
(`uv run uvicorn main:app --host 0.0.0.0 --port 8000` in `api/`).

## Sign-in

`src/lib/auth.tsx` runs Auth0 Universal Login in the system browser with
OIDC + PKCE (`expo-auth-session`, which works in Expo Go). It asks for an
access token for `EXPO_PUBLIC_AUTH0_AUDIENCE` plus a refresh token
(`offline_access`). Tokens are kept in the Keychain (`expo-secure-store`) and
refreshed a minute before they expire. The API sees only the access token;
the ID token is used only to show the user's name.

The Auth0 tenant (the API, the **Hacksgiving Mobile** app for builds, the
**Hacksgiving Mobile (dev)** app for Expo Go, refresh-token rotation, the
name-claim Action) is managed in
[`auth0/terraform`](../../auth0/terraform/README.md). After it's applied:

```bash
tofu -chdir=../../auth0/terraform output -raw mobile_dev_env   # into .env.local (Expo Go)
```

`.env.production` holds the build client's values (`mobile_env`).

The Expo Go callback depends on the Metro host. If yours isn't
`exp://100.102.172.1:8081/--/auth`, use the URL shown at the bottom of the
sign-in screen and set it in that root's `dev_callback_urls` (the dev
client only). Development and production builds use `hacksgiving://auth`.

A refresh that fails because Auth0 can't be reached keeps you signed in
(`src/lib/authRefresh.ts`); only Auth0 refusing the refresh token signs
you out.

Auth0's own Expo SDK (`react-native-auth0`) needs a development build and
won't run in Expo Go, so the app uses `expo-auth-session` for now.

Until Auth0 is configured, set `EXPO_PUBLIC_DEV_ACCESS_TOKEN` to get a
**Continue with dev token** button. It only works against an API running
with the HS256 dev secret.

## Installing on an iPhone (no TestFlight)

A Release build bundles the JavaScript into the app, so once installed it
runs anywhere, with no Metro and no LAN or Tailscale. It talks to the
production API (`https://hacksgiving-api.austinkoske.com/v1`). iOS blocks plain
`http://` in Release builds, so the dev API's Tailscale address won't work.

Needs a Mac with Xcode, Node 22 and CocoaPods (`brew install node@22
cocoapods`), and the paid Apple Developer account (team `D36AR26A38`).
Set it up once per Mac and once per phone:

1. **Xcode account and certificate.** Xcode → Settings → Accounts: add
   the developer Apple ID, then *Manage Certificates…* → **+** → *Apple
   Development*.
2. **Apple's intermediate certificate.** If `security find-identity -v -p
   codesigning` says `0 valid identities found` even though the
   certificate is there, the Mac lacks Apple's WWDR G3 intermediate.
   Install it:
   ```bash
   curl -fsSLO https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer
   security add-certificates -k ~/Library/Keychains/login.keychain-db AppleWWDRCAG3.cer
   ```
3. **The phone.** Plug it in over USB, unlock it and tap **Trust This
   Computer**. Then Settings → Privacy & Security → **Developer Mode** →
   on. The phone restarts; confirm **Turn On** afterwards. If the switch is
   missing, replug the cable. `xcrun devicectl list devices` shows the
   phone's identifier.

Build and install from a clean clone (no `.env.local`):

```bash
cd apps/mobile
npm ci
npx expo prebuild --platform ios
xcodebuild -workspace ios/Hacksgiving.xcworkspace -scheme Hacksgiving   -configuration Release -destination id=<device-id>   -derivedDataPath ios/build   -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <device-id>   ios/build/Build/Products/Release-iphoneos/Hacksgiving.app
```

Use `xcodebuild` rather than `npx expo run:ios --device` for the first
install of a new phone. Expo builds without `-allowProvisioningUpdates`, so
it fails with *No profiles for 'com.austinkoske.hacksgiving' were found*. The two
`-allowProvisioning…` flags let Xcode register the phone with the Apple
account and create the development profile. Once the profile exists,
`npx expo run:ios --device --configuration Release` works too.

Gotchas:

- **Run it in Terminal on the Mac, not over SSH.** Over SSH the login
  keychain is locked and `codesign` cannot reach the key. The first build
  asks whether `codesign` may use the key: enter the Mac password and
  choose **Always Allow**.
- **The `.env` files.** The production values come from `.env.production`.
  It's committed because `EXPO_PUBLIC_*` values are public. Expo puts
  `.env.local` ahead of it, so if a `.env.local` exists the build uses that
  file's API URL and dev token; move it aside first. To check a build,
  `strings ios/build/Build/Products/Release-iphoneos/Hacksgiving.app/main.jsbundle
  | grep hacksgiving-api` should show the production URL.
- **Untrusted Developer.** If the phone says this on first launch, go to
  Settings → General → VPN & Device Management → the developer profile →
  **Trust**.
- **`ios/` is generated** (Continuous Native Generation) and gitignored.
  Change native settings in `app.json` (or `app.config.ts` for what
  differs per variant), never in `ios/`.

After the first install, Xcode can install over Wi-Fi when the Mac and phone
share a network. A developer-signed install lasts about a year. For
TestFlight, use Xcode → Product → Archive → Distribute App, and bump
`ios.buildNumber` in `app.json` for each upload.

## TestFlight (teammates' phones)

The production app goes to TestFlight from the Mac mini: the `testflight` CI
job (manual; on `main` after a production deploy, or on any branch to try a
build) runs `scripts/testflight.sh`. It archives a release with a new build
number (UTC time) and uploads it with an App Store Connect API key (Admin
role), which also lets Apple sign it in the cloud: the Mac needs no
distribution certificate. The key is on the Mac at
`~/.appstoreconnect/AuthKey_<ASC_KEY_ID>.p8`; `ASC_KEY_ID` and `ASC_ISSUER_ID`
are CI/CD variables. Signing needs the Mac's login session (the CI runner or
Terminal there), not SSH.

After Apple processes a build (10-30 min) it shows up in the TestFlight app
for the internal testing group. To add a teammate: invite them in App Store
Connect (Users and Access), add them to the group under TestFlight, and have
them install TestFlight and accept.

## Staging app

**Hacksgiving Staging** is a second app that installs next to Hacksgiving. It has its
own bundle id (`com.austinkoske.hacksgiving.staging`) and URL scheme
(`hacksgiving-staging`), and talks to the staging API
(`https://hacksgiving-api-staging.austinkoske.com/v1`) and the staging database.
Both apps sign in through the same Auth0 tenant and Hacksgiving Mobile client.
`app.config.ts` picks the variant from `APP_VARIANT`; `scripts/variant.sh`
sets it, along with the values from `.env.<variant>`.

Shell values beat every `.env` file, so `.env.local` doesn't need moving
aside for either variant. Each variant generates a different `ios/`, so
prebuild with `--clean` whenever you switch:

```bash
cd apps/mobile
scripts/variant.sh staging npx expo prebuild --platform ios --clean
scripts/variant.sh staging xcodebuild -workspace ios/Hacksgiving.xcworkspace -scheme Hacksgiving   -configuration Release -destination id=<device-id> -derivedDataPath ios/build   -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <device-id>   ios/build/Build/Products/Release-iphoneos/Hacksgiving.app
```

Build the production app the same way with `scripts/variant.sh production`.

`scripts/install-device.sh <staging|production>` does all of the above in
one step (with `IOS_DEVICE_ID` set), and CI runs it on the Mac mini runner:
`ios-device-staging` after each staging deploy, `ios-device-production`
after each production deploy, and `ios-device-staging` by hand on any
other pipeline. The phone has to be on the Mac's cable or Wi-Fi. Tailscale
alone isn't enough, because Xcode only finds phones on the local network.
If the phone isn't there, the job fails in seconds without failing the
pipeline; retry it once the phone is connected.
The first staging build registers the new bundle id with the Apple account;
`-allowProvisioningUpdates` handles that. To check which API a build uses,
run `strings` on its `main.jsbundle` (see Gotchas above).

## Adding packages

Add packages with `npx expo install <pkg>` so versions match the SDK. See
`AGENTS.md` before touching Expo APIs.
