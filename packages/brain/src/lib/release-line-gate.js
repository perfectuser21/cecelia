/**
 * 发布线·晋级门（决策 de6dff5d 第 3 步）：手动晋级 / 成组晋级。
 *
 * 门槛只保护「曾被判过收敛」的生产版（冷启动规则）：
 *   生产版从未收敛 → bootstrap，不要求 N 绿、不做对比（reason=bootstrap_no_converged_baseline）。
 *   生产版受保护 → 收敛（候选自己的 span 连续 N 次全绿，N 默认 5，RELEASE_GATE_REQUIRED_GREEN，请求可覆盖 1..50，
 *     结果作为一条 trigger_kind='promotion_gate' 的裁判落库）+ 对比（compareActivityVersions = not_worse）。
 *   force=true（必须带 actor+reason）跳过门槛，事件 gate.forced=true；bootstrap / forced 永远不写 gate.converged=true，
 *   免得冷启动把自己升级成受保护。
 * 接口变了且有受影响的上下游（自己受保护或下游受保护）→ 409 INTERFACE_CHANGED，必须成组晋级覆盖全部受影响的 Activity。
 */
import { randomUUID } from 'node:crypto';
import { reconcileSteps } from './step-reconcile.js';
import { compareActivityVersions, stepsFromVersionPayload, DEFAULT_MIN_RUNS, DEFAULT_MAX_RUNS } from './activity-version-compare.js';
import {
  releaseLineFlags, lockReleaseLine, getPointer, everConverged, recordEvent, movePointer, setInitialPointer,
  refreshWorkflowRecipe, interfaceImpact, withReleaseTx,
} from './release-line.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const httpError = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const intIn = (v, def, min, max, name) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw httpError(400, 'INVALID_PARAM', `${name} 须为 ${min}..${max} 的整数`);
  return n;
};

/** 收敛门槛：候选内容版本自己的 span 连续 N 次全绿；结果落一条 promotion_gate 裁判。 */
export async function convergenceGate(db, activityId, version, requiredGreen) {
  const payload = (await db.query('SELECT payload FROM activity_definition_versions WHERE id = $1', [version.first_build_id])).rows[0]?.payload;
  const frozen = stepsFromVersionPayload(payload);
  const steps = (frozen || (await db.query('SELECT id, key, readback FROM steps WHERE activity_id = $1 AND active IS NOT FALSE ORDER BY step_order', [activityId])).rows)
    .filter(s => s.id);
  const spans = (await db.query(
    `SELECT s.run_id, s.step_id, s.outcome, s.evidence, s.started_at, s.activity_definition_version_id AS build_id
       FROM spans s JOIN activity_version_builds m ON m.build_id = s.activity_definition_version_id AND m.activity_id = $1
      WHERE m.activity_version_id = $2 AND s.step_id IS NOT NULL ORDER BY s.started_at`, [activityId, version.id])).rows;
  const report = reconcileSteps({ steps, spans, runsWanted: requiredGreen, requiredGreen });
  const windowRuns = new Set(report.runs.map(r => r.run_id));
  const runVersions = {}, lastByBuild = new Map();
  for (const s of spans.filter(x => windowRuns.has(x.run_id))) {
    runVersions[s.run_id] = [...new Set([...(runVersions[s.run_id] || []), s.build_id])];
    lastByBuild.set(s.build_id, Math.max(lastByBuild.get(s.build_id) || 0, Date.parse(s.started_at)));
  }
  const windowBuilds = [...lastByBuild.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const stored = { activity_id: activityId, ...report, window_version_ids: windowBuilds, run_version_ids: runVersions,
    window_unversioned_run_count: 0, gate_for_version_id: version.id };
  const row = (await db.query(
    `INSERT INTO activity_judgments (activity_id, activity_definition_version_id, verdict, converged, consecutive_green,
       required_green, runs_considered, trigger_kind, trigger_ref, report)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'promotion_gate', $8, $9::jsonb) RETURNING id`,
    [activityId, windowBuilds[0] ?? null, report.verdict, Boolean(report.converged), report.consecutive_green, requiredGreen,
      report.runs.length, `promotion:${version.id}`, JSON.stringify(stored)])).rows[0];
  return { converged: Boolean(report.converged), verdict: report.verdict, consecutive_green: report.consecutive_green,
    required_green: requiredGreen, runs: report.runs.length, judgment_id: row?.id ?? null };
}

/**
 * 一个成员的晋级判定（调用方持 release-line 锁）。
 * @returns {{outcome:'bootstrap'|'gate_passed'|'forced'|'rejected'|'interface_changed', gate, compare?, judgment_ids, affected?}}
 */
async function decidePromotion(db, activityId, pointer, candidate, opts, groupMembers = null) {
  const isProtected = await everConverged(db, activityId, pointer.production_version_id);
  const impact = await interfaceImpact(db, activityId, pointer.production_version_id, candidate.id);
  if (impact.diff.changed && impact.affected.length && (isProtected || impact.protected_affected.length)) {
    const missing = impact.affected.filter(a => !groupMembers?.has(a.activity_id));
    if (missing.length) return { outcome: 'interface_changed', affected: impact.affected, missing, interface: impact.diff };
  }
  if (!isProtected) return { outcome: 'bootstrap', reason: 'bootstrap_no_converged_baseline', gate: { converged: false, bootstrap: true }, judgment_ids: [] };
  if (opts.force) return { outcome: 'forced', reason: opts.reason, gate: { converged: false, forced: true, protected_baseline: true }, judgment_ids: [] };
  const conv = await convergenceGate(db, activityId, candidate, opts.requiredGreen);
  let compare;
  try {
    compare = await compareActivityVersions(db, activityId, { candidateVersionId: candidate.id, baselineVersionId: pointer.production_version_id,
      minRuns: opts.minRuns, maxRuns: opts.maxRuns, tolerance: opts.tolerance });
  } catch (e) {
    if (e.status !== 400 && e.status !== 404) throw e;
    compare = { verdict: 'error', reasons: [e.message] };
  }
  const passed = conv.converged && compare.verdict === 'not_worse';
  return { outcome: passed ? 'gate_passed' : 'rejected', reason: passed ? 'gate_passed' : 'gate_failed',
    gate: { converged: passed, protected_baseline: true, convergence: conv }, compare, judgment_ids: conv.judgment_id ? [conv.judgment_id] : [] };
}

function parseOptions(body, env) {
  const flags = releaseLineFlags(env);
  if (typeof body?.actor !== 'string' || !body.actor.trim()) throw httpError(400, 'ACTOR_REQUIRED', 'actor 必填');
  const opts = {
    actor: body.actor.trim(),
    requiredGreen: intIn(body.required_green, flags.requiredGreen, 1, 50, 'required_green'),
    minRuns: intIn(body.min_runs, DEFAULT_MIN_RUNS, 1, 1000, 'min_runs'),
    maxRuns: intIn(body.max_runs, DEFAULT_MAX_RUNS, 1, 1000, 'max_runs'),
    tolerance: body.tolerance === undefined ? 0 : Number(body.tolerance),
    force: body.force === true,
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
  };
  if (opts.minRuns > opts.maxRuns) throw httpError(400, 'INVALID_PARAM', `min_runs ${opts.minRuns} > max_runs ${opts.maxRuns}`);
  if (!Number.isFinite(opts.tolerance) || opts.tolerance < 0 || opts.tolerance > 1) throw httpError(400, 'INVALID_PARAM', 'tolerance 须为 0..1');
  if (opts.force && !opts.reason) throw httpError(400, 'REASON_REQUIRED', 'force 晋级必须带 reason');
  return opts;
}

async function loadCandidate(db, activityId, versionId) {
  if (!UUID.test(versionId || '')) throw httpError(400, 'INVALID_PARAM', 'candidate_version_id 须为 uuid');
  const v = (await db.query('SELECT * FROM activity_versions WHERE id = $1 AND activity_id = $2', [versionId, activityId])).rows[0];
  if (!v) throw httpError(404, 'VERSION_NOT_FOUND', `${versionId} 不是该 Activity 的内容版本`);
  return v;
}

async function workflowsOf(db, activityIds) {
  return (await db.query('SELECT DISTINCT workflow_id FROM workflow_activity_refs WHERE activity_id = ANY($1::uuid[]) AND active ORDER BY workflow_id',
    [activityIds])).rows.map(r => r.workflow_id);
}

async function applyDecision(db, activityId, pointer, candidate, decision, { actor, groupId = null, kind }) {
  if (!pointer) return setInitialPointer(db, activityId, candidate.id, 'manual_promote_no_pointer', actor);
  const event = await movePointer(db, activityId, pointer.production_version_id, candidate.id, {
    kind: decision.outcome === 'bootstrap' && !groupId ? 'bootstrap' : kind, group_id: groupId, actor,
    reason: decision.reason, judgment_ids: decision.judgment_ids, compare_result: decision.compare ?? null, gate: decision.gate });
  if (!event) throw httpError(409, 'POINTER_CHANGED', '生产指针已被并发修改，请重试');
  return event;
}

/** 手动晋级单个 Activity。门槛不过 → 写 promote_rejected 并返回 {status:409}（事件随事务提交）。 */
export async function promoteActivity(db, activityId, body = {}, { env = process.env } = {}) {
  const opts = parseOptions(body, env);
  return withReleaseTx(db, async tx => {
    await lockReleaseLine(tx);
    const candidate = await loadCandidate(tx, activityId, body.candidate_version_id);
    const pointer = await getPointer(tx, activityId, { forUpdate: true });
    if (pointer?.production_version_id === candidate.id) throw httpError(400, 'ALREADY_PRODUCTION', '候选就是当前生产版');
    if (!pointer) {
      const event = await applyDecision(tx, activityId, null, candidate, {}, { actor: opts.actor });
      const recipes = [];
      for (const w of await workflowsOf(tx, [activityId])) { const r = await refreshWorkflowRecipe(tx, w, { cause: 'promote', causeEventId: event?.id }); if (r) recipes.push(r); }
      return { status: 201, outcome: 'initial', event, recipes };
    }
    const decision = await decidePromotion(tx, activityId, pointer, candidate, opts);
    if (decision.outcome === 'interface_changed') throw httpError(409, 'INTERFACE_CHANGED', '接口变了，须成组晋级受影响的 Activity',
      { details: { affected: decision.affected, missing: decision.missing, interface: decision.interface } });
    if (decision.outcome === 'rejected') {
      const event = await recordEvent(tx, { activity_id: activityId, kind: 'promote_rejected', actor: opts.actor, reason: 'gate_failed',
        from_version_id: pointer.production_version_id, to_version_id: candidate.id, judgment_ids: decision.judgment_ids,
        compare_result: decision.compare ?? null, gate: decision.gate });
      return { status: 409, code: 'GATE_FAILED', outcome: 'rejected', event, gate: decision.gate, compare: decision.compare };
    }
    const event = await applyDecision(tx, activityId, pointer, candidate, decision, { actor: opts.actor, kind: 'promote' });
    const recipes = [];
    for (const w of await workflowsOf(tx, [activityId])) { const r = await refreshWorkflowRecipe(tx, w, { cause: 'promote', causeEventId: event.id }); if (r) recipes.push(r); }
    return { status: 201, outcome: decision.outcome, event, gate: decision.gate, compare: decision.compare ?? null, recipes };
  });
}

/**
 * 成组晋级：同一事务原子执行，共用 group_id；组内须覆盖全部受影响的 Activity；每个成员按自己的规则过门。
 * 任一成员不过 → 不动任何指针，给不过的成员各记一条 promote_rejected（同 group_id），返回 {status:409}。
 */
export async function groupPromote(db, body = {}, { env = process.env } = {}) {
  const opts = parseOptions(body, env);
  const members = Array.isArray(body.members) ? body.members : [];
  if (members.length < 1 || members.length > 50) throw httpError(400, 'INVALID_PARAM', 'members 须为 1..50 个');
  const ids = members.map(m => m?.activity_id);
  if (ids.some(id => !UUID.test(id || '')) || new Set(ids).size !== ids.length) throw httpError(400, 'INVALID_PARAM', 'members.activity_id 须为不重复的 uuid');
  const sorted = [...members].sort((a, b) => a.activity_id.localeCompare(b.activity_id));
  return withReleaseTx(db, async tx => {
    await lockReleaseLine(tx);
    const memberSet = new Set(ids);
    const groupId = randomUUID();
    const plans = [];
    for (const m of sorted) {
      const candidate = await loadCandidate(tx, m.activity_id, m.candidate_version_id);
      const pointer = await getPointer(tx, m.activity_id, { forUpdate: true });
      if (pointer?.production_version_id === candidate.id) throw httpError(400, 'ALREADY_PRODUCTION', `${m.activity_id} 的候选就是当前生产版`);
      const decision = pointer ? await decidePromotion(tx, m.activity_id, pointer, candidate, opts, memberSet) : { outcome: 'bootstrap', reason: 'manual_promote_no_pointer', gate: { converged: false }, judgment_ids: [] };
      plans.push({ activityId: m.activity_id, candidate, pointer, decision });
    }
    const missing = plans.filter(p => p.decision.outcome === 'interface_changed');
    if (missing.length) throw httpError(409, 'INTERFACE_CHANGED', '成组晋级没有覆盖全部受影响的 Activity',
      { details: missing.map(p => ({ activity_id: p.activityId, missing: p.decision.missing, interface: p.decision.interface })) });
    const rejected = plans.filter(p => p.decision.outcome === 'rejected');
    if (rejected.length) {
      const events = [];
      for (const p of rejected) events.push(await recordEvent(tx, { activity_id: p.activityId, kind: 'promote_rejected', group_id: groupId, actor: opts.actor,
        reason: 'group_gate_failed', from_version_id: p.pointer.production_version_id, to_version_id: p.candidate.id,
        judgment_ids: p.decision.judgment_ids, compare_result: p.decision.compare ?? null, gate: p.decision.gate }));
      return { status: 409, code: 'GATE_FAILED', group_id: groupId, rejected: rejected.map(p => ({ activity_id: p.activityId, gate: p.decision.gate, compare: p.decision.compare })), events };
    }
    const events = [];
    for (const p of plans) events.push(await applyDecision(tx, p.activityId, p.pointer, p.candidate, p.decision, { actor: opts.actor, groupId, kind: 'group_promote' }));
    const recipes = [];
    for (const w of await workflowsOf(tx, ids)) { const r = await refreshWorkflowRecipe(tx, w, { cause: 'group_promote', causeEventId: events[0]?.id ?? null }); if (r) recipes.push(r); }
    return { status: 201, group_id: groupId, events, recipes, outcomes: plans.map(p => ({ activity_id: p.activityId, outcome: p.decision.outcome })) };
  });
}
