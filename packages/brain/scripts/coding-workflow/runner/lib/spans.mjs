// coding workflow 执行记录上报 Brain spans（决策 b34e346a，审计 #24/#26，旧 controller phase-event 心跳 / relay-runs 进度）。
// 每个活动的每次尝试一条 span，run_id = coding-workflow:<task_id>；runs 表由触发器自动汇总，runs-notion-push 同步 Notion「最近执行」。
// activity_id 必须是已登记的 Activity：迁移 542 按下面的固定 id 登记（有测试核对两边一致）。
// 只报 Activity 级 span：没有登记 Step，自动裁判判 no_data 不落库，格子不会被判红。
export const CODING_WORKFLOW_ID = 'c0de0000-0000-4000-8000-000000000001';
export const ACTIVITY_IDS = {
  intent: 'c0de0000-0000-4000-8000-000000000101',
  spec: 'c0de0000-0000-4000-8000-000000000102',
  spec_review: 'c0de0000-0000-4000-8000-000000000103',
  build: 'c0de0000-0000-4000-8000-000000000104',
  verify: 'c0de0000-0000-4000-8000-000000000105',
  chain_check: 'c0de0000-0000-4000-8000-000000000106',
  publish: 'c0de0000-0000-4000-8000-000000000107',
  report: 'c0de0000-0000-4000-8000-000000000108',
  ci_fix: 'c0de0000-0000-4000-8000-000000000109',
  qa: 'c0de0000-0000-4000-8000-00000000010a',
  judge: 'c0de0000-0000-4000-8000-00000000010b',
  merge: 'c0de0000-0000-4000-8000-00000000010c',
};
// 起 claude / 调模型的环节记 agent，纯程序记 code（spans.executor_kind 只认 code/agent/human）
const AGENT = new Set(['spec', 'spec_review', 'build', 'verify', 'ci_fix', 'qa', 'judge']);
const OUTCOME = { completed: 'pass', skipped: 'skipped', failed: 'fail', partial: 'fail' };

const runId = (taskId) => `coding-workflow:${taskId}`;
const iso = (ms) => new Date(ms).toISOString();
const base = (taskId, key) => ({
  run_id: runId(taskId), activity_id: ACTIVITY_IDS[key], workflow_id: CODING_WORKFLOW_ID,
  executor_kind: AGENT.has(key) ? 'agent' : 'code',
});

/**
 * 执行器回执 → spans。各活动串行执行，起止时间 = 本次运行开始时间 + 前面尝试的累计耗时（回执只有 duration_s）。
 * 跳过的活动报一条 skipped（occurrence 0）；不认识的活动不报。
 */
export function chainSpans(receipt, { taskId, startedAt }) {
  const out = [];
  let cursor = startedAt;
  for (const a of Array.isArray(receipt?.activities) ? receipt.activities : []) {
    if (!ACTIVITY_IDS[a?.key]) continue;
    const attempts = Array.isArray(a.attempts) ? a.attempts : [];
    if (attempts.length === 0) {
      out.push({ ...base(taskId, a.key), started_at: iso(cursor), ended_at: iso(cursor), outcome: OUTCOME[a.status] ?? 'unknown', occurrence_key: `${a.key}:0` });
      continue;
    }
    for (const t of attempts) {
      const end = cursor + Math.round((Number(t?.transport?.duration_s) || 0) * 1000);
      const cost = t?.metrics?.cost_usd;
      out.push({
        ...base(taskId, a.key), started_at: iso(cursor), ended_at: iso(end), outcome: OUTCOME[t?.status] ?? 'unknown',
        ...(typeof cost === 'number' ? { cost_usd: cost } : {}),
        occurrence_key: `${a.key}:${t?.attempt ?? 0}`,
        ...(t?.reason_code ? { evidence: { reason_code: t.reason_code } } : {}),
      });
      cursor = end;
    }
  }
  return out;
}

/**
 * runner 侧环节（ci_fix/qa/judge/merge）一条 span；occurrence 由调用方给（PR 号 + 轮次/尝试次数）。
 * terminal：本次运行的终态（合并）——evidence.run_terminal，runs 结果以它为准（迁移 546），GAN 中途的 FAIL 轮不决定终态。
 */
export function gateSpan({ taskId, key, startedAt, endedAt, ok, costUsd, occurrence, evidence, terminal = false }) {
  if (!ACTIVITY_IDS[key]) return null;
  if (terminal) evidence = { ...evidence, run_terminal: true };
  return {
    ...base(taskId, key), started_at: iso(startedAt), ended_at: iso(endedAt), outcome: ok ? 'pass' : 'fail',
    ...(typeof costUsd === 'number' ? { cost_usd: costUsd } : {}),
    occurrence_key: `${key}:${occurrence}`,
    ...(evidence ? { evidence } : {}),
  };
}

/** 上报（尽力而为：执行记录写不进去不影响主流程，只记日志）。 */
export async function postSpans(ctx, spans) {
  const rows = spans.filter(Boolean);
  if (rows.length === 0 || typeof ctx.brain?.postSpans !== 'function') return;
  try {
    const r = await ctx.brain.postSpans(rows);
    if (!r.ok) ctx.log(`执行记录上报 Brain 失败（HTTP ${r.status}）：${rows.map((s) => s.occurrence_key).join(',')}`);
  } catch (error) {
    ctx.log(`执行记录上报 Brain 失败：${error?.message || error}`);
  }
}
