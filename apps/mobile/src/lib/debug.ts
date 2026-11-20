/** Development-only tracing, shown in React Native DevTools' Console as
 *  "[hacksgiving] …". Silent in release builds. Never log tokens or bodies. */
export function debug(...args: unknown[]) {
  if (__DEV__) console.log('[hacksgiving]', ...args);
}
