/**
 * 新旧版本对比裁判（五块模型·裁判，决策 de6dff5d）——「晋级门」调用的稳定接口。
 *
 * 同一 Activity 的候选版本 vs 基线版本：按 spans.activity_definition_version_id 分组，各取最近 maxRuns 次运行，比三项指标：
 *   success_rate             成功率 = 成功运行 /（成功 + 失败）。一次运行的结果：有 Activity 级 span 取它最后一条的 pass/fail；
 *                            否则由每个 Step 最后一条 span 推（任一 fail = 失败，否则有 pass = 成功，都没有 = 不计入分母）。
 *   readback_verified_ratio  读回 verified 比例 = span 通过的 Step 里读回核对通过的占比（verified /(verified+mismatch+unverified)）；
 *                            Step 失败已在成功率里扣过，不进分母；读回声明 none 的豁免 Step 不计。复用 reconcileSteps 的逐 Step 判定。
 *   observation_consistency  读回观测值一致性 = 每个有读回的 Step，span 通过时报上来的 observed 的「形状」（类型/键集合，不看具体值）
 *                            取众数的占比，再对 Step 取平均。新版本换了观测口径、时报时不报会拉低它。
 * 裁决：
 *   insufficient_data  任一边运行数 < minRuns（默认 5），或任一边成功率不可算（没有成功/失败的运行）
 *   worse              任一可比指标 候选 − 基线 < −tolerance（默认 0，即任何下降都算更差）
 *   not_worse          其余；一边不可算的读回指标标 comparable=false，不参与判定
 * 返回值带每项指标的候选值/基线值/差值与理由文字，数字保留 4 位小数。
 */
import { reconcileSteps } from './step-reconcile.js';

export const DEFAULT_MIN_RUNS = 5;
export const DEFAULT_MAX_RUNS = 50;
export const DEFAULT_TOLERANCE = 0;
const METRICS = ['success_rate', 'readback_verified_ratio', 'observation_consistency'];
const round = v => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);
const ratio = (num, den) => (den > 0 ? round(num / den) : null);
const time = s => Date.parse(s.started_at);

/** 版本快照（definition-versions.js snapshotSteps 冻结的 payload.steps）→ [{id,key,readback}]；没有 steps 返回 null。 */
export function stepsFromVersionPayload(payload) {
  const list = payload && Array.isArray(payload.steps) ? payload.steps : [];
  if (list.length === 0) return null;
  return list.map(s => ({
    id: s.step_id ?? s.registration?.id ?? null,
    key: s.registration?.key ?? s.contract?.key ?? s.locator?.step_key ?? null,
    readback: s.registration?.readback ?? s.contract?.readback ?? {},
  }));
}

/** observed 的形状签名：只看类型与键集合，不看值（深度最多 3 层）。缺观测 = 'absent'。 */
export function observationShape(value, depth = 0) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') {
    if (depth >= 3) return 'object';
    return `{${Object.keys(value).sort().map(k => `${k}:${observationShape(value[k], depth + 1)}`).join(',')}}`;
  }
  return typeof value;
}

function runOutcome(list) {
  const activityLevel = list.filter(s => !s.step_id && !s.enabler_id && (s.outcome === 'pass' || s.outcome === 'fail'));
  if (activityLevel.length) return activityLevel.sort((a, b) => time(a) - time(b)).at(-1).outcome;
  const lastByStep = new Map();
  for (const s of list.filter(x => x.step_id).sort((a, b) => time(a) - time(b))) lastByStep.set(s.step_id, s);
  const finals = [...lastByStep.values()];
  if (finals.some(s => s.outcome === 'fail')) return 'fail';
  if (finals.some(s => s.outcome === 'pass')) return 'pass';
  return null;
}

/**
 * 一个版本的样本汇总（纯函数）。
 * @param {{steps:{id:string|null,key:string,readback:object}[], spans:object[], maxRuns?:number}} input
 *   spans = 该版本下该 Activity 的 span（run_id/step_id/enabler_id/outcome/evidence/started_at）
 */
export function summarizeVersionRuns({ steps, spans, maxRuns = DEFAULT_MAX_RUNS }) {
  const byRun = new Map();
  for (const s of spans) {
    if (!byRun.has(s.run_id)) byRun.set(s.run_id, []);
    byRun.get(s.run_id).push(s);
  }
  const latest = list => Math.max(...list.map(time));
  const runIds = [...byRun.keys()].sort((a, b) => latest(byRun.get(b)) - latest(byRun.get(a))).slice(0, maxRuns);

  let passed = 0, failed = 0;
  for (const id of runIds) {
    const outcome = runOutcome(byRun.get(id));
    if (outcome === 'pass') passed += 1; else if (outcome === 'fail') failed += 1;
  }

  const declared = steps.filter(s => s.id);
  const chosen = new Set(runIds);
  const stepSpans = spans.filter(s => s.step_id && chosen.has(s.run_id));
  const rec = declared.length && stepSpans.length
    ? reconcileSteps({ steps: declared, spans: stepSpans, runsWanted: runIds.length, requiredGreen: 1 })
    : { runs: [] };
  const counts = { verified: 0, mismatch: 0, unverified: 0 };
  for (const run of rec.runs) for (const st of run.steps) if (st.status in counts) counts[st.status] += 1;
  const checked = counts.verified + counts.mismatch + counts.unverified;

  const perStep = [];
  for (const step of declared) {
    if (!step.readback?.type || step.readback.type === 'none') continue;
    const shapes = new Map();
    let observed = 0;
    for (const run of rec.runs) {
      const st = run.steps.find(x => x.step_id === step.id);
      if (!st || !['verified', 'mismatch', 'unverified'].includes(st.status)) continue;
      const last = stepSpans.filter(s => s.run_id === run.run_id && s.step_id === step.id).sort((a, b) => time(a) - time(b)).at(-1);
      const shape = observationShape(last?.evidence?.observed);
      shapes.set(shape, (shapes.get(shape) || 0) + 1);
      observed += 1;
    }
    if (observed === 0) continue;
    const [modal, modalCount] = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0];
    perStep.push({ key: step.key, observed_runs: observed, modal_shape: modal, modal_count: modalCount, consistency: ratio(modalCount, observed) });
  }
  const consistency = perStep.length ? round(perStep.reduce((sum, p) => sum + p.consistency, 0) / perStep.length) : null;

  const readbackStepKeys = declared.filter(st => st.readback?.type && st.readback.type !== 'none').map(st => st.key).sort();
  return {
    runs: runIds.length, run_ids: runIds, readback_step_keys: readbackStepKeys,
    decided_runs: passed + failed, passed_runs: passed, failed_runs: failed, success_rate: ratio(passed, passed + failed),
    readback: { ...counts, checked, verified_ratio: ratio(counts.verified, checked) },
    observation: { consistency, per_step: perStep },
  };
}

const metricOf = (summary, name) => (name === 'success_rate' ? summary.success_rate
  : name === 'readback_verified_ratio' ? summary.readback?.verified_ratio : summary.observation?.consistency) ?? null;

/**
 * 两个版本汇总 → 裁决（纯函数）。
 * @returns {{verdict:'not_worse'|'worse'|'insufficient_data', reasons:string[], metrics:object, sample:object, tolerance:number}}
 */
export function decideVersionComparison({ candidate, baseline, minRuns = DEFAULT_MIN_RUNS, tolerance = DEFAULT_TOLERANCE }) {
  const reasons = [];
  const metrics = {};
  for (const name of METRICS) {
    const c = metricOf(candidate, name), b = metricOf(baseline, name);
    if (c === null || b === null) { metrics[name] = { candidate: c, baseline: b, delta: null, comparable: false, worse: null }; continue; }
    const delta = round(c - b);
    metrics[name] = { candidate: c, baseline: b, delta, comparable: true, worse: delta < -tolerance - 1e-9 };
  }
  const sample = { candidate_runs: candidate.runs, baseline_runs: baseline.runs, min_runs: minRuns };
  if (candidate.runs < minRuns) reasons.push(`候选版本运行 ${candidate.runs} 次，少于样本下限 ${minRuns}`);
  if (baseline.runs < minRuns) reasons.push(`基线版本运行 ${baseline.runs} 次，少于样本下限 ${minRuns}`);
  if (candidate.success_rate === null || candidate.success_rate === undefined) reasons.push('候选版本没有成功/失败的运行，成功率不可算');
  if (baseline.success_rate === null || baseline.success_rate === undefined) reasons.push('基线版本没有成功/失败的运行，成功率不可算');
  if (reasons.length) return { verdict: 'insufficient_data', reasons, metrics, sample, tolerance };

  for (const name of METRICS) {
    const m = metrics[name];
    if (!m.comparable && name !== 'success_rate' && m.baseline !== null && m.candidate === null) {
      // 基线可算、候选不可算 = 读回被删或改成 type=none：覆盖下降，判 worse（两边都不可算才跳过）
      m.worse = true;
      reasons.push(`readback_coverage_dropped: ${name} 基线 ${m.baseline} 可算，候选不可算（读回被删或改成 none）`);
    } else if (!m.comparable) reasons.push(`${name} 一边不可算（候选 ${m.candidate}，基线 ${m.baseline}），不参与判定`);
    else if (m.worse) reasons.push(`${name} 候选 ${m.candidate} 比基线 ${m.baseline} 低 ${round(-m.delta)}（容差 ${tolerance}）`);
  }
  let removed = [];
  if (Array.isArray(baseline.readback_step_keys) && Array.isArray(candidate.readback_step_keys)) {
    const kept = new Set(candidate.readback_step_keys);
    removed = baseline.readback_step_keys.filter(k => !kept.has(k));
    if (removed.length) reasons.push(`readback_removed:${removed.join(',')}（基线有读回的 Step 在候选里没有读回）`);
  }
  const worse = METRICS.some(n => metrics[n].worse) || removed.length > 0;
  if (!worse) reasons.push(`三项指标均不低于基线（容差 ${tolerance}）`);
  return { verdict: worse ? 'worse' : 'not_worse', reasons, metrics, sample, tolerance };
}

const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };

async function versionSpans(db, activityId, versionId, maxRuns) {
  return (await db.query(
    `WITH recent AS (
       SELECT run_id, max(started_at) AS last FROM spans
        WHERE activity_id = $1 AND activity_definition_version_id = $2
        GROUP BY run_id ORDER BY last DESC LIMIT $3)
     SELECT s.run_id, s.step_id, s.enabler_id, s.outcome, s.evidence, s.started_at
       FROM spans s JOIN recent r ON r.run_id = s.run_id
      WHERE s.activity_id = $1 AND s.activity_definition_version_id = $2
      ORDER BY s.started_at`, [activityId, versionId, maxRuns])).rows;
}

/** 按内容取样本：同内容不同 commit 的构建合在一起，样本不再按 commit 碎开（构建 JOIN 限定同一 Activity）。 */
async function contentSpans(db, activityId, contentMd5, maxRuns) {
  return (await db.query(
    `WITH vb AS (
       SELECT id FROM activity_definition_versions
        WHERE activity_id = $1 AND md5((payload - 'implementation_bindings')::text) = $2),
     recent AS (
       SELECT run_id, max(started_at) AS last FROM spans
        WHERE activity_id = $1 AND activity_definition_version_id IN (SELECT id FROM vb)
        GROUP BY run_id ORDER BY last DESC LIMIT $3)
     SELECT s.run_id, s.step_id, s.enabler_id, s.outcome, s.evidence, s.started_at
       FROM spans s JOIN recent r ON r.run_id = s.run_id
      WHERE s.activity_id = $1 AND s.activity_definition_version_id IN (SELECT id FROM vb)
      ORDER BY s.started_at`, [activityId, contentMd5, maxRuns])).rows;
}

async function releaseLineTables(db) {
  return Boolean((await db.query("SELECT to_regclass('activity_versions') IS NOT NULL AND to_regclass('activity_release_state') IS NOT NULL AS ok")).rows[0]?.ok);
}

const VERSION_COLUMNS = 'v.id, v.content_md5, v.version_no, v.created_at, b.payload';
/** 版本 id 或构建 id → 内容版本；构建还没映射（挂钩失败待补账）时按内容找。 */
async function resolveContentVersion(db, activityId, id) {
  const direct = (await db.query(`SELECT ${VERSION_COLUMNS} FROM activity_versions v JOIN activity_definition_versions b ON b.id = v.first_build_id
    WHERE v.activity_id = $1 AND v.id = $2`, [activityId, id])).rows[0];
  if (direct) return direct;
  const viaBuild = (await db.query(`SELECT ${VERSION_COLUMNS} FROM activity_definition_versions b0
      JOIN activity_versions v ON v.activity_id = b0.activity_id AND v.content_md5 = md5((b0.payload - 'implementation_bindings')::text)
      JOIN activity_definition_versions b ON b.id = v.first_build_id
     WHERE b0.activity_id = $1 AND b0.id = $2`, [activityId, id])).rows[0];
  if (viaBuild) return { ...viaBuild, resolved_from_build: id };
  const unmapped = (await db.query(`SELECT id, md5((payload - 'implementation_bindings')::text) AS content_md5, NULL::int AS version_no, created_at, payload
    FROM activity_definition_versions WHERE activity_id = $1 AND id = $2`, [activityId, id])).rows[0];
  if (unmapped) return { ...unmapped, id: null, resolved_from_build: id };
  return fail(`version_not_found: ${id} 不是该 Activity 的版本或构建`, 404);
}

async function stepsResolver(db, activityId) {
  let current = null;
  return async payload => {
    const frozen = stepsFromVersionPayload(payload);
    if (frozen) return frozen;
    current ??= (await db.query('SELECT id, key, readback FROM steps WHERE activity_id = $1 AND active IS NOT FALSE ORDER BY step_order', [activityId])).rows;
    return current;
  };
}

/** 发布线迁移后：按内容版本对比；基线省略取生产版（没有指针取当前构建的内容）。 */
async function compareContentVersions(db, activityId, { candidateVersionId, baselineVersionId, minRuns, maxRuns, tolerance }) {
  let baselineId = baselineVersionId;
  if (!baselineId) {
    const row = (await db.query(`SELECT s.production_version_id AS p, a.current_definition_version_id AS c FROM activities a
      LEFT JOIN activity_release_state s ON s.activity_id = a.id WHERE a.id = $1`, [activityId])).rows[0];
    baselineId = row?.p ?? row?.c ?? null;
    if (!baselineId) fail('baseline_version_required: Activity 没有生产版或当前版本，需显式给基线', 400);
  }
  const cand = await resolveContentVersion(db, activityId, candidateVersionId);
  const base = await resolveContentVersion(db, activityId, baselineId);
  if (cand.content_md5 === base.content_md5) fail('candidate_equals_baseline: 候选与基线内容相同', 400);
  const stepsFor = await stepsResolver(db, activityId);
  const side = async v => {
    const summary = summarizeVersionRuns({ steps: await stepsFor(v.payload), spans: await contentSpans(db, activityId, v.content_md5, maxRuns), maxRuns });
    return { version_id: v.id, version_no: v.version_no, content_md5: v.content_md5, resolved_from_build: v.resolved_from_build ?? null,
      version_created_at: v.created_at, steps_source: stepsFromVersionPayload(v.payload) ? 'version_snapshot' : 'current_steps', ...summary };
  };
  const candidate = await side(cand);
  const baseline = await side(base);
  return { mode: 'content_version', candidate, baseline, decision: decideVersionComparison({ candidate, baseline, minRuns, tolerance }) };
}

/**
 * 读库对比同一 Activity 的两个版本（晋级门入口）。
 * 发布线迁移（540）后按「内容版本」：id 可以是 activity_versions.id，也可以是构建 id（先解析出它的内容）；
 * 样本 = 该内容所有构建下的 span；基线省略取生产版。没有发布线表（旧库/测试库）时按构建 id 对比（旧行为）。
 * @param {object} db  pg Pool/Client
 * @param {string} activityId
 * @param {{candidateVersionId:string, baselineVersionId?:string|null, minRuns?:number, maxRuns?:number, tolerance?:number}} opts
 * @returns {Promise<{activity_id, verdict, reasons, metrics, sample, tolerance, candidate, baseline, params, compared_at, mode}>}
 * @throws status=404 版本不属于该 Activity；status=400 候选=基线 / 没有可用基线 / minRuns > maxRuns
 */
export async function compareActivityVersions(db, activityId, {
  candidateVersionId, baselineVersionId = null, minRuns = DEFAULT_MIN_RUNS, maxRuns = DEFAULT_MAX_RUNS, tolerance = DEFAULT_TOLERANCE,
} = {}) {
  if (!candidateVersionId) fail('candidate_version_required', 400);
  if (minRuns > maxRuns) fail(`min_runs_exceeds_max_runs: min_runs ${minRuns} > max_runs ${maxRuns}`, 400);
  const params = { min_runs: minRuns, max_runs: maxRuns, tolerance };
  if (await releaseLineTables(db)) {
    const r = await compareContentVersions(db, activityId, { candidateVersionId, baselineVersionId, minRuns, maxRuns, tolerance });
    return { activity_id: activityId, mode: r.mode, ...r.decision, candidate: r.candidate, baseline: r.baseline, params, compared_at: new Date().toISOString() };
  }
  let baseline = baselineVersionId;
  if (!baseline) {
    baseline = (await db.query('SELECT current_definition_version_id AS v FROM activities WHERE id = $1', [activityId])).rows[0]?.v ?? null;
    if (!baseline) fail('baseline_version_required: Activity 没有当前版本，需显式给基线', 400);
  }
  if (baseline === candidateVersionId) fail('candidate_equals_baseline', 400);
  const versions = (await db.query(
    'SELECT id, payload, created_at FROM activity_definition_versions WHERE activity_id = $1 AND id = ANY($2::uuid[])',
    [activityId, [candidateVersionId, baseline]])).rows;
  const byId = new Map(versions.map(v => [v.id, v]));
  for (const id of [candidateVersionId, baseline]) if (!byId.has(id)) fail(`version_not_found: ${id} 不是该 Activity 的定义版本`, 404);

  const stepsFor = await stepsResolver(db, activityId);
  const side = async id => {
    const v = byId.get(id);
    const summary = summarizeVersionRuns({ steps: await stepsFor(v.payload), spans: await versionSpans(db, activityId, id, maxRuns), maxRuns });
    return { version_id: id, version_created_at: v.created_at, steps_source: stepsFromVersionPayload(v.payload) ? 'version_snapshot' : 'current_steps', ...summary };
  };
  const cand = await side(candidateVersionId);
  const base = await side(baseline);
  const decision = decideVersionComparison({ candidate: cand, baseline: base, minRuns, tolerance });
  return { activity_id: activityId, mode: 'build', ...decision, candidate: cand, baseline: base, params, compared_at: new Date().toISOString() };
}
