import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json is the production app. APP_VARIANT=staging makes "Hacksgiving Staging",
 * a separate app (its own bundle id, Android package and URL scheme) that installs next to it
 * and talks to the staging API. scripts/variant.sh sets APP_VARIANT and the
 * matching .env.<variant> values; see README.md "Staging app".
 *
 * `name` stays "Hacksgiving" for both so the generated Xcode workspace and scheme
 * (ios/Hacksgiving.xcworkspace, Hacksgiving) don't change; the home-screen name comes
 * from CFBundleDisplayName.
 */
const variants = {
  production: { displayName: 'Hacksgiving', bundleIdentifier: 'com.austinkoske.hacksgiving', androidPackage: 'com.austinkoske.hacksgiving', scheme: 'hacksgiving' },
  staging: { displayName: 'Hacksgiving Staging', bundleIdentifier: 'com.austinkoske.hacksgiving.staging', androidPackage: 'com.austinkoske.hacksgiving.staging', scheme: 'hacksgiving-staging' },
} as const;

type Variant = keyof typeof variants;

function variant(): Variant {
  const value = process.env.APP_VARIANT ?? 'production';
  if (!(value in variants)) {
    throw new Error(`APP_VARIANT must be one of ${Object.keys(variants).join(', ')}, not "${value}".`);
  }
  return value as Variant;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const v = variants[variant()];
  return {
    ...config,
    name: config.name ?? 'Hacksgiving',
    slug: config.slug ?? 'hacksgiving',
    scheme: v.scheme,
    // Read at runtime by src/lib/phone.ts (911 only dials in production).
    extra: { ...config.extra, variant: variant() },
    ios: {
      ...config.ios,
      bundleIdentifier: v.bundleIdentifier,
      // scripts/testflight.sh sets a new build number for each upload.
      buildNumber: process.env.IOS_BUILD_NUMBER ?? config.ios?.buildNumber,
      infoPlist: { ...config.ios?.infoPlist, CFBundleDisplayName: v.displayName },
    },
    android: { ...config.android, package: v.androidPackage },
  };
};
