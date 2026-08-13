# Sprint PRD — Journey-only Harness 被 GP 合同身份误杀修复（r3）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 P0 assembly_fault，harness 派单闭环恢复正常）

## 背景

生产复现（task ad9f3a01，journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29）：

该任务 payload 仅含 `journey_id`（通用 F1 锚点），不含任何 GP 合同字段（gp_contract_id / gp_contract_version / gp_contract_hash / golden_path_id / step_id）。Kernel hop17 触发 `spawn:generator-fix` 后，`dispatcher.gpContractIdentity` 内的"全空短路"判断（line 114）仅在**所有字段都为 null/空**时返回 null。由于 `values.journey_id` 非空，短路失效，函数进入全字段校验——其余 5 个 GP 合同字段均为 null，全部不满足 UUID/SHA256/整数校验，抛出 `GP_CONTRACT_IDENTITY_INVALID`，导致 run 61b34e3b 在 hop19 以 `assembly_fault` 终止。

**根因**：`gpContractIdentity` 的"是否进入 GP 合同校验"判断使用了错误的谓词——应区分"journey_id 是通用 F1 字段"与"GP 合同身份字段出现"两种语义，而当前实现将两者混同。

## Golden Path（核心场景）

Harness 派单流程从 [Kernel 触发 spawn:generator-fix，payload 仅含 journey_id] → 经过 [dispatcher 正确识别为 journey-only，跳过 GP 合同全字段校验] → 到达 [组包成功，任务正常进入执行队列]，不再 assembly_fault。

具体行为要求：
1. **journey-only 路径**：payload 有 `journey_id` 但**无任何** GP 合同身份字段（id/version/hash/golden_path_id/step_id 全为 null/undefined）→ `gpContractIdentity` 返回 null，不抛异常，TaskBundle 不含 `gp_contract`。
2. **部分 GP 身份（fail-closed）**：payload 出现任意一个 GP 合同身份字段（id/version/hash/golden_path_id/step_id 之一非空），则要求全套合法，否则继续 throw `GP_CONTRACT_IDENTITY_INVALID`。
3. **完整 GP 透传**：payload 含完整 GP 合同身份（6 字段齐全且合法）→ 组包成功，`gp_contract` 注入 TaskBundle，行为与修复前完整 GP 路径一致。
4. **真实 generator-fix 组包不再 assembly_fault**：覆盖 `spawn:generator-fix` 组包路径，证明不再返回 `TASK_BUNDLE_ASSEMBLY_FAILED`。

## 边界情况

- `journey_id` 单独非空，其余 GP 字段均为 null → 返回 null（journey-only，正常）
- `journey_id` + `golden_path_id` 非空，其余为 null → fail-closed（部分 GP 字段出现即要全套）
- 所有 6 字段均为 null/空 → 返回 null（历史路径，保持不变）
- anchor 含 `gp_id` 但 payload 无其他 GP 字段 → 视为部分 GP 出现，fail-closed

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/dispatcher.js` 中 `gpContractIdentity` 函数的"进入 GP 校验"判断谓词（~line 114）
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`：新增能复现原始 bug 的 failing→green 回归断言

**不在范围内**：
- `gpContractIdentity` 的完整 GP 路径校验逻辑（UUID/SHA256/整数/anchor 一致性检查）不改变
- `buildBundle`、`buildInputs`、其他 dispatcher 逻辑
- 任何非 `dispatcher.js` 的文件（derive / ground-truth / loop / preflight 等）

## 假设

- [ASSUMPTION: `journey_id` 是通用 F1 锚点，不属于 GP 合同身份字段；GP 合同身份字段定义为 id/version/hash/golden_path_id/step_id 这 5 个]
- [ASSUMPTION: "部分 GP 身份出现"的判断以上述 5 个字段任意一个非 null/空为准（anchor.gp_id 也算）]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`：修改 `gpContractIdentity` 第 114 行附近的短路判断谓词，将"全空返回 null"改为"GP 合同身份字段（不含 journey_id）全空才返回 null"
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`：新增最少 3 条回归断言：
  1. journey-only（仅 journey_id）→ `gp_contract` 不注入，组包成功
  2. 部分 GP 身份（仅 journey_id + golden_path_id，缺其余）→ 抛 `GP_CONTRACT_IDENTITY_INVALID`
  3. 完整 GP 身份 → `gp_contract` 正确注入（回归已有用例不回退）

## NFR 约束

- 超时/延迟：无额外要求（纯同步函数，不涉及 I/O）
- 频控：不引入
- 可观测：无需额外日志，原有 `preAttemptAssemblyFault` 兜底日志保持不变
- 版本要求：无 semver bump 要求（bugfix 性质）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [验证时钟 fail-closed] Kernel 保留 validation_clock_required 默认 fail-closed，缺失或不一致一律拒绝（来源：area）
- [证据窗口] judge 证据消费窗口为前 8 条 × 600 字符，一手证据须排序进窗口前列（来源：area）
- [合同验证命令实跑] 合同里的验证命令必须实跑确认 exit code 语义，写进合同前先跑一次（来源：area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- 冻结 GP Contract 身份结构化注入下游 TaskBundle（已有用例 `dispatcher.test.js:134` 覆盖，本次不得回退）
- `gpContractIdentity` 完整 GP 路径（6 字段齐全）→ `gp_contract` 注入正确值，version 转为整数（已验收）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（vitest 单测）。

```bash
# 占位：proposer 将填入真实脚本（local_api → 直接跑 dispatcher 单测）
# 期望验收点（自然语言）：
#  1) 红→绿回归：构造 payload = { journey_id: '<uuid>' }（无 GP 合同字段），
#     dispatch spawn:generator-fix，断言 createAttempt 被调用、bundle.inputs 无 gp_contract、
#     且整个 dispatch 调用不抛 GP_CONTRACT_IDENTITY_INVALID。
#  2) 部分 GP 身份 fail-closed：payload 含 journey_id + golden_path_id（缺 id/version/hash/step_id），
#     断言 dispatch 返回 failure_class='assembly_fault' 且 detail 含 GP_CONTRACT_IDENTITY_INVALID。
#  3) 完整 GP 路径回归：payload 含 6 字段齐全，断言 bundle.inputs.gp_contract 注入正确结构（已有用例不回退）。
#  4) 全量 dispatcher 单测绿态（npm test -- packages/brain/src/orchestrator/__tests__/dispatcher.test.js）。
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain 后端 orchestrator dispatcher 纯函数逻辑，无 UI / 无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端逻辑，E2E = 本地 vitest 跑 dispatcher 单测（localhost:5221 无需真派单）。
