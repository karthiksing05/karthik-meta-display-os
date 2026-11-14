/**
 * The install deeplink Meta's docs describe:
 *   fb-viewapp://web_app_deep_link?appName=<name>&appUrl=<https-url>
 * A plain QR of the site URL is NOT recognized; it must be this deeplink.
 * The app URL carries ?k=<token>; the glasses app saves it and strips it from the address bar.
 */
export function appUrl(publicUrl: string, token: string): string {
  const u = new URL(publicUrl.replace(/\/$/, '') + '/');
  u.searchParams.set('k', token);
  return u.toString();
}

export function installLink(publicUrl: string, token: string, name = 'Claude Productivity For Meta Display'): string {
  const params = new URLSearchParams({ appName: name, appUrl: appUrl(publicUrl, token) });
  return `fb-viewapp://web_app_deep_link?${params.toString()}`;
}
