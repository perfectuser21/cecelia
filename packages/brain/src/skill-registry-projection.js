/**
 * skill-registry-projection.js — skill_registry → Notion「Skill Registry」投影（Skill 台账投影 PR1b，任务 47def5bb）
 *
 * 取代 notion-push-sync.pushSkillRegistry（旧的只推 4 列、挂在无防重入的 setInterval 上，09-28 因此重复建了 3 组页）。
 * 列级分权（决策 19391396）：机器列 Brain 单向覆盖；人管列三方基线合并（判定点 24736022）——
 *   Brain 值 == 基线 → 不发；Brain ≠ 基线 → 读 Notion 当前值：== 基线（人没动）才写，≠ 基线（人改过）不覆盖。
 *   两种情况基线都跟上 Brain 值，人改的值留给 PR3 回拉，人赢。
 * 列账（working_memory skill_registry_notion_columns）按列 id 认列：人改列名照写；人删列记 deleted_at 永不补建；
 *   人改列类型 → 跳过该列并记日志（不再像旧实现那样 400 就清 notion_id 导致整库重复建页）。
 * 防重入：advisory lock（专用连接）+ 2 分钟自 gate；建页前按标题查重认领；每日清一次机器人建的孤儿页。
 */
import { notionReq as defaultNotionReq } from './recurring-notion-sync.js';
import { isPageGoneError } from './lib/notion-projection-engine.js';
import {
  SKILL_REGISTRY_DB, COLUMNS, HUMAN_KEYS, machineValues, humanValues, machineDigest,
  fromNotionProp, sameValue, buildProps,
} from './lib/skill-registry-notion-props.js';

export const COLUMNS_KEY = 'skill_registry_notion_columns';
export const STATE_KEY = 'skill_registry_projection_state';
const LOCK_ID = 491002;
const GATE_MS = 2 * 60 * 1000;
const SWEEP_MS = 24 * 3600 * 1000;
const BATCH = 25;
const MAX_BACKOFF_MS = 24 * 3600 * 1000;
const ORPHAN_ARCHIVE_CAP = 30;
const DB_DESCRIPTION = 'Skill 台账：真身 = Brain skill_registry（每 2 小时扫三平台自动更新机器列）。'
  + 'Status / 目标平台 / 转OpenClaw难度 / 业务线 / 负责人 / 分类 / 备注 是人管列，可以在这里改，推送不会覆盖。'
  + '列可以删、可以改名，不影响同步。';

async function readJson(q, key) {
  const { rows } = await q.query('SELECT value_json FROM working_memory WHERE key = $1', [key]);
  let v = rows?.[0]?.value_json;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v && typeof v === 'object' ? v : null;
}

async function writeJson(q, key, value) {
  await q.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}

async function logSync(q, message, details) {
  await q.query(
    `INSERT INTO notion_sync_log (direction, records_synced, records_failed, error_message, details)
     VALUES ('skill_registry_push', 0, 1, $1, $2::jsonb)`,
    [String(message).slice(0, 500), JSON.stringify(details || {})],
  ).catch(() => {});
}

/** 解析列账：认领原有列、补建从没建过的列、识别被删/被改类型的列。返回 key → {name,type}（只含可写的列）。 */
async function resolveColumns(client, token, notionReq) {
  let db = await notionReq(token, `/databases/${SKILL_REGISTRY_DB}`, 'GET');
  const ledger = (await readJson(client, COLUMNS_KEY)) || {};
  const byId = new Map(Object.values(db.properties || {}).map((p) => [p.id, p]));
  const byName = db.properties || {};
  const toCreate = {};
  for (const col of COLUMNS) {
    const entry = ledger[col.key];
    if (entry?.deleted_at) continue;
    if (entry) {
      if (!byId.has(entry.id)) ledger[col.key] = { ...entry, deleted_at: new Date().toISOString() };
      continue;
    }
    const existing = byName[col.name];
    if (existing && existing.type === col.type) {
      ledger[col.key] = { id: existing.id, created_at: new Date().toISOString() };
    } else if (!existing && !col.existing) {
      toCreate[col.name] = { [col.type]: col.def || {} };
    }
  }
  const described = (db.description || []).map((t) => t.plain_text || '').join('');
  const patch = {};
  if (Object.keys(toCreate).length) patch.properties = toCreate;
  if (/只读镜子/.test(described)) patch.description = [{ type: 'text', text: { content: DB_DESCRIPTION } }];
  if (Object.keys(patch).length) {
    db = await notionReq(token, `/databases/${SKILL_REGISTRY_DB}`, 'PATCH', patch);
    for (const col of COLUMNS) {
      const created = db.properties?.[col.name];
      if (!ledger[col.key] && created && toCreate[col.name]) ledger[col.key] = { id: created.id, created_at: new Date().toISOString() };
    }
  }
  await writeJson(client, COLUMNS_KEY, ledger);

  const liveById = new Map(Object.values(db.properties || {}).map((p) => [p.id, p]));
  const colMap = {};
  for (const col of COLUMNS) {
    const entry = ledger[col.key];
    const live = entry && !entry.deleted_at ? liveById.get(entry.id) : null;
    if (!live) continue;
    if (live.type !== col.type) {
      await logSync(client, `Skill Registry 列「${live.name}」类型被改为 ${live.type}（期望 ${col.type}），本列跳过`, { key: col.key });
      continue;
    }
    colMap[col.key] = { name: live.name, type: live.type };
  }
  return colMap;
}

const ROW_SQL = `SELECT id, name, description, location, status, metadata, notion_id, platforms_installed, presence,
  last_seen_at, source_path, source_kind, assigned_agents, drift_copies, platforms_target, openclaw_tier, tier_suggested,
  business_line, category, note, notion_baseline, notion_push_attempts, notion_next_retry_at, updated_at
  FROM skill_registry`;

function baselineOf(row) {
  const b = { ...(row.notion_baseline || {}) };
  // 旧推送一直把 status 推进 Status 列：首轮视 Brain 现值为基线，免得 210 页全部回读
  if (!('status' in b) && row.notion_id) b.status = row.status || null;
  return b;
}

function needsPush(row, now) {
  if (row.notion_next_retry_at && new Date(row.notion_next_retry_at).getTime() > now) return false;
  if (!row.notion_id) return true;
  if (row.metadata?.pushed_digest !== machineDigest(machineValues(row))) return true;
  const base = baselineOf(row);
  const hv = humanValues(row);
  return HUMAN_KEYS.some((k) => !sameValue(hv[k], base[k]));
}

async function findPageByTitle(token, notionReq, name, boundIds) {
  const { results = [] } = await notionReq(token, `/databases/${SKILL_REGISTRY_DB}/query`, 'POST', {
    filter: { property: 'title', title: { equals: name } }, page_size: 20,
  });
  const free = results.filter((p) => !boundIds.has(p.id)).sort((a, b) => String(a.created_time).localeCompare(String(b.created_time)));
  return free;
}

/** 推一行。返回 { notionId, baseline }。 */
async function pushRow(row, ctx) {
  const { token, notionReq, colMap, boundIds, botUserId } = ctx;
  const mv = machineValues(row);
  const hv = humanValues(row);
  const base = baselineOf(row);
  let notionId = row.notion_id;
  let page = null;

  if (!notionId) {
    const free = await findPageByTitle(token, notionReq, row.name, boundIds);
    if (free.length) {
      page = free[0];
      notionId = page.id;
      for (const dup of free.slice(1)) {
        if (dup.created_by?.id === botUserId) await notionReq(token, `/pages/${dup.id}`, 'PATCH', { archived: true });
      }
    } else {
      const humanPresent = Object.fromEntries(HUMAN_KEYS.map((k) => [k, hv[k]]));
      const created = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: SKILL_REGISTRY_DB },
        properties: buildProps({ ...mv, ...humanPresent }, colMap),
      });
      return { notionId: created.id, baseline: humanPresent };
    }
  }

  const nextBase = { ...base };
  const humanOut = {};
  const changed = HUMAN_KEYS.filter((k) => !sameValue(hv[k], base[k]));
  if (changed.length) {
    page ||= await notionReq(token, `/pages/${notionId}`, 'GET');
    for (const k of changed) {
      const col = colMap[k];
      const current = col ? fromNotionProp(page.properties?.[col.name]) : null;
      if (col && sameValue(current, base[k])) humanOut[k] = hv[k];
      nextBase[k] = hv[k];
    }
  }
  await notionReq(token, `/pages/${notionId}`, 'PATCH', { properties: buildProps({ ...mv, ...humanOut }, colMap) });
  return { notionId, baseline: nextBase };
}

async function markPushed(client, row, { notionId, baseline }) {
  await client.query(
    `UPDATE skill_registry
        SET notion_id = $2, notion_baseline = $3::jsonb,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pushed_digest', $4::text),
            notion_push_attempts = 0, notion_next_retry_at = NULL, notion_synced_at = NOW()
      WHERE id = $1`,
    [row.id, notionId, JSON.stringify(baseline), machineDigest(machineValues(row))],
  );
}

async function markFailed(client, row, err, now) {
  if (isPageGoneError(err)) {
    await client.query(
      `UPDATE skill_registry SET notion_id = NULL, notion_baseline = '{}'::jsonb, metadata = metadata - 'pushed_digest' WHERE id = $1`,
      [row.id],
    );
    return;
  }
  const delay = Math.min(5 * 60 * 1000 * 2 ** (row.notion_push_attempts || 0), MAX_BACKOFF_MS);
  await client.query(
    'UPDATE skill_registry SET notion_push_attempts = notion_push_attempts + 1, notion_next_retry_at = $2 WHERE id = $1',
    [row.id, new Date(now + delay).toISOString()],
  );
  if ((row.notion_push_attempts || 0) + 1 >= 5) await logSync(client, `skill ${row.name} 连续 5 次推送失败：${err.message}`, { id: row.id });
}

async function sweepOrphans(token, notionReq, boundIds, botUserId) {
  let cursor;
  let archived = 0;
  do {
    const res = await notionReq(token, `/databases/${SKILL_REGISTRY_DB}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const p of res.results || []) {
      if (archived >= ORPHAN_ARCHIVE_CAP) return archived;
      if (boundIds.has(p.id) || p.created_by?.id !== botUserId) continue;
      await notionReq(token, `/pages/${p.id}`, 'PATCH', { archived: true });
      archived++;
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return archived;
}

/**
 * scheduler-jobs handler（needsPool:true）。自 gate 2min；调度轮 60s 都会调用。
 * @param {import('pg').Pool} pool
 * @param {object} [opts] 测试注入：token / notionReq / now / force / botUserId / sweepOrphans / limit / names（只推这些名字，冒烟用）
 */
export async function runSkillRegistryProjection(pool, opts = {}) {
  const token = 'token' in opts ? opts.token : process.env.NOTION_API_KEY;
  if (!token) return { skipped: true, reason: 'no_token' };
  const { notionReq = defaultNotionReq, now = Date.now(), force = false, limit = BATCH } = opts;
  const client = await pool.connect();
  let locked = false;
  let destroy = false;
  try {
    locked = Boolean((await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID])).rows?.[0]?.locked);
    if (!locked) return { skipped: true, reason: 'locked' };
    const state = (await readJson(client, STATE_KEY)) || {};
    const last = Date.parse(state.last_run_at);
    if (!force && Number.isFinite(last) && now - last < GATE_MS) return { skipped: true, reason: 'interval_gate' };

    const colMap = await resolveColumns(client, token, notionReq);
    const { rows } = await client.query(ROW_SQL);
    const boundIds = new Set(rows.filter((r) => r.notion_id).map((r) => r.notion_id));
    const botUserId = opts.botUserId || (await notionReq(token, '/users/me', 'GET')).id;
    const scoped = Array.isArray(opts.names) ? rows.filter((r) => opts.names.includes(r.name)) : rows;
    const todo = scoped.filter((r) => needsPush(r, now))
      .sort((a, b) => (a.notion_push_attempts || 0) - (b.notion_push_attempts || 0)
        || new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
      .slice(0, limit);

    let pushed = 0;
    let failed = 0;
    for (const row of todo) {
      try {
        const res = await pushRow(row, { token, notionReq, colMap, boundIds, botUserId });
        boundIds.add(res.notionId);
        await markPushed(client, row, res);
        pushed++;
      } catch (err) {
        failed++;
        console.warn(`[skill-registry-projection] ${row.name} 推送失败：${err.message}`);
        await markFailed(client, row, err, now);
      }
    }

    const lastSweep = Date.parse(state.last_sweep_at);
    let orphans = null;
    if (opts.sweepOrphans || !Number.isFinite(lastSweep) || now - lastSweep >= SWEEP_MS) {
      orphans = await sweepOrphans(token, notionReq, boundIds, botUserId);
    }
    await writeJson(client, STATE_KEY, {
      ...state, last_run_at: new Date(now).toISOString(), pushed, failed, pending: Math.max(0, scoped.filter((r) => needsPush(r, now)).length - pushed),
      columns: Object.keys(colMap).length,
      ...(orphans !== null ? { last_sweep_at: new Date(now).toISOString(), orphans_archived: orphans } : {}),
    });
    return { ok: true, pushed, failed, columns: Object.keys(colMap).length, orphans };
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => { destroy = true; });
    }
    client.release(destroy);
  }
}
