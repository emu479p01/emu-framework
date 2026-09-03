export function safeInternalRedirect(value: unknown, fallback = '/'): string {
  const candidate = Array.isArray(value) ? value.at(-1) : value;
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || /[\u0000-\u001f]/.test(candidate)) return fallback;
  try {
    const url = new URL(candidate, 'http://emuframework.local');
    if (url.origin !== 'http://emuframework.local' || url.pathname === '/login' || url.pathname.startsWith('/login/') || url.pathname === '/setup' || url.pathname.startsWith('/setup/')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}
