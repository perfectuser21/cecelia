/** Build requests from the configured N8N origin; caller input is only an encoded webhook path. */
export function trustedN8nWebhookUrl(apiBase, webhookPath) {
  const invalid = () => { throw Error('Invalid or untrusted N8N webhook destination'); };
  const base = new URL(apiBase);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) invalid();
  if (typeof webhookPath !== 'string' || !webhookPath || webhookPath.length > 4096
    || /[\s\\#]/.test(webhookPath) || [...webhookPath].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || webhookPath.startsWith('//')) invalid();
  const prefix = `${base.pathname.replace(/\/$/, '')}/webhook/`;
  let rawPath, query = '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(webhookPath)) {
    const target = new URL(webhookPath);
    if (target.origin !== base.origin || target.username || target.password || target.hash) invalid();
    // Inspect original bytes before URL normalization can erase dot/path escapes.
    const original = webhookPath.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+(\/[^?#]*)?(?:\?([^#]*))?$/i);
    if (!original) invalid();
    rawPath = original[1] || '/'; query = original[2] || '';
  } else {
    const queryIndex = webhookPath.indexOf('?');
    rawPath = queryIndex < 0 ? webhookPath : webhookPath.slice(0, queryIndex);
    query = queryIndex < 0 ? '' : webhookPath.slice(queryIndex + 1);
    if (!rawPath.startsWith('/')) rawPath = prefix + rawPath;
  }
  if (!rawPath.startsWith(prefix)) invalid();
  const segments = rawPath.slice(prefix.length).split('/').map(segment => {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { invalid(); }
    if (!decoded || decoded === '.' || decoded === '..' || !/^[A-Za-z0-9._~-]+$/.test(decoded)) invalid();
    return encodeURIComponent(decoded);
  });
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  return `${base.origin}${prefix}${segments.join('/')}${search}`;
}
