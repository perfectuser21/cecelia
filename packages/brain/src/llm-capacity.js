import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getAccountUsage } from './account-usage.js';
import pool from './db.js';

const CACHE_TTL_MS = 60 * 1000;
const USABLE_THRESHOLD = 90;

const GROK_ACCOUNTS = [
  { vendor: 'grok', name: 'grok', home: join(homedir(), '.grok') },
];

let _cachedSnapshot = null;
let _cachedAt = 0;

function buildVendorLedger(vendor, accounts, error = null) {
  const available = accounts.filter((account) => account.available);
  return {
    vendor,
    available_count: available.length,
    total_count: accounts.length,
    poller: error ? 'error' : 'ok',
    error,
    accounts,
  };
}

function buildCapacityDigest(snapshot) {
  const digest = { sampled_at: snapshot.sampled_at, sentinel: snapshot.sentinel, vendors: {} };
  for (const [vendor, ledger] of Object.entries(snapshot.vendors)) {
    digest.vendors[vendor] = {
      available_count: ledger.available_count,
      total_count: ledger.total_count,
      poller: ledger.poller,
    };
  }
  return digest;
}

async function pollClaudeLedger() {
  const usage = await getAccountUsage();
  const accounts = Object.values(usage).map((row) => ({
    vendor: 'claude',
    name: row.account_id,
    available: !(row.spendingCapped || row.authFailed || row.extraUsed || (row.five_hour_pct ?? 100) >= USABLE_THRESHOLD),
    used_percent: row.five_hour_pct ?? 100,
    seven_day_pct: row.seven_day_pct ?? null,
    source: row.cached ? 'usage_cache' : 'usage_api',
  }));
  return buildVendorLedger('claude', accounts);
}

async function pollCodexLedger() {
  // codex-slot-broker is the sole issuer; capacity reads its no-secret projection.
  const result = await pool.query(
    `SELECT account_id, five_hour_pct, seven_day_pct
       FROM account_usage_cache
      WHERE fetched_at > NOW() - INTERVAL '15 minutes'
      ORDER BY account_id`,
  );
  const accounts = result.rows.map(row => ({
    vendor: 'codex',
    name: row.account_id,
    available: Number(row.five_hour_pct) < USABLE_THRESHOLD,
    used_percent: Number(row.five_hour_pct),
    seven_day_pct: Number(row.seven_day_pct),
    source: 'account_usage_cache',
  }));
  return buildVendorLedger('codex', accounts);
}

async function pollGrokLedger() {
  const accounts = GROK_ACCOUNTS.map((account) => {
    const authPath = join(account.home, 'auth.json');
    const available = existsSync(authPath);
    return {
      ...account,
      available,
      used_percent: null,
      source: available ? 'auth_presence' : 'auth_missing',
    };
  });
  return buildVendorLedger('grok', accounts);
}

export function chooseGuidedExecutor(taskType, budgetState, snapshot) {
  if (!snapshot?.vendors) return null;
  const vendors = snapshot?.vendors || {};
  const claudeAvailable = (vendors.claude?.available_count || 0) > 0;
  const codexAvailable = (vendors.codex?.available_count || 0) > 0;
  const grokAvailable = (vendors.grok?.available_count || 0) > 0;
  const prefersCodex = budgetState === 'tight' || budgetState === 'critical';
  const primary = prefersCodex ? 'codex' : 'claude';
  const fallback = prefersCodex ? 'claude' : 'codex';

  if (primary === 'claude' && claudeAvailable) {
    return { executor: 'claude', level: 'L1_primary_claude', reason: 'primary_vendor_available' };
  }
  if (primary === 'codex' && codexAvailable) {
    return { executor: 'codex', level: 'L2_primary_codex', reason: 'primary_vendor_available' };
  }
  if (fallback === 'claude' && claudeAvailable) {
    return { executor: 'claude', level: 'L3_cross_vendor_fallback', reason: 'primary_vendor_unavailable' };
  }
  if (fallback === 'codex' && codexAvailable) {
    return { executor: 'codex', level: 'L3_cross_vendor_fallback', reason: 'primary_vendor_unavailable' };
  }
  if (grokAvailable) {
    return { executor: 'grok', level: 'L4_grok_fallback', reason: 'all_metered_vendors_unavailable' };
  }

  return {
    executor: primary,
    level: 'L4_fail_open',
    reason: 'llm_capacity_exhausted_fail_open',
  };
}

export async function getLlmCapacitySnapshot(opts = {}) {
  const forceRefresh = opts.forceRefresh === true;
  const now = Date.now();
  if (!forceRefresh && _cachedSnapshot && (now - _cachedAt) < CACHE_TTL_MS) {
    return _cachedSnapshot;
  }

  const errors = [];
  const vendors = {};

  try {
    vendors.claude = await pollClaudeLedger();
  } catch (error) {
    errors.push(`claude:${error.message}`);
    vendors.claude = buildVendorLedger('claude', [], error.message);
  }

  try {
    vendors.codex = await pollCodexLedger();
  } catch (error) {
    errors.push(`codex:${error.message}`);
    vendors.codex = buildVendorLedger('codex', [], error.message);
  }

  try {
    vendors.grok = await pollGrokLedger();
  } catch (error) {
    errors.push(`grok:${error.message}`);
    vendors.grok = buildVendorLedger('grok', [], error.message);
  }

  const anyAvailable = Object.values(vendors).some((ledger) => ledger.available_count > 0);
  const sentinel = errors.length > 0 ? 'degraded' : (anyAvailable ? 'ok' : 'exhausted');
  const snapshot = {
    sampled_at: new Date().toISOString(),
    cache_ttl_ms: CACHE_TTL_MS,
    healthy: sentinel === 'ok',
    sentinel,
    errors,
    vendors,
  };

  _cachedSnapshot = snapshot;
  _cachedAt = now;
  return snapshot;
}

export function summarizeLlmCapacity(snapshot) {
  if (!snapshot) return null;
  return buildCapacityDigest(snapshot);
}

export function clearLlmCapacityCache() {
  _cachedSnapshot = null;
  _cachedAt = 0;
}
