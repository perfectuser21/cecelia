/**
 * Harness v2 — Phase A GAN 合同对抗循环
 *
 * PRD: docs/design/harness-v2-prd.md §3.1 阶段 A · §5.2 Proposer / §5.3 Reviewer
 * 上游：harness-initiative-runner.js runInitiative — Planner 产出 PRD 后调用
 * 下游：把 APPROVED 的 contract_content + review_rounds 写回 initiative_contracts
 *
 * 流程（每轮）：
 *   1. Proposer 读 PRD（+上轮 Reviewer feedback）→ 产 contract-draft.md（stdout）
 *   2. Reviewer 读 PRD + draft → 输出 VERDICT: APPROVED | REVISION (+ feedback)
 *   3. APPROVED → 返回最终 contract_content + rounds
 *      REVISION → feedback 拼到下一轮 Proposer
 *   4. round > MAX_GAN_ROUNDS 仍未 APPROVED → 抛错
 */
import { executeInDocker } from './docker-executor.js';
import { parseDockerOutput, loadSkillContent, extractVerdict } from './harness-graph.js';

export const MAX_GAN_ROUNDS = 5;

/**
 * 跑一轮 Proposer + Reviewer 对抗，直到 APPROVED 或超过 MAX_GAN_ROUNDS。
 *
 * @param {object} p
 * @param {object} p.task                Brain task 行（提供 id 给 prompt + executor）
 * @param {string} p.initiativeId        Initiative UUID
 * @param {string} p.prdContent          Planner 产出的 PRD 正文
 * @param {string} p.worktreePath        Docker mount 的 worktree 绝对路径
 * @param {string} p.githubToken         注入容器的 GITHUB_TOKEN
 * @param {string} [p.sprintDir='sprints']
 * @param {Function} [p.executor]        Docker 执行器（测试注入）
 * @param {number} [p.maxRounds]         覆盖 MAX_GAN_ROUNDS（测试用）
 * @returns {Promise<{
 *   contractContent: string,
 *   reviewRounds: number,
 *   approvedAt: Date,
 * }>}
 * @throws {Error}                       超过 maxRounds 仍未 APPROVED
 */
export async function runGanContractLoop({
  task,
  initiativeId,
  prdContent,
  worktreePath,
  githubToken,
  sprintDir = 'sprints',
  executor,
  maxRounds = MAX_GAN_ROUNDS,
}) {
  if (!task || !task.id) throw new Error('runGanContractLoop: task.id required');
  if (!prdContent) throw new Error('runGanContractLoop: prdContent required');

  const exec = executor || executeInDocker;
  const proposerSkill = loadSkillContent('harness-contract-proposer');
  const reviewerSkill = loadSkillContent('harness-contract-reviewer');

  let round = 0;
  let lastContract = '';
  let lastFeedback = '';

  while (round < maxRounds) {
    round += 1;

    // ── Proposer ────────────────────────────────────────────────────────
    const proposerPrompt = buildProposerPrompt({
      skill: proposerSkill,
      task,
      initiativeId,
      sprintDir,
      round,
      prdContent,
      reviewFeedback: lastFeedback,
    });

    const proposerRes = await exec({
      task: { ...task, task_type: 'harness_contract_propose' },
      prompt: proposerPrompt,
      worktreePath,
      env: {
        CECELIA_CREDENTIALS: 'account1',
        CECELIA_TASK_TYPE: 'harness_contract_propose',
        HARNESS_NODE: 'proposer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_PROPOSE_ROUND: String(round),
        GITHUB_TOKEN: githubToken,
      },
    });

    if (proposerRes.exit_code !== 0 || proposerRes.timed_out) {
      throw new Error(
        `proposer round ${round} failed: ` +
        (proposerRes.timed_out
          ? 'Docker timeout'
          : `exit=${proposerRes.exit_code} ${(proposerRes.stderr || '').slice(-300)}`)
      );
    }
    lastContract = parseDockerOutput(proposerRes.stdout) || '';
    if (!lastContract) {
      throw new Error(`proposer round ${round} returned empty contract`);
    }

    // ── Reviewer ────────────────────────────────────────────────────────
    const reviewerPrompt = buildReviewerPrompt({
      skill: reviewerSkill,
      task,
      initiativeId,
      sprintDir,
      round,
      prdContent,
      contractContent: lastContract,
    });

    const reviewerRes = await exec({
      task: { ...task, task_type: 'harness_contract_review' },
      prompt: reviewerPrompt,
      worktreePath,
      env: {
        CECELIA_CREDENTIALS: 'account1',
        CECELIA_TASK_TYPE: 'harness_contract_review',
        HARNESS_NODE: 'reviewer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_REVIEW_ROUND: String(round),
        GITHUB_TOKEN: githubToken,
      },
    });

    if (reviewerRes.exit_code !== 0 || reviewerRes.timed_out) {
      throw new Error(
        `reviewer round ${round} failed: ` +
        (reviewerRes.timed_out
          ? 'Docker timeout'
          : `exit=${reviewerRes.exit_code} ${(reviewerRes.stderr || '').slice(-300)}`)
      );
    }
    const reviewerOut = parseDockerOutput(reviewerRes.stdout) || '';
    const verdict = extractVerdict(reviewerOut, ['APPROVED', 'REVISION']);

    console.log(
      `[harness-gan-loop] round=${round} verdict=${verdict || 'UNKNOWN'} task=${task.id}`
    );

    if (verdict === 'APPROVED') {
      return {
        contractContent: lastContract,
        reviewRounds: round,
        approvedAt: new Date(),
      };
    }

    lastFeedback = reviewerOut;
  }

  throw new Error(
    `gan_loop_exceeded_max_rounds: ${maxRounds} rounds without APPROVED ` +
    `(initiative=${initiativeId}, task=${task.id})`
  );
}

function buildProposerPrompt({ skill, task, initiativeId, sprintDir, round, prdContent, reviewFeedback }) {
  const feedbackBlock = reviewFeedback
    ? `\n\n## Reviewer 反馈（Round ${round - 1}）\n${reviewFeedback}\n`
    : '';
  return `你是 harness-contract-proposer agent。按下面 SKILL 指令工作。

${skill}

---

## 本次任务参数
**task_id**: ${task.id}
**initiative_id**: ${initiativeId}
**sprint_dir**: ${sprintDir}
**propose_round**: ${round}

## PRD 内容
${prdContent}
${feedbackBlock}
## 输出要求
1. 写 ${sprintDir}/contract-draft.md（功能范围 + Workstreams + DoD + 验证命令）
2. 在 stdout 输出完整合同正文
3. 末行字面量 JSON：{"verdict":"PROPOSED",...}`;
}

function buildReviewerPrompt({ skill, task, initiativeId, sprintDir, round, prdContent, contractContent }) {
  return `你是 harness-contract-reviewer agent。按下面 SKILL 指令工作。

${skill}

---

## 本次任务参数
**task_id**: ${task.id}
**initiative_id**: ${initiativeId}
**sprint_dir**: ${sprintDir}
**review_round**: ${round}

## PRD 内容
${prdContent}

## 合同草案
${contractContent}

## 输出要求
- 输出最后一行必须包含 \`VERDICT: APPROVED\` 或 \`VERDICT: REVISION\`
- REVISION 时必须给出具体修改建议（拼到 stdout）`;
}
