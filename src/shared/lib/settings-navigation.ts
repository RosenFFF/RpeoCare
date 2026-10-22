/** Only return to known workspace pages, never an external or authentication URL. */
export function safeSettingsReturn(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return null;
  try {
    const url = new URL(value, 'http://workspace.local');
    if (url.origin !== 'http://workspace.local' || !['/overview', '/audit', '/issues', '/pull-requests', '/improvements', '/projects'].includes(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}
