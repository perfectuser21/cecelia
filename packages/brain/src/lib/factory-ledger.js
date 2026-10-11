/**
 * 技能工厂台账（迁移 547；任务 1c589b13；决策 cc008b7e / 2bb08a99）。
 *
 * 一条业务 workflow 一行台账。阶段只经 transitionLedger 改，每次改都落一条只追加事件：
 *   - actor=human：任意跳 / 退（人工优先，留痕）
 *   - actor=rule / agent：只允许相邻推进（n→n+1）或 RULE_RETREATS 登记的退回；
 *     blocked_kind 为 human_gate / safety（两个人工关口）时不能动
 * 记运行结果维护最近 window_k 次滑窗（同 run_id 在窗内去重），降级次数单独累计。
 * db 可以是 pg.Pool（自起事务）或已连接的 pg.Client（用 SAVEPOINT，适配外层事务）。
 */

export const STAGE_NAMES = Object.freeze({ 1: '试跑', 2: '摸边界', 3: '验证', 4: '沉淀', 5: '上线跑', 6: '蒸馏', 7: '晋级/守护' });
export const VALIDATION_MODES = Object.freeze(['use_while_validate', 'validate_before_release']);
export const BLOCKED_KINDS = Object.freeze(['none', 'human_gate', 'resource', 'safety']);
export const ACTORS = Object.freeze(['rule', 'human', 'agent']);
const HUMAN_ONLY_BLOCKS = new Set(['human_gate', 'safety']);
/** 推进器可执行的退回：验证不过回摸边界、上线跑劣化回验证、蒸馏版不达标回上线跑、守护劣化回蒸馏。 */
export const RULE_RETREATS = Object.freeze({ 3: [2], 5: [3], 6: [5], 7: [6] });
export const DEFAULT_WINDOW_K = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
export const isStage = (v) => Number.isInteger(v) && v >= 1 && v <= 7;
const httpError = (status, code, message) => Object.assign(new Error(message || code), { status, code });
const bad = (message) => httpError(400, 'INVALID_INPUT', message);
const optText = (body, key) => {
  if (body[key] === undefined || body[key] === null) return body[key];
  if (typeof body[key] !== 'string') throw bad(`${key} must be a string`);
  return body[key];
};
const toInt = (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);

export function checkTransition({ from, to, actor, blockedKind = 'none' }) {
  if (!isStage(from) || !isStage(to)) return { ok: false, code: 'INVALID_STAGE', message: 'stage must be an integer in 1..7' };
  if (from === to) return { ok: false, code: 'SAME_STAGE', message: `already at stage ${to}` };
  const kind = to === from + 1 ? 'advance' : to < from ? 'retreat' : 'jump';
  if (actor === 'human') return { ok: true, kind };
  if (HUMAN_ONLY_BLOCKS.has(blockedKind)) return { ok: false, code: 'BLOCKED_NEEDS_HUMAN', message: `blocked_kind=${blockedKind}，只有 human 能改阶段` };
  if (kind === 'advance') return { ok: true, kind };
  if (kind === 'retreat' && (RULE_RETREATS[from] || []).includes(to)) return { ok: true, kind };
  return { ok: false, code: 'ILLEGAL_TRANSITION', message: `${actor} 不允许 ${from}→${to}（只允许相邻推进或规定退回）` };
}

/** 纯函数：把一次运行并入滑窗（outcome=null 时只按 windowK 截尾重算）。 */
export function applyRunOutcome(runs, outcome, windowK) {
  let next = Array.isArray(runs) ? [...runs] : [];
  let duplicate = false;
  if (outcome) {
    duplicate = next.some((r) => r.run_id === outcome.runId);
    if (!duplicate) next.push({ run_id: outcome.runId, pass: outcome.pass, ...(outcome.degraded ? { degraded: true } : {}), at: outcome.at });
  }
  next = next.slice(-windowK);
  return { runs: duplicate ? runs : next, duplicate, recentPass: next.filter((r) => r.pass === true).length, recentTotal: next.length };
}

function validateWindowK(v) {
  const n = toInt(v);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw bad('window_k must be an integer in 1..100');
  return n;
}

export function validateCreate(body = {}) {
  if (!isUuid(body.workflow_id)) throw bad('workflow_id must be a uuid');
  const stage = body.stage === undefined ? 1 : toInt(body.stage);
  if (!isStage(stage)) throw bad('stage must be an integer in 1..7');
  const validationMode = body.validation_mode ?? 'use_while_validate';
  if (!VALIDATION_MODES.includes(validationMode)) throw bad(`validation_mode must be one of ${VALIDATION_MODES.join('|')}`);
  const actor = body.actor ?? 'human';
  if (!ACTORS.includes(actor)) throw bad(`actor must be one of ${ACTORS.join('|')}`);
  return {
    workflowId: body.workflow_id, stage, validationMode, actor,
    windowK: body.window_k === undefined ? DEFAULT_WINDOW_K : validateWindowK(body.window_k),
    productionVersion: optText(body, 'production_version') ?? null,
    candidateVersion: optText(body, 'candidate_version') ?? null,
    nextAction: optText(body, 'next_action') ?? null,
    reason: optText(body, 'reason') || '进厂',
    actorName: optText(body, 'actor_name') ?? null,
  };
}

const PATCHABLE = ['validation_mode', 'production_version', 'candidate_version', 'window_k', 'next_action', 'blocked_reason', 'blocked_kind'];
export function validatePatch(body = {}) {
  if (body.stage !== undefined) throw bad('stage 不能 PATCH，改阶段走 POST /factory/ledger/:id/transition');
  const out = {};
  for (const key of PATCHABLE) {
    if (body[key] === undefined) continue;
    if (key === 'window_k') out.window_k = validateWindowK(body.window_k);
    else if (key === 'validation_mode') {
      if (!VALIDATION_MODES.includes(body[key])) throw bad(`validation_mode must be one of ${VALIDATION_MODES.join('|')}`);
      out[key] = body[key];
    } else if (key === 'blocked_kind') {
      if (!BLOCKED_KINDS.includes(body[key])) throw bad(`blocked_kind must be one of ${BLOCKED_KINDS.join('|')}`);
      out[key] = body[key];
    } else out[key] = optText(body, key);
  }
  if (!Object.keys(out).length) throw bad(`没有可改字段（可改：${PATCHABLE.join(', ')}）`);
  return out;
}

export function validateTransition(body = {}) {
  const toStage = toInt(body.to_stage);
  if (!isStage(toStage)) throw bad('to_stage must be an integer in 1..7');
  if (!ACTORS.includes(body.actor)) throw bad(`actor must be one of ${ACTORS.join('|')}`);
  if (typeof body.reason !== 'string' || !body.reason.trim()) throw bad('reason is required');
  const ev = body.evidence_run_ids ?? [];
  if (!Array.isArray(ev) || ev.some((x) => typeof x !== 'string' || !x)) throw bad('evidence_run_ids must be an array of run id strings');
  let expectedFromStage = null;
  if (body.expected_from_stage !== undefined && body.expected_from_stage !== null) {
    expectedFromStage = toInt(body.expected_from_stage);
    if (!isStage(expectedFromStage)) throw bad('expected_from_stage must be an integer in 1..7');
  }
  return {
    toStage, actor: body.actor, reason: body.reason.trim(), evidenceRunIds: ev, expectedFromStage,
    actorName: optText(body, 'actor_name') ?? null, resetWindow: body.reset_window !== false,
  };
}

export function validateRun(body = {}) {
  if (typeof body.run_id !== 'string' || !body.run_id.trim()) throw bad('run_id is required');
  if (typeof body.pass !== 'boolean') throw bad('pass must be a boolean');
  if (body.degraded !== undefined && typeof body.degraded !== 'boolean') throw bad('degraded must be a boolean');
  return { runId: body.run_id.trim(), pass: body.pass, degraded: body.degraded === true };
}

async function withTx(db, fn) {
  if (typeof db.totalCount === 'number') {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }
  await db.query('SAVEPOINT factory_ledger_tx');
  try {
    const out = await fn(db);
    await db.query('RELEASE SAVEPOINT factory_ledger_tx');
    return out;
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT factory_ledger_tx').catch(() => {});
    throw e;
  }
}

const SELECT_LEDGER = `SELECT l.*, w.key AS workflow_key, w.name AS workflow_name, w.status AS workflow_status
  FROM factory_ledger l JOIN workflows w ON w.id = l.workflow_id`;
const decorate = (row) => row && ({ ...row, stage_name: STAGE_NAMES[row.stage] });

async function lockLedger(client, id) {
  const row = (await client.query('SELECT * FROM factory_ledger WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!row) throw httpError(404, 'LEDGER_NOT_FOUND', 'factory ledger row not found');
  return row;
}
const readLedger = async (db, id) => decorate((await db.query(`${SELECT_LEDGER} WHERE l.id = $1`, [id])).rows[0]);
const insertEvent = async (client, e) => (await client.query(
  `INSERT INTO factory_stage_events (ledger_id, from_stage, to_stage, reason, evidence_run_ids, actor, actor_name)
   VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING *`,
  [e.ledgerId, e.fromStage, e.toStage, e.reason, JSON.stringify(e.evidenceRunIds || []), e.actor, e.actorName],
)).rows[0];

export async function listLedger(db, { stage = null, workflowId = null, limit = 100 } = {}) {
  const { rows } = await db.query(
    `${SELECT_LEDGER} WHERE ($1::smallint IS NULL OR l.stage = $1) AND ($2::uuid IS NULL OR l.workflow_id = $2)
     ORDER BY l.stage DESC, l.updated_at DESC LIMIT $3`, [stage, workflowId, limit]);
  return rows.map(decorate);
}

export async function getLedger(db, id, { eventsLimit = 50 } = {}) {
  const ledger = await readLedger(db, id);
  if (!ledger) return null;
  const events = (await db.query('SELECT * FROM factory_stage_events WHERE ledger_id = $1 ORDER BY id DESC LIMIT $2', [id, eventsLimit])).rows.reverse();
  return { ledger, events };
}

export async function createLedger(db, body) {
  const v = validateCreate(body);
  return withTx(db, async (client) => {
    if (!(await client.query('SELECT 1 FROM workflows WHERE id = $1', [v.workflowId])).rows.length) throw httpError(404, 'WORKFLOW_NOT_FOUND', 'workflow not found');
    const ins = await client.query(
      `INSERT INTO factory_ledger (workflow_id, stage, validation_mode, window_k, production_version, candidate_version, next_action)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (workflow_id) DO NOTHING RETURNING id`,
      [v.workflowId, v.stage, v.validationMode, v.windowK, v.productionVersion, v.candidateVersion, v.nextAction]);
    if (!ins.rows.length) throw httpError(409, 'LEDGER_EXISTS', 'this workflow already has a factory ledger row');
    const id = ins.rows[0].id;
    const event = await insertEvent(client, { ledgerId: id, fromStage: null, toStage: v.stage, reason: v.reason, actor: v.actor, actorName: v.actorName });
    return { ledger: await readLedger(client, id), event };
  });
}

export async function patchLedger(db, id, body) {
  const fields = validatePatch(body);
  return withTx(db, async (client) => {
    const row = await lockLedger(client, id);
    const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
    const params = [id, ...Object.values(fields)];
    if (fields.window_k !== undefined) {
      const w = applyRunOutcome(row.recent_runs, null, fields.window_k);
      sets.push(`recent_runs = $${params.length + 1}::jsonb`, `recent_pass = ${w.recentPass}`, `recent_total = ${w.recentTotal}`);
      params.push(JSON.stringify(w.runs));
    }
    await client.query(`UPDATE factory_ledger SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    return { ledger: await readLedger(client, id) };
  });
}

export async function transitionLedger(db, id, body) {
  const v = validateTransition(body);
  return withTx(db, async (client) => {
    const row = await lockLedger(client, id);
    if (v.expectedFromStage !== null && v.expectedFromStage !== row.stage)
      throw httpError(409, 'STAGE_CONFLICT', `expected_from_stage=${v.expectedFromStage}，当前阶段=${row.stage}`);
    const check = checkTransition({ from: row.stage, to: v.toStage, actor: v.actor, blockedKind: row.blocked_kind });
    if (!check.ok) throw httpError(check.code === 'BLOCKED_NEEDS_HUMAN' ? 409 : 400, check.code, check.message);
    await client.query(
      `UPDATE factory_ledger SET stage = $2, stage_changed_at = now(), updated_at = now()
         ${v.resetWindow ? ", recent_runs = '[]'::jsonb, recent_pass = 0, recent_total = 0" : ''}
       WHERE id = $1`, [id, v.toStage]);
    const event = await insertEvent(client, {
      ledgerId: id, fromStage: row.stage, toStage: v.toStage, reason: v.reason, evidenceRunIds: v.evidenceRunIds, actor: v.actor, actorName: v.actorName,
    });
    return { ledger: await readLedger(client, id), event, kind: check.kind };
  });
}

export async function recordRun(db, id, body) {
  const v = validateRun(body);
  return withTx(db, async (client) => {
    const row = await lockLedger(client, id);
    const w = applyRunOutcome(row.recent_runs, { ...v, at: new Date().toISOString() }, row.window_k);
    if (!w.duplicate) {
      await client.query(
        `UPDATE factory_ledger SET recent_runs = $2::jsonb, recent_pass = $3, recent_total = $4,
           total_runs = total_runs + 1, degrade_count = degrade_count + $5, updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(w.runs), w.recentPass, w.recentTotal, v.degraded ? 1 : 0]);
    }
    return { ledger: await readLedger(client, id), duplicate: w.duplicate };
  });
}
