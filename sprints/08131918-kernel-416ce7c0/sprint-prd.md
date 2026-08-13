# Sprint PRD — 修复 Journey-only 锚触发 GP Contract 身份误判（dispatcher.gpContractIdentity）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类 assembly_fault 终止 run 的装配故障）

## 背景

生产 RED：run 8b468cdd（journey e6f803f2 下）已有合法 F1 `journey_id`、无任何 `gp_contract_*` 字段。Reviewer APPROVED 后 hop11 `spawn:generator`，`dispatcher.gpContractIdentity` 抛 `GP_CONTRACT_IDENTITY_INVALID`，hop12 dispatch status=BLOCKED / fallback=TASK_BUNDLE_ASSEMBLY_FAILED，hop13 run failed（failure_reason=`assembly_fault:TASK_BUNDLE_ASSEMBLY_FAILED`）。

根因（`packages/brain/src/orchestrator/dispatcher.js:104-124`）：`values` 把 `journey_id` 与 5 个 GP 字段并列；`Object.values(...).every(空)` 只在**全部为空**时返回 null，因此 journey-only（仅 `journey_id` 非空）绕过 null 分支，进入要求全部 GP 字段合法的严格校验 → 抛错。此外 `common`（`dispatcher.js:223-240`）仅在 `gp_contract` 非空时携带 `journey_id`，故修复须在无完整合同时也把 `journey_id` 保留进 bundle。

## Golden Path（核心场景）

系统从 [journey-only 锚的 spawn:generator dispatch] → 经过 [gpContractIdentity 判定] → 到达 [Generator TaskBundle 成功组装]

具体：
1. [触发] payload 仅含合法 `journey_id`（UUID），无 `gp_contract_id/version/hash/golden_path_id`、无 `anchor.step_id`
2. [系统处理] `gpContractIdentity(payload)` 识别为 journey-only 锚，返回 null GP contract identity（不注入 `common.gp_contract`），但 `journey_id` 仍被保留进 common bundle
3. [可观测结果] `spawn:generator` 的 TaskBundle 成功组装，dispatch 不再 BLOCKED，run 不再 assembly_fault 终止

分支行为（不得回退）：
- 只提供 `gp_contract_id`/`version`/`hash`/`golden_path_id`/`step_id` 中任一**部分**字段（journey 之外）→ 仍视为要声明完整合同却缺项 → fail-closed 抛 `GP_CONTRACT_IDENTITY_INVALID`
- 提供**完整** id/version/hash/golden_path_id/journey_id/step_id 且 `anchor.gp_id === golden_path_id` → 冻结结构化注入 `common.gp_contract`（与现状一致，不回归）

## 边界情况

- journey_id 存在但非 UUID → 非 journey-only，属非法输入 → fail-closed 抛错
- 完整合同但 `anchor.gp_id` 与 `golden_path_id` 不一致 → 抛错（一致性校验不得削弱）
- payload 全空（无 journey_id 亦无 GP 字段）→ 返回 null（现状行为，保留）

## 范围限定

**在范围内**：`packages/brain/src/orchestrator/dispatcher.js` 的 `gpContractIdentity` 判定逻辑 + journey-only 时 `journey_id` 进 common 的保留；对应 dispatcher 单测（永久回归）；一次真实 `assemble spawn:generator` bundle 装配测试。
**不在范围内**：完整 GP Contract 的 UUID/hash/step 一致性校验规则本身（不得削弱）；机器身份硬闸（后续刀）；PR auto-merge 保护机制改动。

## 假设

- [ASSUMPTION: 本刀任务自身携带已签署 F1 GP Contract 48ef45ab 完整身份，修复落地前不自触发同一装配故障]
- [ASSUMPTION: PR 标题保持 `feat(harness):` 前缀以命中现有通用 auto-merge 保护]
- [ASSUMPTION: journey-only 判定 = journey_id 合法 UUID 且其余 5 个 GP 字段全空]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`: `gpContractIdentity` 增 journey-only 分支返回 null + journey_id 保留进 common
- `packages/brain/**/*dispatcher*.test.*`(或对应测试目录): 新增 RED-1/2/3 三态断言 + assemble spawn:generator 真实 bundle 测试（永久保留）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ PrepPRD 显式值优先 -->
- 一致性校验强度: 完整 GP Contract 的 UUID/hash/step/anchor.gp_id 一致性校验**不得削弱**（PrepPRD 显式）
- 验证独立性: AI Evaluator 必须独立验证 journey-only / partial / complete 三态，不得只看 CI（PrepPRD 显式）
- 回归保留: dispatcher 单测必须永久保留在 CI（PrepPRD 显式）
- PR 前缀: 标题保持 `feat(harness):`（PrepPRD 显式）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 空，area 三源取相关项 -->
- [fail-closed] 声明了部分 GP 合同字段却缺项，一律 fail-closed，禁止静默降级（来源: 本 sprint 合同意图）
- [test-include] vitest 对 include 范围外路径绿态也 exit 0，新测必须落在被扫描的 include 路径内（来源: area）
- [smoke-oracle] local_api/无 UI smoke 任务须在合同里给出可机检 oracle，避免 judge 机械闸⑤ meta_verification_gap 死锁（来源: area）
- [ci-noise] Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障，非 required，不阻断本刀判定（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）<!-- journey e6f803f2 下 2 个 ability 均为 status=planned，无 done/working 已验收行为 -->

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（vitest + 真实 assemble）。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest dispatcher 单测 + assemble spawn:generator bundle）
# 期望验收点（自然语言）：
#  1. RED-1 journey-only payload → gpContractIdentity 返回 null，assemble spawn:generator 得到含 journey_id、不含 gp_contract 的可用 TaskBundle
#  2. RED-2 任一部分 GP 字段（非 journey）→ 抛 GP_CONTRACT_IDENTITY_INVALID（fail-closed）
#  3. RED-3 完整 id/version/hash/golden_path_id/journey_id/step_id 且 anchor.gp_id 一致 → 冻结结构化注入，无回归
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 的 orchestrator dispatcher 纯后端装配逻辑，无 UI/远端 agent/engine 介入
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，验证走本地 vitest 单测 + assemble spawn:generator bundle（localhost:5221 域），无浏览器/远端机器
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
