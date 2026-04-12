# Learning — Pipeline Planner Output Fix

**分支**: cp-0411220122-57c06424-57d8-4edd-8aba-bfc535
**日期**: 2026-04-12

## 问题描述

Planner 任务完成后，`result.branch` 字段为空，导致：
1. `pipeline-detail` API 中 Planner 步骤的 `output_content` 为 null（无法读 sprint-prd.md）
2. Propose 步骤的 `input_content` 依赖 `payload.planner_branch`，当该字段为 null 时也为 null

### 根本原因

`execution-callback` 在处理 `harness_planner` 完成时，只从 result 中提取 `plannerBranch` 用于创建 Proposer 任务的 payload，但从未将其写回 Planner 任务自身的 `result.branch` 字段。

`harness.js` 的 `buildSteps` 通过 `plannerBranchFromPropose`（从 Propose 任务 payload 倒推）作为 fallback，但这是脆弱的间接路径。

### 下次预防

- [ ] 每次任务完成处理提取到关键字段时，立即写回到该任务的 result — 不要只存在下游任务的 payload 中
- [ ] JSONB merge（`COALESCE(result,'{}') || jsonb_build_object(key, val)`）是安全写入，不破坏已有字段
- [ ] `getStepInput` 的 `context` 参数模式：将上层计算好的数据作为上下文传入，避免重复查 DB
