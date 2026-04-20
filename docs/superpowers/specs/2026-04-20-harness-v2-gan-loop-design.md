# Harness v2 Phase A GAN 合同循环集成（PR-4/4 · 最后一步）

**日期**：2026-04-20
**分支**：cp-0420183355-harness-v2-gan-loop
**Brain Task**：eeaa905a-413c-4bcf-95d0-8e919cdcea26
**依赖**：PR-1 #2469 / PR-2 #2476 / PR-3 #2479 已合并

## 背景

`harness-initiative-runner.js` 现在只做：Planner docker run → 建 draft 合同 → 建 run（phase='A_contract'）。合同 `contract_content=NULL`、`status='draft'`、`review_rounds=0` 永远不变，PR-3 phase advancer 等不到 `status='approved'` 就不晋级。E2E 就卡在 Planner 完成的一刻。

## 目标

让 runner 在 Planner 成功后立即跑 **Proposer ↔ Reviewer 的 GAN 对抗循环**，直到 Reviewer 返回 `VERDICT: APPROVED`，再把最终合同写入 DB（`status='approved'`, `contract_content`, `review_rounds`, `approved_at`），并直接让 `initiative_runs.phase='B_task_loop'`。

## 关键约束（memory `harness-gan-design.md`）

- **GAN 对抗轮次无上限**（刻意设计）：禁止加 `MAX_GAN_ROUNDS`
- 终止条件由 Reviewer SKILL.md 内置"找不到 ≥2 个风险点就 APPROVED"保证
- 安全网：`initiative_contracts.budget_cap_usd`（默认 10）——累积 cost 超过就 abort

## 架构

```
runInitiative(task)
  1. ensureHarnessWorktree + resolveGitHubToken（已有，PR-1）
  2. Planner docker run → PRD content（已有）
  3. GAN loop（PR-4 新增）：
       await runGanContractLoop({
         taskId, initiativeId, sprintDir, prdContent,
         executor, readContractFile, worktreePath, githubToken, budgetCapUsd
       })
       => { contract_content, rounds, cost_usd }
  4. BEGIN tx → INSERT initiative_contracts（status='approved', contract_content, review_rounds, approved_at）
  5. INSERT initiative_runs（phase='B_task_loop'）
  6. upsertTaskPlan
  7. COMMIT
```

## 组件

### 新增 `packages/brain/src/harness-gan-loop.js`（~150 行）

```
runGanContractLoop({
  taskId, initiativeId, sprintDir, prdContent,
  executor, readContractFile?,
  worktreePath, githubToken,
  budgetCapUsd = 10,
}) -> Promise<{ contract_content, rounds, cost_usd, review_feedback_history }>

内部循环：
  round = 0
  cost = 0
  feedback = null
  while (true):
    round++

    // ── Proposer ──
    proposerPrompt = buildProposerPrompt(prdContent, feedback, round)
    proposerResult = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
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
    })
    if (proposerResult.exit_code !== 0) throw new Error('proposer_failed')
    cost += (proposerResult.cost_usd || 0)

    // 读 contract-draft.md 从 worktreePath/sprintDir/
    contract_content = await readContractFile(worktreePath, sprintDir)

    // ── Reviewer ──
    reviewerPrompt = buildReviewerPrompt(prdContent, contract_content, round)
    reviewerResult = await executor({
      task: { id: taskId, task_type: 'harness_contract_review' },
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
    })
    if (reviewerResult.exit_code !== 0) throw new Error('reviewer_failed')
    cost += (reviewerResult.cost_usd || 0)

    if (cost > budgetCapUsd) throw new Error('gan_budget_exceeded')

    verdict = extractVerdict(reviewerResult.stdout)  // /VERDICT:\s*(APPROVED|REVISION)/i
    if (verdict === 'APPROVED') return { contract_content, rounds: round, cost_usd: cost }

    // REVISION（或未命中）→ 拼 feedback 给下一轮 Proposer
    feedback = extractFeedback(reviewerResult.stdout)
```

**Default `readContractFile`**：`path.join(worktreePath, sprintDir, 'contract-draft.md')` 用 `fs/promises.readFile`。测试可注入 mock 返回 per-round 内容。

**`extractVerdict`**：
```
const m = stdout.match(/VERDICT:\s*(APPROVED|REVISION)/i);
return m ? m[1].toUpperCase() : 'REVISION';  // 默认 REVISION（保守）
```

**`extractFeedback`**：取 Reviewer stdout 最后 2000 字符（足够给 Proposer 看完整审查结论）。

### 修改 `harness-initiative-runner.js`

Planner 成功后、`await client.query('BEGIN')` 之前插入：
```js
let ganResult;
try {
  ganResult = await runGanContractLoop({
    taskId: task.id,
    initiativeId,
    sprintDir,
    prdContent: plannerOutput,
    executor,
    worktreePath,
    githubToken,
    budgetCapUsd: 10,
  });
} catch (err) {
  console.error(`[harness-initiative-runner] GAN failed task=${task.id}: ${err.message}`);
  return { success: false, taskId: task.id, initiativeId, error: `gan: ${err.message}` };
}
```

INSERT contract 改为：
```sql
INSERT INTO initiative_contracts (
  initiative_id, version, status,
  prd_content, contract_content, review_rounds,
  budget_cap_usd, timeout_sec, approved_at
)
VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, NOW())
RETURNING id
```

INSERT run 改 `phase='B_task_loop'`（合同已 approved，跳过 A_contract 省一次 tick）。

## 数据流

```
Planner: cost = a
GAN round 1: proposer (cost b) + reviewer (cost c) → REVISION(feedback)
GAN round 2: proposer (cost d, prompt 带 round-1 feedback) + reviewer (cost e) → APPROVED
contract_content = round-2 proposer 的 contract-draft.md
cost_usd 累计 = a + b + c + d + e
写入：initiative_contracts.review_rounds=2, approved_at=NOW()
```

## 错误处理

| 场景 | 行为 |
|------|------|
| Proposer exit!=0 | `throw 'proposer_failed'` → runner `{success:false}`，不建 contract/run |
| Reviewer exit!=0 | `throw 'reviewer_failed'` |
| Reviewer 输出无 VERDICT | 视作 REVISION 继续（不轻易放行） |
| cost > budget_cap | `throw 'gan_budget_exceeded'` |
| readContractFile 失败 | 视作 proposer 没写 → throw |

## 测试

### `packages/brain/src/__tests__/harness-gan-loop.test.js`（5 场景）

1. 1 轮即 APPROVED → `rounds=1, contract=proposer-1`
2. 2 轮 REVISION→APPROVED → `rounds=2, proposer-2 prompt 含 round-1 feedback`
3. 累积 cost 超 budget → `throws 'gan_budget_exceeded'`
4. Proposer exit=1 → `throws 'proposer_failed'`
5. Reviewer 无 VERDICT → 第一轮当 REVISION；第二轮 APPROVED 正常退出

### `packages/brain/src/__tests__/harness-initiative-runner-gan.test.js`（2 场景）

1. Planner 成功 + GAN 1 轮 APPROVED → `initiative_contracts.status='approved', contract_content non-null, review_rounds=1`；`initiative_runs.phase='B_task_loop'`
2. GAN throw → `runInitiative {success:false}`，不写 DB

## 成功标准

- [ ] [BEHAVIOR] runGanContractLoop 按 propose→review→判决循环，APPROVED 才 break。Test: packages/brain/src/__tests__/harness-gan-loop.test.js
- [ ] [BEHAVIOR] REVISION 的 feedback 传到下一轮 Proposer prompt。Test: 同上
- [ ] [BEHAVIOR] 累积 cost 超 budgetCapUsd 抛 gan_budget_exceeded。Test: 同上
- [ ] [BEHAVIOR] runInitiative 调 GAN 成功后 INSERT contract status='approved' + run phase='B_task_loop'。Test: packages/brain/src/__tests__/harness-initiative-runner-gan.test.js
- [ ] [ARTIFACT] 新文件 packages/brain/src/harness-gan-loop.js 存在，导出 runGanContractLoop

## 回滚

- revert → 回到 PR-3 合并后的状态（Planner → 建 draft 合同 → 卡住）
- PR-1/2/3 成果不变
- 不影响线上 v4 流水线
