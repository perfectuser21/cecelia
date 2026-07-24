/**
 * Read-only Codex Slot capacity consumer.
 *
 * Account selection belongs exclusively to codex-slot-broker. This bridge-side
 * module consumes the broker-maintained account_usage_cache projection and
 * never opens an auth file or calls the provider usage endpoint.
 */

const BRAIN_URL = process.env.BRAIN_URL || 'http://100.71.151.105:5221';
const CACHE_TTL_MS = 30_000;
let cached = null;
let fetchedAt = 0;

function normalizeUsageSnapshot(payload) {
  const source = payload?.source;
  const usage = payload?.usage;
  if (source !== 'account_usage_cache' || !usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new Error('invalid codex-slot usage snapshot');
  }
  return Object.fromEntries(Object.entries(usage).map(([accountRef, row]) => [
    accountRef,
    {
      primaryUsedPct: Number(row.five_hour_pct),
      secondaryUsedPct: Number(row.seven_day_pct),
      resetsAt: row.resets_at || null,
      source: 'account_usage_cache',
    },
  ]));
}

async function getAllAccountUsage(forceRefresh = false) {
  if (!forceRefresh && cached && Date.now() - fetchedAt < CACHE_TTL_MS) return cached;
  const response = await fetch(`${BRAIN_URL}/api/brain/codex-usage`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`codex-slot usage snapshot HTTP ${response.status}`);
  cached = normalizeUsageSnapshot(await response.json());
  fetchedAt = Date.now();
  return cached;
}

module.exports = { getAllAccountUsage, normalizeUsageSnapshot };
