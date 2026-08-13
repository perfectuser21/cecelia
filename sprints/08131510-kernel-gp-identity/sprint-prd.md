# Sprint PRD — 修复 Harness TaskBundle 的 GP 合同身份误判（journey_id 单独不触发全字段校验）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（F1 开发闭环去掉 journey-only 组包假死）

## 背景

生产复现：task `ad9f3a01` 仅携带 `journey_id`（通用 F1 锚点），CI FAIL 后 Kernel hop17 派发 `spawn:generator-fix`。`dispatcher.gpContractIdentity` 把 `journey_id` 当作「GP 合同身份出现」的触发条件之一，导致 journey-only 任务跳过 `return null`、进入版本化 GP 合同全字段校验、缺 `id/version/hash/golden_path_id/step_id` → 抛 `GP_CONTRACT_IDENTITY_INVALID` → assembly_fault → 组包返回 `TASK_BUNDLE_ASSEMBLY_FAILED`，run `61b34e3b` 在 hop19 终止。`journey_id` 是通用锚点，不应单独触发 GP 合同校验。

## Golden Path（核心场景）

系统从 [Kernel 派发 generator-fix/evaluator] → 经过 [dispatcher 组包判定 GP 合同身份] → 到达 [TaskBundle 成功组包，不再 assembly fault]。

具体：
1. [触发条件] Kernel 为「仅有 journey_id、无任何 GP 合同身份字段」的任务派发 `spawn:generator-fix`（或 evaluator）。
2. [系统处理] dispatcher 识别到无 GP 合同身份字段，`gpContractIdentity` 返回 null，不注入 `gp_contract`，正常组包。
3. [可观测结果] TaskBundle 成功产出，不返回 `TASK_BUNDLE_ASSEMBLY_FAILED`；generator-fix 得以继续跑。

补充分支行为：
- [部分 GP 身份] 任务出现任一 GP 合同身份字段（`gp_contract_id`/`gp_contract_version`/`gp_contract_hash`/`golden_path_id`/`step_id`）但字段不全或非法 → 继续 fail-closed，抛 `GP_CONTRACT_IDENTITY_INVALID`（保持既有保护）。
- [完整 GP 身份] 全部字段齐全且合法 → `gp_contract` 结构化透传进下游 TaskBundle（保持既有行为不变）。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 任务 payload 全空（无 journey_id 也无 GP 字段）→ 仍返回 null（既有空态行为不变）。
- 只有 journey_id 且 journey_id 本身非法格式 → 不因此触发 GP 全字段校验（journey-only 不做版本化 GP 校验）。
- journey_id + 恰好一个 GP 字段 → 判定为「部分 GP 身份」，fail-closed。

## 范围限定

**在范围内**：`packages/brain/src/orchestrator/dispatcher.js` 中 `gpContractIdentity` 的触发判定逻辑；对应回归测试。
**不在范围内**：GP 合同的语义/版本策略变更、下游 generator/evaluator/judge skill、UUID/SHA256 校验规则本身、其他 payload 字段。

## 假设

- [ASSUMPTION: GP 合同身份的「触发字段集」= `{gp_contract_id, gp_contract_version, gp_contract_hash, golden_path_id, step_id}`；`journey_id` 不属于触发字段，但当任一触发字段出现时，`journey_id` 仍需齐全合法（完整身份的必要组成）。]
- [ASSUMPTION: `golden_path_id` 与 `step_id` 可分别来自 payload 顶层或 `payload.anchor`（既有取值路径不变）。]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`: 修 `gpContractIdentity` 的触发判定——把 `journey_id` 从「任一字段出现即触发全字段校验」的判定里剥离，改为仅当出现任一 GP 合同身份字段时才触发全字段校验。
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`: 新增永久回归——journey-only 组包成功（Red→Green）、部分 GP fail-closed、完整 GP 透传三类断言。

## E2E 验收

> Planner 初稿占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（vitest + curl localhost:5221）。

```bash
# 占位：proposer 将填入真实脚本
# 期望验收点（自然语言）：
# 1. Red 永久回归：修复前 journey-only 组包用例必须先红（复现 TASK_BUNDLE_ASSEMBLY_FAILED / GP_CONTRACT_IDENTITY_INVALID），修复后转绿并永久保留。
# 2. journey-only 成功：仅 journey_id 的 spawn:generator-fix 组包，bundle 不含 gp_contract，不返回 TASK_BUNDLE_ASSEMBLY_FAILED。
# 3. 部分 GP 失败：出现任一 GP 身份字段但不全 → 仍抛 GP_CONTRACT_IDENTITY_INVALID（fail-closed）。
# 4. 完整 GP 透传：六字段齐全合法 → bundle.inputs.gp_contract 结构化注入不变（沿用现有 test:135 断言）。
# 5. 真实 spawn:generator-fix 组包路径覆盖，证明不再 assembly fault。
# 6. DevGate（facts-check + version-sync + dod-mapping）、AI Evaluator、Judge 全过。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [部分GP fail-closed] 一旦出现任一 GP 合同身份字段，`id/version/hash/golden_path_id/journey_id/step_id` 必须完整且合法，否则继续 fail-closed 抛 `GP_CONTRACT_IDENTITY_INVALID`（来源: 本 sprint thin_prd 显式铁律）
- [默认保护不放宽] Kernel/dispatcher 校验默认 fail-closed，本修复只豁免「纯 journey_id」这一精确情形，不得整体放宽校验（来源: area — validation 默认 fail-closed）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无已验收历史：journey e6f803f2 下 ability 均为 planned 态）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；组包为同步纯函数判定，无外部 IO）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 组包失败必须返回精确 failure_class=assembly_fault（既有行为，保持）

## journey_type: autonomous
## journey_type_reason: 改动仅在 packages/brain/ 后端 dispatcher 组包逻辑，无 UI、无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端单元/组包逻辑，本地 evaluator 用 vitest + curl localhost:5221 验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定具体 Step）
