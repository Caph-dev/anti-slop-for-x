/**
 * Host permissions for a user-supplied upstream base URL.
 *
 * The extension ships no fixed upstream, so access is requested at runtime from
 * the options page. `chrome.permissions.request()` must be called from a user
 * gesture — call `requestOriginAccess()` synchronously inside a click handler,
 * before any `await`.
 */

/**
 * Chrome match pattern for a URL's origin.
 *
 * Match patterns have no port syntax (`http://localhost:8787/*` is rejected as
 * invalid), so the port is dropped: a pattern covers every port on that host,
 * which is also how the manifest's loopback entries behave.
 */
export function originPattern(url: string): string | null {
  try {
    const u = new URL((url || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** Unchecked request: safe to call directly in a click handler (no earlier await). */
export function requestOriginAccess(url: string): Promise<boolean> {
  const pattern = originPattern(url);
  if (!pattern) return Promise.resolve(false);
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return Promise.resolve(true);
  return chrome.permissions.request({ origins: [pattern] }).catch(() => false);
}
