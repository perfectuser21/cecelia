/**
 * business-probe-judge：业务探针判定（棒3a，任务 33aa2bc4，决策 702949b6 / 95e29afd）。
 *
 * 一条线：run.finished（lib/task-run.js finishRun 单点发）→ 按 task 的 payload.anchor.journey_id
 * + result.stage 查 step_probes ⋈ journey_step_links → 逐条比对 observed（task_runs.result.probes）
 * 与 expected（spec.expect.value 或 expect.ref → result.metrics.<k>）→ 写 journey_assertion_receipts
 * （executor_kind=business_probe_runner）→ UPDATE journey_step_links.cell_status 翻色。
 *
 * 分层：judgeProbes / cellStatusFor / normalizeProbes / aggregateCellStatus 纯逻辑不碰 DB；
 * handleRunFinished 走注入 pool（默认 db.js）。全程 fail-open：任何异常只 warn，永不拖垮 finishRun。
 *
 * 合同（棒1/棒2）：result = {stage, stage_status, metrics, evidence, probes:[{key, observed, probed_at, error?}]}；
 * step_probes(probe_key UNIQUE, stage, journey_step_link_id, spec jsonb, spec_hash, severity, active)，
 * spec = {key, stage, journey_cell, probe:{...}, expect:{op, value?|ref?}, severity}。
 * 只判 active=true：仓库 YAML 删探针后库行置 active=false（棒2 漂移语义），停用探针不得再以
 * probe_missing 把格子打红。
 */

import { persistBusinessProbeReceipt } from '../impact-contract/assertion-receipts.js';

export const SUPPORTED_OPS = Object.freeze(['>=', '==', '<=', 'not_null_all']);

const CELL_RANK = Object.freeze({ red: 3, pending: 2, green: 1 });

/**
 * probes 两种形状归一：数组 [{key,...}] 或对象 {key:{...}} → Map<key, {key, observed, probed_at?, error?}>。
 */
export function normalizeProbes(probes) {
  const map = new Map();
  if (Array.isArray(probes)) {
    for (const p of probes) {
      if (p && typeof p === 'object' && typeof p.key === 'string') map.set(p.key, p);
    }
  } else if (probes && typeof probes === 'object') {
    for (const [key, p] of Object.entries(probes)) {
      if (p && typeof p === 'object') map.set(key, { key, ...p });
    }
  }
  return map;
}

function readPath(root, path) {
  let cur = root;
  for (const seg of String(path).split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** expect.value 直取；expect.ref="metrics.x" 解析 result.metrics.x。未解析到 → {ok:false}。 */
function resolveExpected(expect, result) {
  if (!expect || typeof expect !== 'object') return { ok: false, value: null };
  if (expect.value !== undefined) return { ok: true, value: expect.value };
  if (typeof expect.ref === 'string' && expect.ref.trim()) {
    const value = readPath(result, expect.ref);
    return value === undefined ? { ok: false, value: null } : { ok: true, value };
  }
  return { ok: false, value: null };
}

function toNumber(v) {
  if (typeof v === 'boolean' || v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function allNotNull(observed) {
  if (Array.isArray(observed)) return observed.every((v) => v !== null && v !== undefined);
  if (observed && typeof observed === 'object') return Object.values(observed).every((v) => v !== null && v !== undefined);
  return observed !== null && observed !== undefined;
}

function compare(op, observed, expected) {
  if (op === 'not_null_all') return allNotNull(observed);
  if (op === '==') {
    const a = toNumber(observed);
    const b = toNumber(expected);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
    return JSON.stringify(observed) === JSON.stringify(expected);
  }
  const a = toNumber(observed);
  const b = toNumber(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return op === '>=' ? a >= b : a <= b;
}

function severityOf(row) {
  return row.severity ?? row.spec?.severity ?? 'error';
}

function judgeOne(row, probeMap, result) {
  const key = row.probe_key ?? row.spec?.key;
  const expect = row.spec?.expect ?? {};
  const op = expect.op;
  const entry = probeMap.get(key);
  const base = {
    key,
    op: op ?? null,
    severity: severityOf(row),
    observed: entry?.observed ?? null,
    expected: null,
    probed_at: entry?.probed_at ?? null,
  };
  const fail = (reason) => ({ ...base, verdict: 'FAIL', reason });
  if (!entry) return fail('probe_missing');
  if (entry.error) return fail('probe_error');
  if (!SUPPORTED_OPS.includes(op)) return fail('op_unsupported');
  if (op !== 'not_null_all') {
    const exp = resolveExpected(expect, result);
    if (!exp.ok) return fail('ref_unresolved');
    base.expected = exp.value;
  }
  return compare(op, entry.observed, base.expected)
    ? { ...base, verdict: 'PASS' }
    : fail('value_mismatch');
}

/**
 * 比对：只判 stage 与 result.stage 相同的 spec（stage 为空的 spec 视为不限）。
 * @param {Array<{probe_key, stage?, severity?, spec, spec_hash, journey_step_link_id, assertion_revision}>} specs
 * @param {{stage?: string, metrics?: object, probes?: any}} result
 * @returns {Array<{key, verdict:'PASS'|'FAIL', reason?, observed, expected, op, severity, probed_at}>}
 */
export function judgeProbes(specs = [], result = {}) {
  const probeMap = normalizeProbes(result?.probes);
  const out = [];
  for (const row of Array.isArray(specs) ? specs : []) {
    const stage = row.stage ?? row.spec?.stage ?? null;
    if (stage && result?.stage && stage !== result.stage) continue;
    out.push(judgeOne(row, probeMap, result));
  }
  return out;
}

/** PASS→green；FAIL&error→red；FAIL&warn→pending。 */
export function cellStatusFor(verdict, severity) {
  if (verdict === 'PASS') return 'green';
  return severity === 'warn' ? 'pending' : 'red';
}

/** 同一 cell 多探针取最坏：red > pending > green。 */
export function aggregateCellStatus(statuses) {
  let worst = 'green';
  for (const s of statuses) if ((CELL_RANK[s] ?? 0) > CELL_RANK[worst]) worst = s;
  return worst;
}

async function resolvePool(deps) {
  if (deps?.pool) return deps.pool;
  return (await import('../db.js')).default;
}

/**
 * run.finished 处理器：查锚 → 查探针 → 判定 → 写回执 → 翻色。fail-open，返回摘要供日志/测试。
 * @param {{runId: string, taskId: string, status?: string, result?: object}} payload
 * @param {{pool?: {query: Function}, persist?: Function}} [deps]
 */
export async function handleRunFinished(payload = {}, deps = {}) {
  const { runId, taskId, result } = payload;
  try {
    const stage = typeof result?.stage === 'string' ? result.stage : null;
    if (!runId || !taskId || !stage) return { skipped: 'no_stage' };
    const pool = await resolvePool(deps);
    const persist = deps.persist ?? persistBusinessProbeReceipt;

    const anchor = await pool.query(
      `SELECT payload->'anchor'->>'journey_id' AS journey_id FROM tasks WHERE id = $1`,
      [taskId],
    );
    const journeyId = anchor?.rows?.[0]?.journey_id;
    if (!journeyId) return { skipped: 'no_anchor' };

    const probes = await pool.query(
      `SELECT sp.probe_key, sp.stage, sp.severity, sp.spec, sp.spec_hash,
              jsl.id AS journey_step_link_id, jsl.assertion_revision
         FROM step_probes sp
         JOIN journey_step_links jsl ON jsl.id = sp.journey_step_link_id
        WHERE jsl.journey_id = $1 AND sp.stage = $2
          AND sp.active = true
        ORDER BY sp.probe_key`,
      [journeyId, stage],
    );
    const specs = probes?.rows ?? [];
    if (specs.length === 0) return { skipped: 'no_probes' };

    const verdicts = judgeProbes(specs, result);
    const byLink = new Map();
    const receipts = [];
    for (let i = 0; i < specs.length; i += 1) {
      const row = specs[i];
      const v = verdicts[i];
      const evidence = { observed: v.observed, expected: v.expected, op: v.op, severity: v.severity };
      if (v.reason) evidence.reason = v.reason;
      const receipt = await persist(pool, {
        journeyStepLinkId: row.journey_step_link_id,
        assertionRevision: row.assertion_revision,
        probeKey: v.key,
        specHash: row.spec_hash,
        runId: String(runId),
        verdict: v.verdict,
        evidence,
        probedAt: v.probed_at,
      });
      receipts.push({ key: v.key, verdict: v.verdict, reason: v.reason ?? null, receipt_id: receipt?.id ?? null });
      const list = byLink.get(row.journey_step_link_id) ?? [];
      list.push(cellStatusFor(v.verdict, v.severity));
      byLink.set(row.journey_step_link_id, list);
    }

    const cells = {};
    for (const [linkId, statuses] of byLink) {
      const status = aggregateCellStatus(statuses);
      await pool.query(
        `UPDATE journey_step_links SET cell_status = $1 WHERE id = $2`,
        [status, linkId],
      );
      cells[linkId] = status;
    }
    console.log(`[business-probe-judge] run=${runId} stage=${stage} judged=${verdicts.length} cells=${JSON.stringify(cells)}`);
    return { judged: verdicts.length, receipts, cells };
  } catch (err) {
    console.warn(`[business-probe-judge] run=${runId} judge failed (non-fatal): ${err.message}`);
    return { error: err.message };
  }
}

/**
 * 启动接线：订阅 run.finished。on / handle 可注入（测试）；默认 event-bus.on + handleRunFinished。
 * @returns {() => void} 取消订阅
 */
export function registerBusinessProbeJudge({ pool, on, handle = handleRunFinished } = {}) {
  const subscribe = on ?? ((...args) => import('../event-bus.js').then((m) => m.on(...args)));
  const handler = (payload) => handle(payload, { pool });
  const unsub = subscribe('run.finished', handler);
  return () => {
    if (typeof unsub === 'function') unsub();
    else if (unsub && typeof unsub.then === 'function') unsub.then((fn) => typeof fn === 'function' && fn());
  };
}
