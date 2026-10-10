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

const GREEN_OK = new Set(['verified', 'skipped', 'exempt']);
const ISSUE_CODE = { mismatch: 'step_readback_mismatch', unverified: 'step_unobserved', failed: 'step_failed', missing: 'step_missing' };

function statusOf(step, span) {
  if (step.readback?.type === 'none' && !span) return 'exempt';
  if (!span) return 'missing';
  if (span.outcome === 'skipped') return 'skipped';
  if (span.outcome === 'fail') return 'failed';
  if (step.readback?.type === 'none') return 'exempt';
  const observed = span.evidence?.observed;
  const result = evaluateReadback(step.readback, observed);
  if (result.verdict === 'pass') return 'verified';
  if (result.verdict === 'fail') return 'mismatch';
  return 'unverified';
}

/**
 * @param {{steps:{id:string,key:string,readback:object}[], spans:object[], runsWanted?:number, requiredGreen?:number}} input
 *   spans = Step 级 span（run_id/step_id/outcome/evidence.observed/started_at）
 */
export function reconcileSteps({ steps, spans, runsWanted = 5, requiredGreen = 5 }) {
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
      const status = statusOf(step, mine.at(-1));
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
  return { verdict, converged, consecutive_green: consecutive, required_green: requiredGreen, runs, per_step, issues };
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
 * 读库对账：取 Activity 的 active Steps 与它名下全部 Step 级 span 对账。
 * applyCell=true（默认）时按结论把 readback 格翻色；false 只算报告不动格子（自动裁判先判这次运行跑完没有再决定翻不翻）。
 */
export async function reconcileActivity(db, activityId, { runsWanted = 5, requiredGreen = 5, applyCell = true } = {}) {
  const act = await capabilityOf(db, activityId);
  if (!act) throw Object.assign(new Error(`activity_not_found: ${activityId}`), { status: 404 });
  const steps = (await db.query(
    'SELECT id, key, readback FROM steps WHERE activity_id = $1 AND active IS NOT FALSE ORDER BY step_order', [activityId])).rows;
  const spans = (await db.query(
    `SELECT run_id, step_id, outcome, evidence, attempts, started_at FROM spans
      WHERE step_id IS NOT NULL AND (activity_id = $1 OR step_id = ANY($2::uuid[]))
      ORDER BY started_at`, [activityId, steps.map(s => s.id)])).rows;
  const report = reconcileSteps({ steps, spans, runsWanted, requiredGreen });
  if (applyCell) await applyReadbackCell(db, activityId, report.verdict, { journeyId: act.journey_id });
  return { activity_id: activityId, ...report };
}
