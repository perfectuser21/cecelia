# Harness 通信协议重构：Brain 注入确定性值 + 结果文件协议

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 harness pipeline 中所有 stdout 解析，改为 Brain 注入确定性值 + 容器写 `.brain-result.json` + Brain 读文件。

**Architecture:** Brain 在启动每个容器前计算好所有确定性值（分支名等）并通过 env var 注入。容器（LLM agent）完成工作后向固定路径 `/workspace/.brain-result.json` 写结构化 JSON。Brain 在容器退出后读文件获取结果，不碰 stdout。

**Tech Stack:** Node.js / LangGraph（现有）；新增 `readBrainResult()` 工具函数；SKILL.md 文件改动需 Engine 版本 bump。

---

## 问题根因

当前设计让 LLM 自己计算确定性值（分支名）并在 stdout 输出 JSON 汇报，Brain 用正则解析。
LLM 会偏离模板（用时间戳替代 task ID、不输出 JSON 或格式不对），导致 proposer/reviewer/evaluator 节点不稳定（B34-B38 整条 bug 链的底层根因）。

## 改动范围

### Brain 侧（3 个文件）

**`packages/brain/src/harness-shared.js`**
- 新增 `readBrainResult(worktreePath, requiredFields)` 函数：
  - 签名：`async readBrainResult(worktreePath: string, requiredFields: string[]) → object`
  - 读 `{worktreePath}/.brain-result.json`
  - 验证 `requiredFields` 中每个字段存在且非 null/undefined
  - 文件不存在或字段缺失 → 抛 `ContractViolation: missing_result_file / invalid_result_file`

**`packages/brain/src/workflows/harness-gan.graph.js`**

proposer 节点改动：
- 注入 `PROPOSE_BRANCH: \`cp-harness-propose-r${nextRound}-${taskId.slice(0,8)}\`` 作为 env var
- 容器退出后调用 `readBrainResult(worktreePath)` 读 `propose_branch`（双重验证：Brain 已知值 vs 文件值必须一致）
- 删除 `extractProposeBranch()` / `fallbackProposeBranch()` 两个函数

reviewer 节点改动：
- 容器退出后调用 `readBrainResult(worktreePath)` 读 `{verdict, rubric_scores, feedback}`
- 删除 `extractRubricScores()` / `extractVerdict()` / `extractFeedback()` 三个函数

**`packages/brain/src/workflows/harness-initiative.graph.js`**

evaluator 节点改动：
- 容器退出后调用 `readBrainResult(worktreePath)` 读 `{verdict, failed_step, log_excerpt}`
- 删除 `parseDockerOutput(result.stdout)` + 末行 JSON 扫描逻辑

### SKILL 侧（3 个文件 + Engine 版本 bump）

每个 SKILL 在最后一步从"stdout 输出 JSON"改为"写 `.brain-result.json` 文件"。

**`packages/workflows/skills/harness-contract-proposer/SKILL.md`** Step 4：
- 移除"stdout 最后一条消息输出 JSON"要求
- 改为：`echo '{"propose_branch":"'$PROPOSE_BRANCH'","workstream_count":N,"task_plan_path":"..."}' > .brain-result.json`
- 使用 Brain 注入的 `$PROPOSE_BRANCH` env var，不再自己算

**`packages/workflows/skills/harness-contract-reviewer/SKILL.md`** 最终步骤：
- 写 `.brain-result.json`：`{"verdict":"APPROVED","rubric_scores":{...5维度...},"feedback":"..."}`

**`packages/workflows/skills/harness-evaluator/SKILL.md`**（或 harness-final-evaluator）最终步骤：
- 写 `.brain-result.json`：`{"verdict":"PASS","failed_step":null,"log_excerpt":null}`

**Engine 版本 bump（SKILL 改动必须）**：
- `packages/engine/package.json` version 字段 +1
- `packages/engine/package-lock.json` 同步
- `packages/engine/VERSION` 文件
- `packages/engine/.hook-core-version`
- `packages/engine/regression-contract.yaml`
- `packages/engine/feature-registry.yml` 新增 changelog 条目
- 运行 `bash packages/engine/scripts/generate-path-views.sh`

## `.brain-result.json` Schema

```json
// Proposer
{
  "propose_branch": "cp-harness-propose-r1-f5a1db9c",
  "workstream_count": 2,
  "task_plan_path": "sprints/w50-xxx/task-plan.json"
}

// Reviewer
{
  "verdict": "APPROVED",
  "rubric_scores": {
    "dod_machineability": 8,
    "dod_testability": 7,
    "dod_doability": 8,
    "dod_clarity": 7,
    "dod_safety": 9
  },
  "feedback": "..."
}

// Evaluator
{
  "verdict": "PASS",
  "failed_step": null,
  "log_excerpt": null
}
```

## 错误处理

- 文件不存在：`ContractViolation: missing_result_file` → LangGraph retryPolicy 自动重试
- 必填字段缺失：`ContractViolation: invalid_result_file: missing field {field}` → 重试
- verdict 非法值：`ContractViolation: invalid_verdict: {value}` → 重试
- 最大重试后仍失败：pipeline 失败，Brain 标记 task failed

## 测试策略

### Unit（`harness-shared.test.js`）
- `readBrainResult`：文件存在且 schema 合法 → 返回 parsed object
- `readBrainResult`：文件不存在 → 抛 ContractViolation
- `readBrainResult`：字段缺失 → 抛 ContractViolation with 字段名
- `readBrainResult`：verdict 非法值 → 抛 ContractViolation

### Integration（`harness-gan-b39.test.js`、`harness-initiative-b39.test.js`）
- proposer 节点：mock executor 写 `.brain-result.json`，验证 Brain 正确读取 propose_branch 并传入下一节点
- reviewer 节点：mock executor 写 `.brain-result.json`，验证 verdict/rubric_scores 正确流入 state
- evaluator 节点：mock executor 写 `.brain-result.json`，验证 verdict=PASS 触发 merged 路径

### E2E Smoke
`packages/brain/scripts/smoke/harness-protocol-smoke.sh`：
- 启动真 Brain（docker compose）
- 注入 mock proposer 容器（只写 .brain-result.json，不真正跑 LLM）
- 验证 Brain 正确读取文件并进入 GAN reviewer 阶段
- exit 0 = 协议工作正常

## 成功标准

- W51 harness run：proposer 分支名与 Brain 注入的 `PROPOSE_BRANCH` 完全一致
- reviewer/evaluator 不再出现因 stdout 解析失败导致的 ContractViolation
- 5 个 extract* 函数从 codebase 消失
