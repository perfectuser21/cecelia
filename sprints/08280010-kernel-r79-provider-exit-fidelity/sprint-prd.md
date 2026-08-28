# Sprint PRD — 结构化上报保真透传，根除 provider_exit 语义埋没 [r79]

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（补齐 harness kernel 失败归因保真，消除合同故障被埋没导致的黑名单误杀/空转）

## 背景

第四次点火本主题。r78（run 75125f2b）死于 fix 轮 claude 账号荒烧穿 deadline——根因是凭据互踢病，已于 08-28 根治（单写者续签守护 claude-cred-refresher LaunchDaemon 上线 + xian 副本清除，claude 双账号进入永续状态），137/140/141/142 四层管线修复均已上产，本轮条件最全。

病根三实证：①r69 generator 的合同死锁分析（结构化 BLOCKED）被包装成 `provider_exit`（attempt 56a09164）；②r76 同类；③r77 commander 的 claude 返回 success 结果 JSON 却被判 `provider_exit` failed（attempt e022a331）。执行体产出了结构化终态，回执链路却降级成 `provider_exit`，语义被埋没——kernel 据此进 `failed_targets` 黑名单 / 按 infrastructure 重试，合同故障重开 GAN 的正确路径永远走不到。

## Golden Path（核心场景）

harness kernel 从 [执行体产出结构化终态] → 经过 [runner 回执保真透传 + kernel 按错误码族分流] → 到达 [合同故障重开 GAN，真崩溃仍按 provider_exit 处理]

具体：

1. **[触发-正向A]** 执行体（generator/commander）正常产出 success 结果 JSON，但 provider CLI 进程以非零码退出（如 codex/claude 诊断残留 exit 1）。
   → runner `normalize_provider_failure` 先检测 stdout 是否含结构化终态；命中则**保真透传该结构化终态**，禁止改写成 `error.code=provider_exit`。
   → 可观测：回执 `status` 与执行体产出一致，非 provider_exit。

2. **[触发-正向B]** 执行体产出结构化 BLOCKED，`error.code` 属 `CONTRACT_*` 家族（如 `CONTRACT_SELF_CONTRADICTION` / `CONTRACT_TEST_UNSATISFIABLE` / `CONTRACT_CI_SCOPE_CONFLICT`）。
   → runner 保真透传该 CONTRACT_* 码，不包装为 provider_exit。
   → kernel 收到 CONTRACT_* 家族故障码，走既有合同故障重开 GAN 路径（`derive.js` CONTRACT_FAULT 分支）。
   → 可观测：该 attempt **不进 `failed_targets` 黑名单**、**不按 infrastructure 有界重试**，而是触发 contract_fault 仲裁 / 重开。

3. **[触发-负向]** 真实 provider 进程崩溃/超时，stdout **无任何结构化终态产出**。
   → runner 仍归一为 `provider_exit`（超时归 `provider_timeout`），语义不变。
   → kernel 仍按 `GENERATOR_RUNTIME_ERROR_CODES`（provider_exit/provider_timeout）走 infrastructure 处理，黑名单语义不变。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- **空状态**：stdout 为空 / 非 JSON → 判定为无结构化产出，落负向 provider_exit（不得误判为结构化）。
- **混合态**：CLI 诊断错误与成功主回合并存（codex exit 1 但 turn.completed）→ 仅当唯一 CLI 信封证明成功且与提取的结构化结果一致时才透传成功，否则按负向处理（沿用既有 codex 严判逻辑，不放宽）。
- **码族边界**：`CONTRACT_*` 前缀但非合同故障核心族的码，按既有 derive 分流规则处理，不新增旁路。
- **并发/重放**：分类必须为纯函数，同一 attempt 回执重放结论恒定，不依赖时钟/随机/外部状态。

## 范围限定

**在范围内**：
- runner/entrypoint 回执归一化：结构化终态先于 provider_exit 包装的保真透传判定（`docker/cecelia-runner/entrypoint.sh`）。
- kernel 失败归因分流：CONTRACT_* 家族 → 合同故障重开 GAN，不进 failed_targets、不按 infrastructure 重试（`packages/brain/src/orchestrator/derive.js` / `ground-truth.js`）。
- RED 先行复刻 r69/r77 场景的纯函数回归测试（`tests/gp/f1/`）。

**不在范围内**：
- 不改合同重开后主链路由缺陷（WORKSPACE_RESOLUTION_FAILED，台账另修）。
- 不动 provider 真崩溃（无结构化产出）的黑名单/infrastructure 语义。
- 不改凭据续签 / 账号永续机制（已于 08-28 根治，非本 sprint）。

## 假设

- [ASSUMPTION: CONTRACT_* 家族核心码沿用 derive.js 既有 `CONTRACT_FAULT_CORE_TOKENS`（SELF_CONTRADICTION / TEST_UNSATISFIABLE / CI_CONFLICT），本 sprint 不新增码，只保证其从 runner 到 kernel 全程不被 provider_exit 覆盖。]
- [ASSUMPTION: 结构化终态的判定锚点 = runner stdout 中执行体写出的 result 信封（success 结果 JSON 或含 `error.code` 的结构化 BLOCKED），而非 provider CLI 退出码。]
- [ASSUMPTION: 若行为变更与 tests/gp/f1/ 既有同族回归测试冲突，该测试一并 claim 更新（合同边界铁律）。]

## 预期受影响文件

- `docker/cecelia-runner/entrypoint.sh`: `normalize_provider_failure`（~L2743）在包装 provider_exit 前先检测并保真透传结构化终态。
- `packages/brain/src/orchestrator/derive.js`: CONTRACT_* 家族回执归入合同故障重开分支，排除出 infrastructure/failed_targets（~L660-690 CONTRACT_FAULT 区）。
- `packages/brain/src/orchestrator/ground-truth.js`: `GENERATOR_RUNTIME_ERROR_CODES` 归因口径确认 CONTRACT_* 不落 runtime error（~L70/L218）。
- `tests/gp/f1/`: 新增纯函数回归测试，真 import 被改模块，复刻 r69/r77，文件名避让既有同族文件。
- 版本 bump 四处 + `DoD.md` + `sprints/08280010-kernel-r79-provider-exit-fidelity/**`（合同四件套）。

## NFR 约束

<!-- 来源: constraints + thin_prd 显式值；decisions 表 step/feature NFR 为空 -->
- 超时/延迟: 单 session timeout = 5400s（constraints.timeout_seconds）
- 可重放性: 分类为纯函数，同输入同结论，可离线重放（thin_prd 要求 4）
- 可观测: 失败必须留原因病族——结构化终态的错误码/状态不得被 provider_exit 埋没（本 sprint 核心 NFR）
- 频控/版本要求: 无（PrepPRD 未指定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 为空；area 级如实注入 -->
- [负向不动] 真实 provider 进程崩溃（无结构化产出）仍按 provider_exit/infrastructure 处理，黑名单语义不变（来源: 本 sprint thin_prd 要求 3，铁律级）
- [合同边界] claim 与可写白名单显式包含；除清单外禁创建计划外文件，禁止执行为锁死清单（来源: 本 sprint thin_prd 要求 7）
- [RED 先行] 修 bug 前必先写复现该 bug 的 failing test，且永久保留在 CI 作回归（来源: area 开发铁律）
- [凭据隔离] 多人协作禁止混用授权凭据——操作他人账号资源要用其本人授权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收历史行为——journeys/golden-paths 仅返回 status=planned 的 ability，无 done/working 项）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（node 纯函数重放 + curl localhost:5221 / psql 核对分流结果）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 复刻 r69 场景：结构化 BLOCKED + CONTRACT_* 输入 → 断言回执 error.code 为 CONTRACT_*（非 provider_exit），
#    kernel 分流结果 = 合同故障重开（非 failed_targets / 非 infrastructure 重试）。
# 2. 复刻 r77 场景：success 结果 JSON + provider CLI 非零退出 → 断言回执 status 保真透传（非 provider_exit failed）。
# 3. 负向：无结构化产出的真崩溃 → 断言仍归一 provider_exit，kernel 仍走 infrastructure 黑名单，语义不变。
```

## journey_type: autonomous
## journey_type_reason: 修复对象是 harness kernel 自驱 GAN 循环内部的失败归因与 runner 回执归一化，无 UI/远端产品 agent 业务旅程，验收为纯后端离线重放。
## target_environment: local_api
## target_environment_reason: 验收为 tests/gp/f1 纯函数 node 重放 + curl localhost:5221 / psql 核对 kernel 分流，全在本地 evaluator 完成，无需远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
