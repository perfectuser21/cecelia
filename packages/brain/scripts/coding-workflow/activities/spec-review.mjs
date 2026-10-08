// spec_review 活动：全新 claude 会话只拿 01/02 评审规格，写 <sprint_dir>/02-review.md。
// REVISE 时起改写会话按评审改 02，再起新评审会话；最多改写 2 次（评审 3 次），仍 REVISE 即 fatal。
// 每个会话前后：sprint 目录外改动 → fatal；01 哈希对不上 → chain_tampered（02 在改写中合法变化，不纳入）。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail } from '../lib/protocol.mjs';
import { intentIdsError } from '../lib/intent.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, snapshotChanges, outOfScopeChanges,
} from '../lib/claude.mjs';
import { sha256File, chainTamperFailure } from '../lib/guards.mjs';
import { reportErrors } from '../lib/md-chain.mjs';
import { parseReview } from '../lib/review.mjs';
import { SPEC_FILE, INTENT_FILE, specErrors, specIds } from '../lib/spec-check.mjs';

const REVIEW_FILE = '02-review.md';
const TIMEOUT = { envVar: 'CODING_WF_SPEC_REVIEW_TIMEOUT_MS', defaultMs: 600000 };
const BUDGET_RESERVE_MS = 15000; // 多个会话共享 budget：每个会话按剩余时间再钳一次
const MAX_REVISIONS = 2;
const PROMPTS = { spec_review: 'spec-review', spec_revise: 'spec-revise' };

/** 本会话超时：默认/覆盖值，再与 budget 剩余时间取小（下限 1000ms）。 */
function sessionTimeoutMs(budget, startedAt) {
  const ms = claudeTimeoutMs(budget, TIMEOUT);
  const budgetS = budget?.max_duration_s;
  if (!Number.isFinite(budgetS) || budgetS <= 0) return ms;
  return Math.min(ms, Math.max(1000, budgetS * 1000 - BUDGET_RESERVE_MS - (Date.now() - startedAt)));
}

/** 起一个全新 claude 会话（评审或改写），结束后依次查：claude 失败 → 越界写 → 01 哈希。有问题返回 fail，否则 null。 */
async function runSession(ctx, role, vars) {
  const { input, worktree, sprintDir, dir } = ctx;
  const before = await snapshotChanges(worktree);
  const prompt = loadPrompt(PROMPTS[role], vars);
  const args = ['-p', prompt, '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash'];
  const timeoutMs = sessionTimeoutMs(input.budget, ctx.startedAt);
  const run = await runClaude({ args, cwd: worktree, timeoutMs, tag: role, isolateRemote: true });
  const failure = claudeFailure(run);
  if (failure) return failure;
  const stray = await outOfScopeChanges(worktree, sprintDir, before, role);
  if (stray.length > 0) {
    return fail('fatal', 'spec_review_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] });
  }
  return chainTamperFailure(dir, { intent_sha256: input.intent_sha256 });
}

/** 读并校验 02-review.md：不合格返回 { failure }，否则 { review }（parseReview 结果）。 */
function checkReview(reviewPath, taskId, ids, intentIds) {
  if (!fs.existsSync(reviewPath)) {
    return { failure: fail('retryable', 'review_invalid', { evidence: [{ review_errors: ['review_missing'] }] }) };
  }
  const text = fs.readFileSync(reviewPath, 'utf8');
  const review = parseReview(text, { specIds: ids, intentIds });
  const errors = [
    ...reportErrors(text, { taskId, step: 'spec_review', coversFile: SPEC_FILE, ids }),
    ...review.errors,
  ];
  if (errors.length > 0) return { failure: fail('retryable', 'review_invalid', { evidence: [{ review_errors: errors }] }) };
  return { review };
}

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, intent_ids: intentIds, task_id: taskId } = input;
  const { dir } = validateBase(input);
  const idsError = intentIdsError(intentIds);
  if (idsError) return fail('fatal', idsError);
  const tamperedBefore = chainTamperFailure(dir, { intent_sha256: input.intent_sha256 });
  if (tamperedBefore) return tamperedBefore;

  const specPath = path.join(dir, SPEC_FILE);
  const reviewPath = path.join(dir, REVIEW_FILE);
  if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');

  const ctx = { input, worktree, sprintDir, dir, startedAt: Date.now() };
  const paths = { TASK_ID: taskId, INTENT_PATH: path.join(dir, INTENT_FILE), SPEC_PATH: specPath, REVIEW_PATH: reviewPath };

  for (let round = 1; ; round += 1) {
    const ids = specIds(fs.readFileSync(specPath, 'utf8'));
    // 重试/上一轮的旧评审会被当成新结论，先删
    fs.rmSync(reviewPath, { force: true });
    const reviewFailure = await runSession(ctx, 'spec_review', { ...paths, SPEC_IDS: ids.join(',') });
    if (reviewFailure) return reviewFailure;
    const { failure, review } = checkReview(reviewPath, taskId, ids, intentIds);
    if (failure) return failure;

    if (review.verdict === 'APPROVE') {
      return {
        status: 'completed',
        outputs: { review_file: REVIEW_FILE, review_rounds: round, spec_sha256: sha256File(specPath) },
        evidence: [`${REVIEW_FILE}：第 ${round} 次评审 APPROVE`],
      };
    }
    if (round > MAX_REVISIONS) {
      return fail('fatal', 'spec_review_unresolved', { evidence: [{ unresolved_issues: review.issues.map((i) => i.id) }] });
    }

    const reviseFailure = await runSession(ctx, 'spec_revise', { ...paths, INTENT_IDS: intentIds.join(',') });
    if (reviseFailure) return reviseFailure;
    if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');
    const errors = specErrors(fs.readFileSync(specPath, 'utf8'), taskId, intentIds);
    if (errors.length > 0) return fail('retryable', 'spec_invalid', { evidence: [{ spec_errors: errors }] });
  }
});
