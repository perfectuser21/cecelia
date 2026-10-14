/**
 * 收敛对账（树+仓库 v3.0 第 4 刀，路 B）：技能按 Step 发 span 跑 N 次，spans 与 Steps.readback 对账，
 * 对不上就改 Steps，直到稳定。连续 N 次整个 Activity 全绿 = 收敛，可以固化（蒸馏成脚本）。
 *
 * 一次运行里每个声明的 Step 的状态：
 *   verified   span 通过且观测值满足读回
 *   mismatch   span 通过但观测值违反读回（对不上，该改 Steps 或查技能）
 *   unverified span 通过但没有观测值/读回不可比（无从对账，不算绿）
 *   failed     Step 自己跑失败（outcome=fail，是失败不是对不上）
 *   missing    这次运行里没有这个 Step 的 span
 *   skipped    outcome=skipped（中性）
 *   exempt     读回声明 type=none（确实读不回，豁免）
 * 一次运行「绿」= 每个 Step 都是 verified/skipped/exempt，且没有出现合同里没声明的 Step span。
 */
import { evaluateReadback } from './step-readback-eval.js';
import { ensureEightCells } from './activity-cells.js';
import { isCommanderVerification, verifiedRuntime } from './commander-verification-transport.js';

const GREEN_OK = new Set(['verified', 'skipped', 'exempt']);
const ISSUE_CODE = { mismatch: 'step_readback_mismatch', unverified: 'step_unobserved', failed: 'step_failed', missing: 'step_missing' };

function statusOf(step, span) {
  if (step.readback?.type === 'none' && !span) return 'exempt';
  if (!span) return 'missing';
  if (span.outcome === 'skipped') return 'skipped';
  if (span.outcome === 'fail') return 'failed';
  if (step.readback?.type === 'none') return 'exempt';
  if (span.outcome !== 'pass') return 'unverified';
  const observed = span.evidence?.observed;
  const result = evaluateReadback(step.readback, observed);
  if (result.verdict === 'pass') return 'verified';
  if (result.verdict === 'fail') return 'mismatch';
  return 'unverified';
}

/** 正式核验任务独立结果，不读取执行者evidence里的自报verification_ref。 */
export function independentVerification(vt, taskId, envelope) {
  if (!vt || vt.id === taskId || !['completed','completed_no_pr'].includes(vt.status)
    || (isCommanderVerification(vt) && !verifiedRuntime(vt))) return null;
  let v = vt.result?.workflow_verification;
  if (!v) {
    const raw = isCommanderVerification(vt) ? vt.result?.receipt?.text : vt.payload?.last_run_result?.result_summary;
    if (typeof raw === 'string' && Buffer.byteLength(raw) <= 50000) {
      const line = [...raw.matchAll(/^WORKFLOW_VERIFICATION[ \t]+(\{[^\n]*\})[ \t]*$/gm)].at(-1)?.[1];
      try { const parsed=JSON.parse(line ?? raw); v=parsed.workflow_verification ?? (line ? parsed:null); } catch { return null; }
    }
  }
  if (!v || v.task_id !== taskId || v.run_id !== envelope?.run_id || v.attempt !== envelope?.attempt
    || v.definition_sha256 !== envelope?.definition?.snapshot_sha256 || v.verdict !== 'PASS'
    || !Array.isArray(v.evidence) || !v.evidence.length || !Array.isArray(v.assertions) || !v.assertions.length
    || !v.assertions.every(a => a.pass === true) || !v.assertions.some(a => a.name === 'cleanup' && a.pass === true)) return null;
  return v;
}

/** Activity局部证据身份；不使用整条Workflow摘要，局部升级不清其他Activity证据。 */
export function evidenceScopeOf(span) {
  const implementation = span?.evidence?.implementation, environment = span?.evidence?.environment;
  const text = v => typeof v === 'string' && v.trim().length > 0;
  if (!text(span?.activity_definition_version_id) || !['code', 'skill'].includes(implementation?.kind)
    || !['id', 'version', 'digest'].every(k => text(implementation[k]))
    || !['id', 'fingerprint'].every(k => text(environment?.[k]))) return null;
  return { activity_definition_version_id: span.activity_definition_version_id,
    implementation: {kind:implementation.kind,id:implementation.id,version:implementation.version,digest:implementation.digest},
    environment: {id:environment.id,fingerprint:environment.fingerprint} };
}
export function frozenScopeMatches(scope, payload, environment) {
  const kind=scope?.implementation?.kind, pair=payload?.commander_implementations;
  const fixed=pair?.[kind] ?? (kind==='skill' ? payload?.commander_implementation:null);
  if (kind==='code' && (!pair?.skill?.implementation || pair.skill.implementation.kind !== 'skill' || !pair.business_requirement_sha256)) return false;
  if (!fixed?.implementation || !environment || !scope) return false;
  return ['kind','id','version','digest'].every(k => fixed.implementation[k]===scope.implementation[k])
    && ['id','fingerprint'].every(k => environment[k]===scope.environment[k])
    && (payload.implementation_bindings || []).some(b => b.kind===fixed.implementation.kind && b.status==='verified' && b.validation_scope==='reference_only'
      && (b.version===undefined || String(b.version)===fixed.implementation.version) && typeof b.digest==='string' && b.digest.replace(/^sha256:/,'')===fixed.implementation.digest && b.path===fixed.path);
}
export const evidenceScopeKey = scope => evidenceScopeOf({activity_definition_version_id:scope?.activity_definition_version_id,
  evidence:{implementation:scope?.implementation,environment:scope?.environment}}) ? JSON.stringify([
  scope.activity_definition_version_id, scope.implementation?.kind, scope.implementation?.id,
  scope.implementation?.version, scope.implementation?.digest, scope.environment?.id, scope.environment?.fingerprint,
]) : null;
const spanScopeKey = span => evidenceScopeKey(evidenceScopeOf(span));
const independent = span => span.evidence?.execution_role === 'primary';

/**
 * @param {{steps:{id:string,key:string,readback:object}[], spans:object[], runsWanted?:number, requiredGreen?:number}} input
 *   spans = Step 级 span（run_id/step_id/outcome/evidence.observed/started_at）
 */
export function reconcileSteps({ steps, spans, runsWanted = 5, requiredGreen = 5, evidenceScope = null }) {
  const originals = spans;
  const versioned = spans.some(s => s.activity_definition_version_id || s.identity_protocol === 2);
  const candidates = spans.filter(s => independent(s) && evidenceScopeOf(s)).sort((a,b) => Date.parse(b.started_at)-Date.parse(a.started_at));
  const scope = evidenceScope || evidenceScopeOf(candidates[0]);
  if (versioned) spans = spans.filter(s => independent(s) && scope && spanScopeKey(s) === evidenceScopeKey(scope));

  const stepById = new Map(steps.map(s => [s.id, s]));
  const byRun = new Map();
  for (const sp of spans) {
    if (!byRun.has(sp.run_id)) byRun.set(sp.run_id, []);
    byRun.get(sp.run_id).push(sp);
  }
  const latest = list => Math.max(...list.map(s => Date.parse(s.started_at)));
  const runIds = [...byRun.keys()].sort((a, b) => latest(byRun.get(b)) - latest(byRun.get(a))).slice(0, runsWanted);

  const issues = [];
  const runs = runIds.map(run_id => {
    const list = byRun.get(run_id);
    const stepStatuses = steps.map(step => {
      const mine = list.filter(sp => sp.step_id === step.id).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
      const status = statusOf(step, mine.find(s => s.outcome === 'fail') || mine.at(-1));
      if (ISSUE_CODE[status]) issues.push({ code: ISSUE_CODE[status], step_key: step.key, run_id });
      return { key: step.key, step_id: step.id, status };
    });
    const undeclared = [...new Set(list.filter(sp => !stepById.has(sp.step_id)).map(sp => sp.step_id))];
    for (const step_id of undeclared) issues.push({ code: 'undeclared_step', step_id, run_id });
    return {
      run_id, steps: stepStatuses, undeclared, last_span_at: new Date(latest(list)).toISOString(),
      green: stepStatuses.every(s => GREEN_OK.has(s.status)) && undeclared.length === 0,
    };
  });

  let consecutive = 0;
  for (const run of runs) { if (!run.green) break; consecutive += 1; }
  const converged = runs.length > 0 && consecutive >= requiredGreen;
  const verdict = runs.length === 0 ? 'no_data' : converged ? 'converged' : runs[0].green ? 'converging' : 'diverged';

  const per_step = steps.map(step => {
    const row = { key: step.key, verified: 0, mismatch: 0, unverified: 0, failed: 0, missing: 0, skipped: 0, exempt: 0 };
    for (const run of runs) row[run.steps.find(s => s.step_id === step.id).status] += 1;
    return row;
  });
  return { verdict, converged, consecutive_green: consecutive, required_green: requiredGreen, runs, per_step, issues,
    evidence_scope: scope, promotion_eligible: Boolean(scope) && converged && runs.slice(0, requiredGreen).every(r => r.steps.some(s => s.status === 'verified')
      && byRun.get(r.run_id).every(s => s.independent_verified === true && s.scope_verified === true)),
    excluded_span_count: originals.length - spans.length,
    execution_outcomes: originals.map(s => ({run_id:s.run_id,step_id:s.step_id,outcome:s.outcome,
      execution_role:s.evidence?.execution_role ?? 'unattributed', evidence_scope:evidenceScopeOf(s)})) };
}

const CELL_FOR_VERDICT = { converged: 'green', diverged: 'red', converging: 'pending' };

async function capabilityOf(db, activityId) {
  // 能力不再记在 Activity 上（迁移 528）：取生效流程引用所在流程的能力（归属引用优先），没有引用才退回它已有格子记的能力
  return (await db.query(
    `SELECT a.id, COALESCE(
        (SELECT w.capability_id FROM workflow_activity_refs r JOIN workflows w ON w.id = r.workflow_id
          WHERE r.activity_id = a.id AND r.active ORDER BY (r.source_ref IS NULL) DESC, w.created_at LIMIT 1),
        (SELECT c.journey_id FROM activity_cells c WHERE c.step_id = a.id ORDER BY c.id LIMIT 1)) AS journey_id
       FROM activities a WHERE a.id = $1`, [activityId])).rows[0];
}

/**
 * 按对账结论给 readback 格翻色（converged→绿，diverged→红，converging→待判，no_data 等其它结论不动）。
 * 格子不全时先补齐 8 个灰格，翻色只动这一格。journeyId 省略时现查。
 */
export async function applyReadbackCell(db, activityId, verdict, { journeyId } = {}) {
  const cell = CELL_FOR_VERDICT[verdict];
  if (!cell) return false;
  const jid = journeyId !== undefined ? journeyId : (await capabilityOf(db, activityId))?.journey_id;
  // 合同同步新建的 Activity 没有验收格：先补齐固定 8 格再翻色，不然这条 UPDATE 命中 0 行，颜色静默丢了
  if (jid) await ensureEightCells(db, activityId, jid);
  await db.query(
    `UPDATE activity_cells SET cell_status = $2
      WHERE step_id = $1 AND cell_key = 'readback' AND parent_cell_key IS NULL AND cell_status IS DISTINCT FROM $2`, [activityId, cell]);
  return true;
}

/**
 * 读库对账：版本化运行按冻结Steps、实现和环境隔离；旧协议仅作诊断。
 * applyCell=true（默认）时按结论把 readback 格翻色；false 只算报告不动格子（自动裁判先判这次运行跑完没有再决定翻不翻）。
 */
export async function reconcileActivity(db, activityId, { runsWanted = 5, requiredGreen = 5, applyCell = true, triggerRunId = null } = {}) {
  const act = await capabilityOf(db, activityId);
  if (!act) throw Object.assign(new Error(`activity_not_found: ${activityId}`), { status: 404 });
  // Step归属只恢复旧事实诊断；冻结binding仍校验原span身份，不借当前Step授予晋级。
  const spans = (await db.query(
    `SELECT s.run_id, s.step_id, s.outcome, s.evidence, s.attempts, s.started_at, s.activity_definition_version_id,
            s.identity_protocol, s.run_binding_id,
            EXISTS (SELECT 1 FROM run_definition_bindings b WHERE b.id=s.run_binding_id AND b.run_id=s.run_id
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.expected_path) p WHERE p->>'activity_id'=s.activity_id::text
                AND p->>'activity_definition_version_id'=s.activity_definition_version_id::text
                AND p->>'step_id'=s.step_id::text)) AS binding_verified
      FROM spans s LEFT JOIN steps st ON st.id=s.step_id
      WHERE s.step_id IS NOT NULL AND COALESCE(s.activity_id,st.activity_id) = $1 ORDER BY s.started_at`, [activityId])).rows;
  const parents = spans.length ? (await db.query(
    `SELECT t.id, t.result->'workflow_control' AS control, to_jsonb(v) AS verify_task
      FROM tasks t JOIN tasks v ON v.id::text=t.result->'workflow_control'->>'verify_task_id'
      WHERE t.result->'workflow_control'->'envelope'->>'run_id'=ANY($1::text[])
        AND t.result->'workflow_control'->>'phase'='final' AND t.status IN ('completed','completed_no_pr')`, [[...new Set(spans.map(s=>s.run_id))]])).rows : [];
  const verifiedRuns = new Set(parents.filter(t => t.control?.verdict === 'PASS'
    && independentVerification(t.verify_task,t.id,t.control.envelope)).map(t=>t.control.envelope.run_id));
  for (const span of spans) span.independent_verified=verifiedRuns.has(span.run_id);
  const primary = spans.filter(s => independent(s) && evidenceScopeOf(s));
  const target = (triggerRunId ? primary.filter(s => s.run_id === triggerRunId) : primary)
    .sort((a,b) => Date.parse(b.started_at)-Date.parse(a.started_at))[0];
  const scope = evidenceScopeOf(target);
  let steps, frozenPayload;
  if (scope) {
    const version = (await db.query('SELECT payload FROM activity_definition_versions WHERE activity_id=$1 AND id=$2',
      [activityId,scope.activity_definition_version_id])).rows[0];
    if (!version) throw new Error('frozen_activity_definition_missing');
    frozenPayload=version.payload;
    steps = (version.payload.steps || []).map(s => ({id:s.step_id,key:s.locator?.step_key,
      readback:s.contract?.readback ?? s.registration?.readback})).filter(s => s.id);
  } else {
    steps = (await db.query('SELECT id, key, readback FROM steps WHERE activity_id = $1 AND active IS NOT FALSE ORDER BY step_order', [activityId])).rows;
  }
  for (const span of spans) {
    const parent=parents.find(t => t.control?.envelope?.run_id===span.run_id);
    span.scope_verified=span.binding_verified===true && frozenScopeMatches(evidenceScopeOf(span),frozenPayload,parent?.control?.envelope?.contract?.environment);
  }
  const report = reconcileSteps({ steps, spans: triggerRunId && !scope ? spans.filter(s=>s.run_id===triggerRunId) : spans, runsWanted, requiredGreen, evidenceScope:scope });
  // 旧协议仅供诊断；缺固定身份或没有实际观测，不能替代独立业务验收。
  if (!scope || !steps.length || !report.promotion_eligible) { report.converged=false; report.promotion_eligible=false; if (report.verdict==='converged') report.verdict='converging'; }
  if (applyCell) await applyReadbackCell(db, activityId, report.verdict, { journeyId: act.journey_id });
  return { activity_id: activityId, ...report };
}
