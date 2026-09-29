/**
 * skill-inventory-sync.js — 三平台 skill 扫描入账（Skill 台账投影 PR1a，任务 47def5bb，F5 指挥舱 f20ec1cb）
 *
 * 每 2h：经 ssh mmv 执行自包含采集程序（lib/skill-inventory-remote.js）→ 归并判定（lib/skill-inventory-reconcile.js）
 * → 事务内写 skill_registry 机器列与 presence。人管列与 status 一律不碰（列级分权，决策 19391396）。
 *
 * 纪律：
 *  - us-vps 零执行：Brain 只送程序、读 JSON，不在本机扫任何东西。
 *  - 防重入：pg_try_advisory_lock（专用连接）+ 开跑即写 started_at（scheduler 超时不取消执行，gate 必须先落）。
 *  - 探不到 ≠ 零个：ssh 失败/输出不合法 → 只记 last_error 不动行；来源 fail / 跑场机清单过期 / 骤降熔断 → 不判缺席。
 *  - 没变化不写：upsert 带 IS DISTINCT FROM，updated_at 不动（推送按 updated_at 排序，防抖动）；last_seen_at 单独批量刷。
 */
import { existsSync } from 'fs';
import { defaultExecAsync, buildHostCmd } from './host-exec.js';
import { buildRemoteProgram, buildRemoteShell } from './lib/skill-inventory-remote.js';
import { buildRecords, trippedSources, decideAbsent } from './lib/skill-inventory-reconcile.js';

export const INVENTORY_STATE_KEY = 'skill_inventory_state';
export const SCAN_INTERVAL_MS = 2 * 3600 * 1000;
export const EXEC_TIMEOUT_MS = 170_000;
const LOCK_ID = 491001;
const SSH = 'ssh -o BatchMode=yes -o ConnectTimeout=10';
const MACHINE_COLS = ['description', 'platforms_installed', 'source_path', 'source_kind', 'assigned_agents',
  'content_md', 'content_digest', 'copies', 'drift_copies', 'files', 'tier_suggested'];
// IS DISTINCT FROM 行比较里每一列的 SQL 类型，须与 skill_registry 实际列类型/EXCLUDED 表达式类型逐一对齐，
// 否则匿名 ROW() 构造会因两侧类型不一致报 42804（尤其 TEXT[] / JSONB 这类非标量列）。
const MACHINE_COL_CAST = {
  description: 'text', platforms_installed: 'text[]', source_path: 'text', source_kind: 'text',
  assigned_agents: 'text[]', content_md: 'text', content_digest: 'text', copies: 'jsonb',
  drift_copies: 'int', files: 'text[]', tier_suggested: 'text',
};

export function buildInventoryCmd({ program, inContainer, keyExistsFn }) {
  const remote = buildRemoteShell(program);
  return buildHostCmd(`${SSH} mmv '${remote}'`, inContainer, keyExistsFn);
}

async function readJson(q, key) {
  const { rows } = await q.query('SELECT value_json FROM working_memory WHERE key = $1', [key]);
  let v = rows?.[0]?.value_json;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v && typeof v === 'object' ? v : null;
}

async function writeState(q, state) {
  await q.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [INVENTORY_STATE_KEY, JSON.stringify(state)],
  );
}

const briefError = (err) => String(err?.stderr || err?.message || err).split('\n').find((l) => l.trim() && !l.startsWith('Command failed'))?.slice(0, 200) || 'exec failed';

async function upsertRecord(c, r, nowIso) {
  const vals = [r.name, r.description, r.platforms_installed, r.source_path, r.source_kind, r.assigned_agents,
    r.content_md, r.content_digest, JSON.stringify(r.copies), r.drift_copies, r.files, r.tier_suggested, nowIso];
  const set = MACHINE_COLS.map((col) => (col === 'description'
    ? 'description = COALESCE(EXCLUDED.description, skill_registry.description)'
    : `${col} = EXCLUDED.${col}`)).join(', ');
  // 两侧显式转型（skill_registry.<col>::<type>、EXCLUDED.<col>::<type>）：composite ROW() IS DISTINCT FROM
  // 要求逐列类型一致，不转会在 TEXT[]/JSONB 列上报 42804（代审实测复现，brief 原文没转导致集成测试首跑报错）。
  const cur = MACHINE_COLS.map((col) => `skill_registry.${col}::${MACHINE_COL_CAST[col]}`).join(', ');
  const next = MACHINE_COLS.map((col) => (col === 'description'
    ? `COALESCE(EXCLUDED.description, skill_registry.description)::${MACHINE_COL_CAST.description}`
    : `EXCLUDED.${col}::${MACHINE_COL_CAST[col]}`)).join(', ');
  const { rowCount } = await c.query(
    `INSERT INTO skill_registry (name, description, location, status, presence, platforms_installed, source_path, source_kind,
       assigned_agents, content_md, content_digest, copies, drift_copies, files, tier_suggested, last_seen_at, last_scanned_at)
     VALUES ($1, $2, $5::text, 'active', 'present', $3, $4, $5::text, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $13)
     ON CONFLICT (name) DO UPDATE SET ${set}, presence = 'present', absent_since = NULL, updated_at = NOW()
     WHERE (${cur}, skill_registry.presence, skill_registry.absent_since)
       IS DISTINCT FROM (${next}, 'present'::text, NULL::timestamptz)`,
    vals,
  );
  return rowCount;
}

async function markAbsent(c, { brokenNames, canJudge, now, seen }) {
  const { rows } = await c.query(
    `SELECT name, presence, absent_since FROM skill_registry WHERE NOT (name = ANY($1::text[])) AND presence <> 'gone'`, [seen]);
  let marked = 0;
  for (const row of rows) {
    const next = decideAbsent(
      { presence: row.presence, absent_since: row.absent_since ? new Date(row.absent_since).toISOString() : null },
      { isBroken: brokenNames.has(row.name), canJudge, now },
    );
    const prevSince = row.absent_since ? new Date(row.absent_since).toISOString() : null;
    if (next.presence === row.presence && next.absent_since === prevSince) continue;
    const bump = next.presence !== row.presence ? ', updated_at = NOW()' : '';
    await c.query(
      `UPDATE skill_registry SET presence = $2, absent_since = $3, last_scanned_at = $4${bump} WHERE name = $1`,
      [row.name, next.presence, next.absent_since, new Date(now).toISOString()],
    );
    marked++;
  }
  return marked;
}

/**
 * scheduler-jobs handler（needsPool:true）。自 gate 2h；调度轮 60s 都会调用。
 * @param {import('pg').Pool} pool
 * @param {object} [opts] 供测试注入：exec / now / force / inContainer / keyExistsFn / programOpts
 */
export async function runSkillInventorySync(pool, opts = {}) {
  const { exec = defaultExecAsync, now = Date.now(), force = false, keyExistsFn, programOpts = {} } = opts;
  const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
  const client = await pool.connect();
  let locked = false;
  let destroyConn = false;
  try {
    locked = Boolean((await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID])).rows?.[0]?.locked);
    if (!locked) return { skipped: true, reason: 'locked' };
    const prev = (await readJson(client, INVENTORY_STATE_KEY)) || {};
    const last = Date.parse(prev.started_at);
    if (!force && Number.isFinite(last) && now - last < SCAN_INTERVAL_MS) return { skipped: true, reason: 'interval_gate' };
    const state = { ...prev, started_at: new Date(now).toISOString(), last_error: null };
    await writeState(client, state);

    let inventory;
    try {
      const raw = await exec(buildInventoryCmd({ program: buildRemoteProgram(programOpts), inContainer, keyExistsFn }), { timeoutMs: EXEC_TIMEOUT_MS });
      inventory = JSON.parse(raw);
      if (!inventory?.ok) throw new Error(`remote: ${inventory?.error || 'not ok'}`);
    } catch (err) {
      const error = briefError(err);
      await writeState(client, { ...state, finished_at: new Date().toISOString(), last_error: error });
      console.warn(`[skill-inventory-sync] 采集失败（未核对，不动任何行）：${error}`);
      return { ok: false, error };
    }

    const driftState = await readJson(client, 'skill_manifest_drift');
    const { records, sourcesOk, brokenNames, counts } = buildRecords(inventory, { driftState, now });
    const tripped = trippedSources(prev.last_ok_counts, counts);
    const canJudge = sourcesOk && tripped.length === 0;
    const nowIso = new Date(now).toISOString();
    let upserted = 0;
    let marked = 0;
    await client.query('BEGIN');
    try {
      for (const r of records) upserted += await upsertRecord(client, r, nowIso);
      const seen = records.map((r) => r.name);
      await client.query('UPDATE skill_registry SET last_seen_at = $2, last_scanned_at = $2 WHERE name = ANY($1::text[])', [seen, nowIso]);
      marked = await markAbsent(client, { brokenNames, canJudge, now, seen });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch((rollbackErr) => {
        destroyConn = true;
        console.warn(`[skill-inventory-sync] ROLLBACK 失败，连接将被销毁：${rollbackErr.message}`);
      });
      throw err;
    }

    const sources = Object.fromEntries(Object.entries(inventory.sources || {})
      .map(([k, v]) => [k, { status: v?.status, count: counts[k], ...(v?.error ? { error: String(v.error).slice(0, 200) } : {}) }]));
    await writeState(client, {
      ...state, finished_at: new Date().toISOString(), sources, counts, tripped, upserted, marked,
      ...(sourcesOk ? { last_ok_at: nowIso, last_ok_counts: counts } : {}),
    });
    if (!canJudge) console.warn(`[skill-inventory-sync] 本轮不判缺席：来源齐=${sourcesOk} 熔断=${tripped.join(',') || '-'}`);
    return { ok: true, upserted, marked, sourcesOk, tripped };
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch((err) => {
        destroyConn = true;
        console.warn(`[skill-inventory-sync] 解锁失败，连接将被销毁而非回池：${err.message}`);
      });
    }
    // 解锁/回滚失败时连接可能仍带会话锁/处于事务残留态，销毁而非放回池（会话锁随连接关闭自动释放）。
    client.release(destroyConn);
  }
}
