// packages/brain/src/clips-extractor.js
const PROXY_URL = process.env.CONTENT_SERVICE_PROXY_URL || 'http://38.23.47.81:7786';
const BRAIN_PUBLIC_URL = process.env.BRAIN_PUBLIC_URL || 'http://38.23.47.81:5221';

/**
 * Trigger async extraction via content-service proxy.
 * The proxy POSTs results back to Brain's /api/brain/clips/:id/callback.
 */
export async function extractClip(clipId, url) {
  const callbackUrl = `${BRAIN_PUBLIC_URL}/api/brain/clips/${clipId}/callback`;
  const resp = await fetch(PROXY_URL + '/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, callback_url: callbackUrl }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`content-service error ${resp.status}: ${text}`);
  }
}
