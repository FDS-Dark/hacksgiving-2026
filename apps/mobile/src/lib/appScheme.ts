import Constants from 'expo-constants';

/** This build's URL scheme from app.config.ts: "hacksgiving", or "hacksgiving-staging"
 * in the staging app, so its sign-in callback and invite links open the app
 * they came from. */
const configured = Constants.expoConfig?.scheme;
export const appScheme: string = (Array.isArray(configured) ? configured[0] : configured) ?? 'hacksgiving';
