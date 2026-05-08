# 任务：修 harness proposer/graph propose_branch 协议 mismatch

## 背景

2026-05-08 凌晨跑 W8 acceptance task `49dafaf4-1d84-4da4-b4a8-4f5b9c56facf`，graph 推到 inferTaskPlan 节点报错并 END：

```
[infer_task_plan] git show origin/cp-05080823-49dafaf4:sprints/w8-langgraph-v3/task-plan.json failed: 
fatal: invalid object name 'origin/cp-05080823-49dafaf4'
```

`harness graph failed`，task status=failed。整个 W8 acceptance 验收被这个一个 bug 卡死，14 节点只过了 5 个（prep / planner / parsePrd / ganLoop / inferTaskPlan）。

## 实证根因

`packages/brain/src/workflows/harness-gan.graph.js` line 393：
```js
const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId);
```

`extractProposeBranch(stdout)` 用正则 `/"propose_branch"\s*:\s*"([^"]+)"/` 找 proposer SKILL stdout 里的 `"propose_branch":"..."` JSON 字段，**找不到** → 走 `fallbackProposeBranch(taskId)`：

```js
// line 182-189
export function fallbackProposeBranch(taskId, now = new Date()) {
  const stamp = ...;  // MMDDHHmm Asia/Shanghai
  return `cp-${stamp}-${String(taskId || 'unknown').slice(0, 8)}`;
}
```

生成 `cp-05080823-49dafaf4`。

但 proposer SKILL 实际 git push 的是 `cp-harness-propose-r{N}-{taskIdSlice}` 格式（line 323 注释明文：`proposeBranch: GAN proposer 每轮 push 到独立分支（cp-harness-propose-r{N}-{shortTask}）`）。

本次 W8 实证：origin 上有 `cp-harness-propose-r1-49dafaf4` + `cp-harness-propose-r2-49dafaf4` 且**两个分支都含真实 task-plan.json**（PR #2820 修复实证有效），但 graph 找的是 `cp-05080823-49dafaf4` → 找不到 → inferTaskPlan 硬 fail（PR #2820 加的"硬 fail 不静默"逻辑生效）。

PR #2820 修了"proposer 每轮写 task-plan.json"+"inferTaskPlan 硬 fail"，但**没修 SKILL stdout 输出 propose_branch JSON**——所以 graph 永远走 fallback，fallback 名永远跟实际 push 名 mismatch。

## 修复方向（双层都要补）

### 1. SKILL 层（主修，问题根源）
`packages/engine/skills/harness-contract-proposer/SKILL.md` 的 Step 3（提交分支后输出阶段）必须在 stdout 末尾打印 JSON 字面量：
```json
{"verdict": "PROPOSED", "propose_branch": "cp-harness-propose-r{N}-{taskIdSlice}", "round": N, ...}
```
让 `extractProposeBranch` 正则能命中。

### 2. Graph 层（防御，兜底）
`fallbackProposeBranch` 当前生成 `cp-MMDDHHmm-XXX` 跟 SKILL 实际格式 mismatch，即使没 JSON 输出走 fallback 也得能命中真实分支。改成 `cp-harness-propose-r{round}-{taskIdSlice}` 格式（fallback 函数签名要加 round 参数 + 调用点传 round）。

## 成功标准

- `[BEHAVIOR]` extractProposeBranch 单测命中 SKILL 实际输出格式（`packages/brain/src/workflows/__tests__/extract-propose-branch.test.js`）
- `[BEHAVIOR]` fallbackProposeBranch 单测格式跟 SKILL push 格式一致（同上 `__tests__/fallback-propose-branch.test.js` 或合并到上一个）
- `[BEHAVIOR]` SKILL 文件 grep 含 `"propose_branch"` JSON 输出片段（`manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('\"propose_branch\"'))process.exit(1)"`）
- `[ARTIFACT]` packages/brain 版本 bump（package.json + package-lock.json）
- `[ARTIFACT]` packages/engine 版本 bump 5 文件（package.json/package-lock.json/VERSION/.hook-core-version/regression-contract.yaml）
- `[ARTIFACT]` `packages/engine/feature-registry.yml` changelog 新增条目 + 跑 `bash packages/engine/scripts/generate-path-views.sh`
- `[ARTIFACT]` `packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh` 真环境验证脚本（启 Brain → 跑一段最小 harness graph → 检查 ganResult.propose_branch 命中实际 push 分支）

## 跑通验证（PR 合并后）

PR 合并后回到原会话再跑一次 W8 acceptance task（payload 不变），期待：
- task status=completed
- task_events graph_node_update 含 ≥ 14 distinct node names

## 注意事项

- harness 这条链改 SKILL 必须 `[CONFIG]` PR + Engine 版本 5 文件 bump（参考 memory `version-management.md`）
- 改 brain JS 必须 bump packages/brain version 触发 brain-ci
- **一个 PR 双改**（SKILL + Graph 同步），避免间隙窗口
- 测试用例参考 PR #2820 已合的 harness-gan-convergence smoke 模式
- 跑 /dev 期间禁止 run_in_background，必须前台 until 阻塞等 CI

## 测试策略

- **unit test**（覆盖 extractProposeBranch + fallbackProposeBranch 两个纯函数）：检查 regex 命中 SKILL 输出样例 + fallback 格式跟 SKILL push 格式一致
- **integration test**（合并跑 mock harness-gan）：mock proposer stdout → graph 解析 propose_branch → 验证传给 inferTaskPlan 的 branch 名能在测试的 git fixture 里找到
- **smoke.sh**（真环境）：起真 Brain + 真 git → 跑一段最小 harness flow → 验证 ganResult.propose_branch 真实匹配 origin 上的分支

## 不做

- 不重写整个 GAN graph 流程（PR #2834 收敛检测刚合，本 PR 只补 propose_branch 协议层）
- 不改 inferTaskPlan 的硬 fail 行为（PR #2820 设计上要"硬 fail 不静默"，本 PR 是上游修对让 inferTaskPlan 不再误触发）
- 不动其他 SKILL（reviewer / planner / generator 的输出协议本 PR 范围外）
- 不改 W8 acceptance 跑通后才会暴露的下游节点 bug（fanout / run_sub_task / dbUpsert / final_evaluate 等）—— 本 PR 目标是让 graph 推过 inferTaskPlan，下游若再有 bug 后续 PR 再修
- 不动 docker-compose.yml 的 BRAIN_MUTED / PROBE_AUTO_ROLLBACK_ENABLED env（这是上一轮稳定化的紧急止血，本 PR 范围外）

## 测试金字塔归类

按 dev skill 的「测试策略」段四档分类：
- extractProposeBranch / fallbackProposeBranch 是单纯函数 → **unit test**
- harness-gan.graph.js 节点编排（mock proposer 输出 → 验证 graph state.proposeBranch 字段）→ **integration test**
- 跨 SKILL/Brain/Git 的真链路 → **smoke.sh E2E**
