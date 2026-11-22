/**
 * The Expo Go sign-in callback, exp://<metro host>/--/auth, or null outside
 * Expo Go.
 *
 * expo-linking decides "Expo Go or a build?" from
 * Constants.executionEnvironment, but Expo Go 58 on Android reports "bare".
 * expo-auth-session then builds hacksgiving://auth, and Auth0 rejects it
 * ("Callback URL mismatch"). So check for Expo Go's native module
 * (isRunningInExpoGo) and build the URL from Metro's host ourselves.
 */
export function expoGoRedirectUri(inExpoGo: boolean, hostUri: string | null | undefined, path = 'auth'): string | null {
  if (!inExpoGo || !hostUri) return null;
  const host = hostUri.replace(/^[a-z]+:\/\//, '').replace(/\/+$/, '');
  return `exp://${host}/--/${path}`;
}
