# Sprint PRD — 修复 GP 合同身份误判（journey-only 组包不再被 GP_CONTRACT_IDENTITY_INVALID 误杀）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（工厂·F1 开发闭环 assembly fault 缺口收口）

## 背景

生产复现：task `ad9f3a01` 只挂了 `journey_id`、无任何 `gp_contract_*` 字段。CI FAIL 后 Kernel 在 hop17 `spawn:generator-fix`，`dispatcher.gpContractIdentity` 因 `journey_id` 非空而进入「全字段校验」分支，缺失 `gp_contract_id/version/hash/step_id` 直接抛 `GP_CONTRACT_IDENTITY_INVALID`，父 run `61b34e3b` 在 hop19 以 `assembly_fault:TASK_BUNDLE_ASSEMBLY_FAILED` 终止。根因：`journey_id` 是通用 F1 锚点，被错误地当成「GP 合同身份声明」的一员，使得仅有 journey_id 的任务无法组包。

## Golden Path（核心场景）

系统从 [Kernel 触发 generator-fix 组包] → 经过 [dispatcher 判定 GP 合同身份] → 到达 [journey-only 任务成功组包，不再 assembly fault]

具体：
1. Kernel 对一个「只有 `journey_id`、无 `gp_contract_*`」的 generator-fix/evaluator 意图发起组包（真实 `spawn:generator-fix` 路径）。
2. `dispatcher.gpContractIdentity` 判定：`journey_id` 单独存在**不**构成 GP 合同声明 → 视为「无 GP 合同」，返回 null（不挂 `gp_contract`）。
3. TaskBundle 成功组装并派发，日志/返回不再出现 `GP_CONTRACT_IDENTITY_INVALID` / `TASK_BUNDLE_ASSEMBLY_FAILED`。

存在性判定的三态语义（本 sprint 核心行为）：
- **journey-only**（仅 journey_id，无任一 GP 合同身份字段）→ 组包成功（返回 null）。
- **部分 GP 身份**（出现 `gp_contract_id/version/hash/golden_path_id/step_id` 中任一，但字段不完整或非法）→ 仍 fail-closed（抛 `GP_CONTRACT_IDENTITY_INVALID`）。
- **完整版本化 GP 身份**（id/version/hash/golden_path_id/journey_id/step_id 全合法）→ 继续透传通过。

## 边界情况

- 只有 journey_id 但格式非法（非 UUID）：仍属 journey-only 语义范畴 —— 由本 sprint 明确其行为（journey_id 非 GP 合同触发器，不因它单独触发全字段红线）。
- GP 合同身份字段出现但 journey_id 缺失：属「部分 GP 身份」，fail-closed。
- anchor.gp_id 与 golden_path_id 不一致：仍 fail-closed（既有红线不放松）。

## 范围限定

**在范围内**：
- `gpContractIdentity` 存在性判定逻辑修正（journey_id 不再单独触发全字段校验）。
- 覆盖真实 `spawn:generator-fix` 组包路径的失败回归测试（先红后绿，永久保留）。

**不在范围内**：
- GP 合同字段的语义/schema 变更；Kernel hop 调度逻辑；evaluator/judge 内部实现。
- 恢复父 run 61b34e3b PR #4867 取证链（本 sprint 修复合入后由 Kernel 自动恢复，非本 PRD 代码范围）。

## 假设

- [ASSUMPTION: 「GP 合同身份字段」= `gp_contract_id`、`gp_contract_version`、`gp_contract_hash`、`golden_path_id`（含 anchor.gp_id）、`step_id`（含 anchor.step_id）；`journey_id` 不在此集合内，仅作通用 F1 锚点。]
- [ASSUMPTION: journey-only 判定为「无 GP 合同身份字段」时返回 null，与既有「全空返回 null」行为一致，下游 common.gp_contract 不挂。]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`：`gpContractIdentity` 存在性判定修正（journey_id 移出 GP 合同触发集合）。
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`：新增 journey-only 组包成功、部分 GP 身份 fail-closed、完整 GP 身份透传的红→绿回归测试。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node/vitest + 真实 spawn:generator-fix 组包路径）。

```bash
# 占位：proposer 将填入真实脚本
# 期望验收点（自然语言）：
#  1. 对「仅 journey_id」的 generator-fix 组包调用，不抛 GP_CONTRACT_IDENTITY_INVALID，
#     TaskBundle 成功组装（不返回 TASK_BUNDLE_ASSEMBLY_FAILED）。
#  2. 对「部分 GP 身份」（任一字段缺失/非法）的组包，仍抛 GP_CONTRACT_IDENTITY_INVALID（fail-closed）。
#  3. 对「完整版本化 GP 身份」的组包，继续透传通过并挂上 gp_contract。
#  4. Red 测试在修复前失败、修复后通过，并永久保留在 CI 回归中。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空），PrepPRD 未显式指定额外 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 组包失败/成功路径应可从 Kernel run 日志观测（assembly_fault 与否）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 源；step/feature 源为空 -->
- [fail-closed] 部分/缺失/不一致的合同身份一律拒绝，默认 fail-closed；仅完整且一致时放行（来源: area）
- [journey-非合同] journey_id 是通用 F1 锚点，单独存在不构成 GP 合同声明，不得单独触发全字段红线（来源: 本 sprint 确立）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无与 GP 合同身份判定相关的已验收 FR）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/src/orchestrator（Kernel 组包/dispatcher 后端逻辑），无 UI/远端 agent 协议/engine 路径。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，E2E 在本地 evaluator 用 node/vitest 直测 dispatcher 组包路径（localhost:5221 侧 Kernel 逻辑）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
