// spec_review 活动（合同对抗 v2）：QA 立场评审 ⇄ 开发逐条采纳/驳回并改规格，循环到代码判通过。
// 主理人决策（02d8e749，记忆 harness-gan-design）：不设轮数上限；靠走势收敛——发散/震荡强制通过 + P1 + 升级给 coding commander；
// 只有「真坏掉」才中止：评审连续 3 次格式不合格、累计花费超上限、claude 失败、越界写、01 被改。
// 每轮产物：02-review-rN.md（QA）、02-response-rN.md（开发对每个问题的采纳/驳回）；结束时最终一轮另存为 02-review.md 供链校验与 PR。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail, log } from '../lib/protocol.mjs';
import { intentIdsError } from '../lib/intent.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, snapshotChanges, outOfScopeChanges,
} from '../lib/claude.mjs';
import { sha256File, chainTamperFailure } from '../lib/guards.mjs';
import { reportErrors } from '../lib/md-chain.mjs';
import { parseReview, openIssuesAfter } from '../lib/review.mjs';
import { decide, detectTrend, stalled } from '../lib/gan.mjs';
import { sessionCostUsd } from '../lib/transcript.mjs';
import { SPEC_FILE, INTENT_FILE, specErrors, specIds, qaScenarios, judgmentPoints, untrackedDeferrals } from '../lib/spec-check.mjs';
import { INVARIANTS_FILE, loadInvariantIds } from '../lib/invariants.mjs';

const REVIEW_FILE = '02-review.md';
const TIMEOUT = { envVar: 'CODING_WF_SPEC_REVIEW_TIMEOUT_MS', defaultMs: 900000 };
const BUDGET_RESERVE_MS = 15000;
const MAX_BAD_REVIEW_STREAK = 3; // 不是轮数上限：拿到合格评审就清零
const DEFAULT_BUDGET_USD = 20;
const PROMPTS = { spec_review: 'spec-review', spec_revise: 'spec-revise' };
const ARGS = ['--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash', '--output-format', 'stream-json', '--verbose'];

const reviewName = (n) => `02-review-r${n}.md`;
const responseName = (n) => `02-response-r${n}.md`;
const money = (x) => Math.round(x * 10000) / 10000;
const brief = (issues) => issues.map(({ id, severity, targets }) => ({ id, severity, targets }));

function budgetUsd() {
  const v = Number(process.env.CODING_WF_GAN_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_BUDGET_USD;
}

/** 本会话超时：默认/覆盖值，再与 budget 剩余时间取小（下限 1000ms）。 */
function sessionTimeoutMs(budget, startedAt) {
  const ms = claudeTimeoutMs(budget, TIMEOUT);
  const budgetS = budget?.max_duration_s;
  if (!Number.isFinite(budgetS) || budgetS <= 0) return ms;
  return Math.min(ms, Math.max(1000, budgetS * 1000 - BUDGET_RESERVE_MS - (Date.now() - startedAt)));
}

const DEFAULT_BRAIN_URL = 'http://localhost:5221';
const BRAIN_TIMEOUT_MS = 15000;

async function brainJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(BRAIN_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 判定点写库并回读自证（审计 #14，旧 reviewer 9.4/9.6：a85e0582 登记表被静默漏写）：
 * topic `判定点[<task 前 8 位>#n]: <名称>` 作去重键（重跑不重复写）；写完回读同前缀条数作为 judgments_written。
 */
async function writeJudgments(brainUrl, taskId, points) {
  const base = String(brainUrl || DEFAULT_BRAIN_URL).replace(/\/+$/, '');
  const prefix = `判定点[${String(taskId).slice(0, 8)}#`;
  const list = async () => {
    const r = await brainJson(`${base}/api/brain/strategic-decisions?category=judgment&limit=1000`);
    return new Set((r?.data ?? []).map((d) => d.topic).filter((t) => typeof t === 'string' && t.startsWith(prefix)));
  };
  const existing = await list();
  for (const [i, j] of points.entries()) {
    const topic = `${prefix}${i + 1}]: ${j.name}`;
    if (existing.has(topic)) continue;
    await brainJson(`${base}/api/brain/strategic-decisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'judgment', topic, decision: `所选方法: ${j.chosen}｜候选: ${j.candidates}`,
        reason: `依据: ${j.basis}｜误判后果: ${j.consequence}｜来源: coding workflow 合同对抗`,
        made_by: 'ai', author: 'coding-workflow', source_ref: `coding-workflow:${taskId}`,
      }),
    });
  }
  return (await list()).size;
}

/** 起一个全新会话（评审或改写）；返回 { failure } 或 { cost }。会话后查：claude 失败 → 越界写 → 01 哈希。 */
async function runSession(ctx, role, vars) {
  const { input, worktree, sprintDir, dir } = ctx;
  const before = await snapshotChanges(worktree);
  const prompt = loadPrompt(PROMPTS[role], vars);
  const run = await runClaude({ args: ['-p', prompt, ...ARGS], cwd: worktree, timeoutMs: sessionTimeoutMs(input.budget, ctx.startedAt), tag: role, isolateRemote: true });
  const failure = claudeFailure(run, { streamJson: true });
  if (failure) return { failure };
  const stray = await outOfScopeChanges(worktree, sprintDir, before, role);
  if (stray.length > 0) return { failure: fail('fatal', 'spec_review_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] }) };
  const tampered = chainTamperFailure(dir, { intent_sha256: input.intent_sha256 });
  if (tampered) return { failure: tampered };
  return { cost: sessionCostUsd(run.stdout) };
}

/** 读并解析本轮评审；格式问题返回 { errors }，否则 { review }。 */
function readReview(file, { taskId, ids, intentIds, prevOpen, usedIds, requirePivot, untracked = [] }) {
  if (!fs.existsSync(file)) return { errors: ['review_missing'] };
  const text = fs.readFileSync(file, 'utf8');
  // 问题可针对 S-n / I-n / QA 场景 Q-n（evaluator 的测试计划）
  const qaIds = qaScenarios(fs.readFileSync(path.join(path.dirname(file), SPEC_FILE), 'utf8')).map((q) => q.id);
  const review = parseReview(text, { specIds: [...ids, ...qaIds], intentIds, priorIds: prevOpen.map((i) => i.id), usedIds });
  const errors = [...reportErrors(text, { taskId, step: 'spec_review', coversFile: SPEC_FILE, ids }), ...review.errors];
  // 原地打转时评审必须给出换思路（审计 #27）
  if (requirePivot && !/^## 换思路\s*$/m.test(text)) errors.push('pivot_missing');
  // 「后续再做」却没登记任务的驳回（审计 #16）：QA 不能关掉
  for (const p of review.prior) if (p.status === '关闭' && untracked.includes(p.id)) errors.push(`deferral_closed_without_task:${p.id}`);
  return errors.length > 0 ? { errors } : { review };
}

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, intent_ids: intentIds, task_id: taskId } = input;
  const { dir } = validateBase(input);
  const idsError = intentIdsError(intentIds);
  if (idsError) return fail('fatal', idsError);
  const tamperedBefore = chainTamperFailure(dir, { intent_sha256: input.intent_sha256 });
  if (tamperedBefore) return tamperedBefore;
  const specPath = path.join(dir, SPEC_FILE);
  if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');

  const ctx = { input, worktree, sprintDir, dir, startedAt: Date.now() };
  const base = {
    TASK_ID: taskId, INTENT_PATH: path.join(dir, INTENT_FILE), SPEC_PATH: specPath, INTENT_IDS: intentIds.join(','), INVARIANTS_PATH: path.join(dir, INVARIANTS_FILE),
  };
  const invariantIds = loadInvariantIds(dir);
  const budget = budgetUsd();
  const history = [];
  let prevOpen = [];
  const usedIds = [];
  let cost = 0;
  let badStreak = 0;
  let reviewErrors = [];
  let untracked = [];
  // 重试必须带新信息（审计 #33）：每个会话都拿到当前 02 的程序校验问题（活动被重试时，上次改写可能把规格改坏了）
  const specErrorsNow = () => specErrors(fs.readFileSync(specPath, 'utf8'), taskId, intentIds, { invariantIds }).join(' ') || '无';

  const overBudget = () => cost > budget
    && fail('fatal', 'gan_budget_exceeded', { evidence: [{ cost_usd: money(cost), budget_usd: budget, rounds: history.length, open_issues: brief(prevOpen) }] });

  const finish = async (verdict, round, trend, open) => {
    fs.copyFileSync(path.join(dir, reviewName(round)), path.join(dir, REVIEW_FILE));
    const gan = { verdict, rounds: round, trend, open_issues: brief(open), cost_usd: money(cost), scores: history.at(-1).scores };
    const outputs = { review_file: REVIEW_FILE, review_rounds: round, spec_sha256: sha256File(specPath), gan };
    const escalations = [];
    if (verdict === 'FORCED') {
      log(`[coding-gan][P1] 合同对抗走势 ${trend}，第 ${round} 轮强制通过，仍开着 ${open.map((i) => i.id).join(',') || '无'}，升级给 coding commander`);
      escalations.push({ type: 'gan_forced', trend, round, open_issues: brief(open) });
    }
    // 判定点写库（审计 #14）：写不进去不挡合同，但升级、不静默
    const points = judgmentPoints(fs.readFileSync(specPath, 'utf8'));
    gan.judgments_written = 0;
    if (points.length > 0) {
      try {
        gan.judgments_written = await writeJudgments(input.brain_url, taskId, points);
      } catch (error) {
        log(`[coding-gan][P1] 判定点 ${points.length} 条写入 Brain 失败：${error?.message || error}，升级给 coding commander`);
        escalations.push({ type: 'judgments_write_failed', count: points.length, error: String(error?.message || error) });
      }
    }
    if (escalations.length > 0) outputs.escalations = escalations;
    return { status: 'completed', outputs, evidence: [`合同对抗 ${verdict}：${round} 轮，走势 ${trend}，花费 $${money(cost)}`] };
  };

  for (;;) {
    const round = history.length + 1;
    const reviewPath = path.join(dir, reviewName(round));
    fs.rmSync(reviewPath, { force: true });
    const ids = specIds(fs.readFileSync(specPath, 'utf8'));
    const stuck = stalled(history);
    const reviewed = await runSession(ctx, 'spec_review', {
      ...base,
      REVIEW_PATH: reviewPath,
      SPEC_IDS: ids.join(','),
      ROUND: String(round),
      PRIOR_OPEN: prevOpen.map((i) => i.id).join(',') || '无',
      PREV_REVIEW_PATH: round > 1 ? path.join(dir, reviewName(round - 1)) : '无',
      PREV_RESPONSE_PATH: round > 1 ? path.join(dir, responseName(round - 1)) : '无',
      USED_IDS: usedIds.join(',') || '无',
      SPEC_ERRORS: specErrorsNow(),
      PREV_REVIEW_ERRORS: reviewErrors.join(' ') || '无',
      STUCK: stuck ? '是' : '否',
      UNTRACKED_DEFERRALS: untracked.join(',') || '无',
    });
    if (reviewed.failure) return reviewed.failure;
    cost += reviewed.cost;
    const blown = overBudget();
    if (blown) return blown;

    const { review, errors } = readReview(reviewPath, { taskId, ids, intentIds, prevOpen, usedIds, requirePivot: stuck, untracked });
    if (errors) {
      badStreak += 1;
      reviewErrors = errors;
      log(`[spec_review] 第 ${round} 轮评审格式不合格（连续 ${badStreak} 次）：${errors.join(' ')}`);
      if (badStreak >= MAX_BAD_REVIEW_STREAK) return fail('fatal', 'review_invalid', { evidence: [{ review_errors: errors }] });
      continue;
    }
    badStreak = 0;
    reviewErrors = [];
    usedIds.push(...review.issues.map((i) => i.id));
    const open = openIssuesAfter(prevOpen, review);
    history.push({ scores: review.scores, specLines: fs.readFileSync(specPath, 'utf8').split('\n').length });

    const decision = decide({ scores: review.scores, openIssues: open });
    if (decision.approved) return finish('APPROVED', round, detectTrend(history), open);
    const trend = detectTrend(history);
    if (trend === 'diverging' || trend === 'oscillating') return finish('FORCED', round, trend, open);
    log(`[spec_review] 第 ${round} 轮未通过：${decision.reasons.join(' ')}；走势 ${trend}，继续对抗`);

    const responsePath = path.join(dir, responseName(round));
    fs.rmSync(responsePath, { force: true });
    const revised = await runSession(ctx, 'spec_revise', {
      ...base, REVIEW_PATH: reviewPath, RESPONSE_PATH: responsePath, OPEN_ISSUES: open.map((i) => i.id).join(',') || '无',
      SPEC_ERRORS: specErrorsNow(), STUCK: stalled(history) ? '是' : '否',
    });
    if (revised.failure) return revised.failure;
    cost += revised.cost;
    prevOpen = open;
    const blownAfterRevise = overBudget();
    if (blownAfterRevise) return blownAfterRevise;
    if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');
    const specErr = specErrors(fs.readFileSync(specPath, 'utf8'), taskId, intentIds, { invariantIds });
    if (specErr.length > 0) return fail('retryable', 'spec_invalid', { evidence: [{ spec_errors: specErr }] });
    if (!fs.existsSync(responsePath)) return fail('retryable', 'response_missing', { evidence: [{ round }] });
    untracked = untrackedDeferrals(fs.readFileSync(responsePath, 'utf8')).filter((id) => open.some((i) => i.id === id));
  }
});
