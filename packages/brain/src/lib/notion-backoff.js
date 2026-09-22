/** Notion API 退避：只对 429 与 5xx 重试（幂等 GET/PATCH/POST 建页由调用方保证幂等键）。 */
export function defaultIsRetryable(err) {
  const s = Number(err?.status);
  return s === 429 || (s >= 500 && s < 600);
}

export async function withBackoff(fn, {
  attempts = 4,
  baseMs = 100,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  isRetryable = defaultIsRetryable,
} = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr;
}
