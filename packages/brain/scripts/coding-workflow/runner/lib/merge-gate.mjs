// 合并门（决策 a1fdbc51，对应旧 harness「merge 前 head == 锚定 SHA」硬检查）：runner 亲自合并，且只合并被批准的那个 head。
// 批准 = QA 与独立裁判在该 head 上通过（qa-gate.mjs 记 s.approved.head）。合并条件：当前 head 就是批准的 head、
// 该 head 上规定的必需检查全部登记且全绿 → gh pr merge --squash --match-head-commit <head>（GitHub 侧再校验一次 head）。
// 批准后分支上又出现提交：只碰记录（版本碎片、本 sprint 的 QA 报告/裁决/截图，见 isRecordFile）或只是从 main 合进来
// → 改绑到新 head；动了别的文件（含 01 需求、02 合同）→ 撤销批准，新 head 重新 QA + 裁判。
import { run, git } from './proc.mjs';
import { listOwnPrs, requiredState } from './cifix-scan.mjs';
import { readState, writeState, isRecordFile, escalate } from './qa-gate.mjs';
import { remoteTaskId } from './pr-branch.mjs';
import { readState as readCiFixState } from './cifix-scan.mjs';
import { gateSpan, postSpans } from './spans.mjs';

const GH_TIMEOUT_MS = 60 * 1000;
const MAX_MERGE_FAILURES = 3;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000;

/** 批准之后 PR 自身新增改动的文件（不含 main 合进来的提交与 merge 提交）；取不到返回 null。 */
async function changedSinceApproval(cfg, branch, approvedHead) {
  const fetch = await git(cfg.repo, ['fetch', 'origin', 'main', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeoutMs: FETCH_TIMEOUT_MS });
  if (fetch.code !== 0) return null;
  const log = await git(cfg.repo, ['log', '--no-merges', '--format=', '--name-only', `origin/${branch}`, `^${approvedHead}`, '^origin/main']);
  if (log.code !== 0) return null;
  return [...new Set(log.stdout.split('\n').filter(Boolean))];
}

/** 处理一个已批准的 PR；撤销了批准返回 true。 */
async function gate(ctx, pr, s) {
  const { cfg } = ctx;
  if (pr.headRefOid !== s.approved.head) {
    const files = await changedSinceApproval(cfg, pr.headRefName, s.approved.head);
    if (!files) {
      ctx.log(`合并门 PR #${pr.number}：取批准后的改动失败，本轮不合并`);
      return false;
    }
    const code = files.filter((f) => !isRecordFile(f, pr.headRefName));
    if (code.length > 0) {
      s.passed = false;
      s.revoked = [...(s.revoked ?? []), { at: new Date().toISOString(), reason: 'head_changed_after_approval', from: s.approved.head, to: pr.headRefOid, files: code }];
      writeState(cfg, pr.number, s);
      ctx.log(`合并门 PR #${pr.number}：批准后又改了代码（${code.join('、')}），撤销批准，新 head 重新 QA + 裁判`);
      return true;
    }
    s.approved = { ...s.approved, head: pr.headRefOid, rebound_from: s.approved.head };
    writeState(cfg, pr.number, s);
    ctx.log(`合并门 PR #${pr.number}：批准后只有记录/主干合入，改绑到 ${pr.headRefOid.slice(0, 9)}`);
  }
  if ((await requiredState(cfg, pr.number)).state !== 'pass') return false;
  // task_id 在 sprint 的 01-intent.md 里，只能从远端分支读：必须在合并（--delete-branch 删分支）之前取
  const taskId = await remoteTaskId(cfg, pr.headRefName);
  const startedAt = Date.now();
  // --delete-branch：合并后删远端分支（审计 #28）
  const merge = await run(cfg.ghBin, ['pr', 'merge', String(pr.number), '--squash', '--delete-branch', '--match-head-commit', s.approved.head], { cwd: cfg.repo, timeoutMs: GH_TIMEOUT_MS });
  // 执行记录（决策 b34e346a）：合并成功/失败各一条，失败按累计次数区分幂等键
  if (taskId) {
    await postSpans(ctx, [gateSpan({
      taskId, key: 'merge', startedAt, endedAt: Date.now(), ok: merge.code === 0,
      occurrence: merge.code === 0 ? `${pr.number}` : `${pr.number}:f${(s.merge_failures ?? 0) + 1}`,
      evidence: { head: s.approved.head, ...(merge.code === 0 ? {} : { error: merge.stderr.trim().split('\n').pop() || String(merge.code) }) },
    })]);
  }
  if (merge.code !== 0) {
    await mergeFailed(ctx, pr, s, merge.stderr.trim().split('\n').pop() || String(merge.code));
    return false;
  }
  s.merged = { head: s.approved.head, at: new Date().toISOString() };
  writeState(cfg, pr.number, s);
  ctx.log(`合并门 PR #${pr.number} 已合并（head ${s.approved.head.slice(0, 9)}）`);
  // 完成以合并为准（审计 #7）：合并结果回写 Brain 任务；回写不了必须留痕，不能静默
  if (!taskId) {
    ctx.log(`合并门 PR #${pr.number}：分支上找不到 task_id，合并结果没有回写 Brain`);
    return false;
  }
  const task = await ctx.brain.getTask(taskId);
  const prior = task.ok ? task.body?.result ?? {} : {};
  const ciFix = readCiFixState(cfg, pr.number);
  const cost = costSummary(prior, s, ciFix);
  const r = await ctx.brain.patch(taskId, { result: { merge: { merged: true, ...s.merged }, cost_usd: cost } });
  if (!r.ok) ctx.log(`合并门回写 Brain 任务 ${taskId} 失败（HTTP ${r.status}）`);
  // 交付复盘落库（审计 #22，旧 report 6.5/6.8）：程序按这次的真实记录拼，不让模型编
  const learned = await ctx.brain.postLearnings({
    task_id: taskId, branch_name: pr.headRefName, pr_number: pr.number, repo: 'cecelia', issues_found: [],
    next_steps_suggested: learningLines(taskId, pr, prior, s, ciFix, cost),
  });
  if (!learned.ok) ctx.log(`合并门 PR #${pr.number} 交付复盘写入 learnings 失败（HTTP ${learned.status}）`);
  return false;
}

const money = (x) => Math.round(x * 10000) / 10000;

/** 全链花费（审计 #35）：链路（runner 回执汇总）+ QA 门（evaluate/qa-fix）+ CI 修复。 */
function costSummary(prior, qa, ciFix) {
  const chain = Number(prior.runner?.cost_usd) || 0;
  const q = Number(qa.cost_usd) || 0;
  const c = Number(ciFix.cost_usd) || 0;
  return { chain: money(chain), qa: money(q), ci_fix: money(c), total: money(chain + q + c) };
}

/** 交付复盘：合同对抗、真人 QA 各轮、CI 修复、撤销批准、花费（每条一行写进 learnings）。 */
function learningLines(taskId, pr, prior, qa, ciFix, cost) {
  const gan = prior.coding_workflow?.gan;
  const rounds = qa.rounds ?? [];
  const attempts = ciFix.attempts ?? [];
  const lines = [
    `coding workflow ${String(taskId).slice(0, 8)} 合并复盘（PR #${pr.number}）：`
      + `合同对抗 ${gan ? `${gan.rounds} 轮 ${gan.verdict}（走势 ${gan.trend}）` : '无记录'}；`
      + `真人 QA ${rounds.length} 轮；CI 修复 ${attempts.length} 次；花费 $${cost.total}`,
  ];
  for (const r of rounds) {
    if (r.verdict !== 'PASS') lines.push(`真人 QA 第 ${r.round} 轮 ${r.verdict}（${r.fails ?? 0} 处失败，报告 ${r.report ?? '无'}）${r.fix ? `，修复结果 ${r.fix}` : ''}`);
  }
  for (const a of attempts) {
    lines.push(`CI 修复：${(a.checks ?? a.failed ?? []).join('、') || '失败检查未记录'} → ${a.result ?? a.reason ?? '未知'}`);
  }
  for (const v of qa.revoked ?? []) lines.push(`批准后又改了代码被撤销批准（${(v.files ?? []).join('、')}），重新 QA`);
  if (gan?.verdict === 'FORCED') lines.push(`合同对抗强制通过时仍开着：${(gan.open_issues ?? []).map((i) => i.id).join('、') || '无'}`);
  return lines;
}

/**
 * 合并失败不能静默挂着（审计 #6）：冲突 → 升级 merge_conflict；落后 main → 程序 update-branch
 * （之后的 main 合入按改绑处理）；其他原因累计 MAX_MERGE_FAILURES 次 → 升级 merge_failed。
 */
async function mergeFailed(ctx, pr, s, error) {
  const { cfg } = ctx;
  ctx.log(`合并门 PR #${pr.number} 合并失败：${error}`);
  const view = await run(cfg.ghBin, ['pr', 'view', String(pr.number), '--json', 'mergeable,mergeStateStatus'], { cwd: cfg.repo, timeoutMs: GH_TIMEOUT_MS });
  let info = {};
  try {
    info = JSON.parse(view.stdout);
  } catch { /* 查不到按其他原因计 */ }
  if (info.mergeable === 'CONFLICTING') return escalate(ctx, pr, s, null, { type: 'merge_conflict', error });
  if (info.mergeStateStatus === 'BEHIND') {
    const up = await run(cfg.ghBin, ['pr', 'update-branch', String(pr.number)], { cwd: cfg.repo, timeoutMs: GH_TIMEOUT_MS });
    ctx.log(`合并门 PR #${pr.number}：落后 main，update-branch ${up.code === 0 ? '成功' : '失败'}`);
    return writeState(cfg, pr.number, s);
  }
  s.merge_failures = (s.merge_failures ?? 0) + 1;
  if (s.merge_failures >= MAX_MERGE_FAILURES) return escalate(ctx, pr, s, null, { type: 'merge_failed', error, failures: s.merge_failures });
  return writeState(cfg, pr.number, s);
}

/** 检查所有已批准未合并的 PR；有撤销批准（本轮算做了事）返回 true。不抛错。 */
export async function runMergeGate(ctx) {
  try {
    const prs = await listOwnPrs(ctx.cfg);
    let acted = false;
    for (const pr of prs ?? []) {
      const s = readState(ctx.cfg, pr.number);
      if (!s.passed || !s.approved?.head || s.merged || s.escalated) continue;
      if (await gate(ctx, pr, s)) acted = true;
    }
    return acted;
  } catch (error) {
    ctx.log(`合并门出错：${error?.message || error}`);
    return false;
  }
}
