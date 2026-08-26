# Sprint PRD — generator 合同故障码保真透传（根除 provider_exit 语义埋没）[r76]

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（harness kernel 失败保真归因，减少 run 空转）

## 背景

自举第二刀（r69 案卷），兼 commander lease 过期自动重派（#5069，Brain 1.273.140）的生产验证轮。
r69 实证（attempt 56a09164）：generator 完成完整的合同死锁分析（B-06 与 4 道 CI 门禁互斥、无绿态可达、附 4 条最小修法），却被上报为 `error_code=provider_exit`。kernel 当作基础设施故障进黑名单重试，真实语义（需 proposer 修约）被埋没，run 空转 2h+ 直到人读日志。本 sprint 让合同类故障码保真透传并走既有 r40 合同故障重开 GAN 路径。

## Golden Path（核心场景）

系统从 [generator 结构化 BLOCKED 上报] → 经过 [回执保真透传 + kernel 合同码识别] → 到达 [重开 GAN，原因病族留存]

具体：
1. generator（GAN 生成子 attempt）完成合同死锁分析，以结构化 BLOCKED + 明确 `error_code`（`CONTRACT_SELF_CONTRADICTION` 或 `CONTRACT_CI_SCOPE_CONFLICT`）上报。
2. runner/entrypoint 回执链路收到结构化 BLOCKED，**保真透传该 error_code**，禁止降级改写为 `provider_exit`。
3. kernel（ground-truth/derive）识别 `CONTRACT_*` 家族故障码 → 走既有 r40 合同故障重开 GAN 路径；该 target **不进 `failed_targets` 黑名单、不按 infrastructure 重试**。
4. 可观测出口：run 走合同故障重开 GAN，attempt 的 `error_code` 留存为 `CONTRACT_*`（失败留原因病族），而非 provider_exit 空转。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **负向（语义不变）**：provider 真进程崩溃、无结构化 error_code 上报 → 仍判 `provider_exit` / infrastructure → 进黑名单重试。
- 结构化上报但 error_code 非 CONTRACT_* 家族 → 不误入合同重开路径，按原有分类处理。
- 纯函数可重放：同一输入回执，分类结论必须确定、可重放。

## 范围限定

**在范围内**：
- runner/entrypoint 回执链路对 CONTRACT_* error_code 的保真透传。
- kernel 对 CONTRACT_* 家族的分流（重开 GAN vs 黑名单/infra 重试）。
- RED 先行复刻 r69 场景（结构化合同故障被包装成 provider_exit → 现状进黑名单 / 修后走重开 GAN）。

**不在范围内**：
- 不改合同重开后的主链路由缺陷（WORKSPACE_RESOLUTION_FAILED，另有台账）。
- 不动 provider 真崩溃的 provider_exit / 黑名单语义。

## 假设

- [ASSUMPTION: 合同故障码家族以 `CONTRACT_` 前缀标识（如 CONTRACT_SELF_CONTRADICTION / CONTRACT_CI_SCOPE_CONFLICT），实际前缀/枚举以 orchestrator/constants.js 为准。]
- [ASSUMPTION: r40 合同故障重开 GAN 路径已存在（reopen_gan_contract），本 sprint 只做「把 CONTRACT_* 路由进该既有路径」，不新建重开机制。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: CONTRACT_* 保真透传 + 分类（不降级 provider_exit）。
- `packages/brain/src/orchestrator/derive.js` 或 `dispatcher.js`: CONTRACT_* 不进 failed_targets、不按 infrastructure 重试，路由到重开 GAN。
- `packages/brain/src/orchestrator/constants.js`: CONTRACT_* 故障码家族枚举（如需）。
- `tests/gp/f1/step3-contract-fault-code-passthrough.test.js`: RED 复刻 r69 场景（真 import 被改模块，禁 mock 被改的边；文件名避让 main 已有 step3-contract-* 同族文件）。
- 版本四处：`packages/brain/package.json` / `package-lock.json` / `.brain-versions` / `DEFINITION.md`（如涉及）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 双源为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 可观测: 合同类失败必须保真留存 error_code（原因病族不丢），禁止被 provider_exit 埋没
- 确定性: 分类为纯函数、同输入可重放

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature/area 三源合并；本 F1 line step/feature 源为空，area 源无与本 kernel 故障码分流相关的铁律 -->
- [真崩溃保真] provider 真进程崩溃（无结构化上报）仍按 provider_exit / infrastructure 处理，语义不变（来源: 本 sprint thin_prd 负向）
- [合同边界] claim 与可写白名单显式包含：新测试、被改实现文件、版本 bump 四处、DoD.md、sprints/<sprint_dir>/**；除清单外禁止创建计划外文件（来源: 本 sprint thin_prd）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node 跑 tests/gp/f1 新测试 + 断言分类结论）
# 期望验收点（自然语言）：
# 1) 喂入「结构化 BLOCKED + error_code=CONTRACT_SELF_CONTRADICTION」的回执 → 分类结论 = 走重开 GAN，
#    该 target 不进 failed_targets，attempt.error_code 保真留存为 CONTRACT_*（非 provider_exit）。
# 2) 喂入「provider 真崩溃、无结构化 error_code」的回执 → 分类结论 = provider_exit / infrastructure，进黑名单重试（负向不变）。
# 3) RED 复刻：修前该 CONTRACT_* 回执被判 provider_exit / 进黑名单（红），修后转绿。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/src/orchestrator（harness kernel 纯后端故障码分类/分流），无 UI、无远端 bridge 协议变更。
## target_environment: local_api
## target_environment_reason: 纯后端可重放分类逻辑，测试为 tests/gp/f1 内 node 单测，本地 evaluator 跑（无需真机/浏览器）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
