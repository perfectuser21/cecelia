# Sprint PRD — generator 合同故障码保真透传，根除 provider_exit 语义埋没 [r77]

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（harness kernel 失败语义保真，减少合同死锁被误当基础设施故障吞没）

## 背景

第二次点火本主题。r76（run 35bddb0e）死于账号荒熔断 + 批准消费盲区 + 停表盲区，三者已全修上产（#5069 Brain 1.273.140 / #5071 Brain 1.273.141），claude 双账号已恢复满血，本轮干净重跑。

核心病根（r69 实证，attempt 56a09164）：generator 已完成完整合同死锁分析（判定"无绿态可达" + 给出 4 条修法），却以 `error_code=provider_exit` 上报。kernel 把它当基础设施故障处理 → 进 failed_targets 黑名单 + 按 infrastructure 重试，真实的合同故障语义（应走 r40 重开 GAN 路径）被彻底埋没，失败不留原因病族。

## Golden Path（核心场景）

系统从 [generator 结构化合同故障上报] → 经过 [回执链路保真透传 + kernel 家族分类] → 到达 [重开 GAN，病族可见]

具体：
1. generator 完成合同死锁分析，以**结构化 BLOCKED** + 明确 `error_code`（`CONTRACT_SELF_CONTRADICTION` / `CONTRACT_CI_SCOPE_CONFLICT` 等 `CONTRACT_*` 家族）上报
2. runner/entrypoint 侧回执链路**保真透传**该 `error_code`——进程退出时禁止将其降级覆盖为 `provider_exit`
3. kernel 侧收到 `CONTRACT_*` 家族故障码 → 走既有合同故障重开 GAN 路径（r40 机制，`ARBITRATE_CONTRACT_FAULT` / `contract_fault_reopen_gan`）
4. 可观测出口：该 attempt **不进 failed_targets 黑名单、不按 infrastructure 重试**；GAN 被重开，失败原因病族在案卷中保真可见
5. 负向出口：真实 provider 进程崩溃（无结构化上报）→ 仍判 `provider_exit` / infrastructure → 进黑名单 / 重试，语义**不变**

## 边界情况

- generator 结构化上报但 `error_code` 非 `CONTRACT_*` 家族（如 `semantic_refusal`）→ 不误路由到 reopen GAN，走原有语义
- provider 崩溃且 stdout 残留旧 `CONTRACT_*` 字样但**无结构化 result** → 必须凭结构化 `result.error.code` 判定，禁止 grep stdout 文本误判为合同故障
- 纯函数可重放：同一 attempt 输入多次分类，结果确定一致（无隐藏时钟/随机）

## 范围限定

**在范围内**：
- runner/entrypoint 回执链路 `error_code` 保真透传（结构化 `CONTRACT_*` 不降级为 `provider_exit`）
- kernel 分类：`CONTRACT_*` 家族排除出 generator 运行时/基础设施故障判定，路由到既有 reopen GAN 路径
- RED 先行复刻 r69 场景（结构化合同故障被包装成 provider_exit → 现状进黑名单 / 修后走重开 GAN）

**不在范围内**：
- 合同重开后主链路由缺陷 `WORKSPACE_RESOLUTION_FAILED`（另有台账）
- provider 真崩溃的黑名单 / infrastructure 语义（原样保留，不动）

## 假设

- [ASSUMPTION: 结构化上报的载体是 `result.error.code`（attempt-store `callbackEventDetail` 已透传该字段至 `error_code`，上限 64 字符）；provider_exit 的注入点在 runner/entrypoint 的进程退出兜底，而非 generator 本人上报]
- [ASSUMPTION: kernel 的合同故障重开路径已在 `derive.js` 的 `CONTRACT_FAULT_CORE_TOKENS` 匹配 + `ARBITRATE_CONTRACT_FAULT` 存在（r40/r43 实证），本 sprint 的 kernel 侧工作 = 让 `CONTRACT_*` 不被 `GENERATOR_RUNTIME_ERROR_CODES` 抢先吞成 infrastructure]
- [ASSUMPTION: 具体病族枚举（`CONTRACT_SELF_CONTRADICTION` / `CONTRACT_TEST_UNSATISFIABLE` / `CONTRACT_CI_SCOPE_CONFLICT`）以现有代码常量/token 表为准，proposer 阶段核对]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`：`GENERATOR_RUNTIME_ERROR_CODES` / `isGeneratorRuntimeError`（line ~70/218）需将 `CONTRACT_*` 家族排除出 infrastructure 判定
- `packages/brain/src/orchestrator/attempt-store.js` 或 runner/entrypoint 回执构造处：`error_code` 保真透传，禁止进程退出兜底覆盖为 `provider_exit`
- `packages/brain/src/orchestrator/derive.js`：`CONTRACT_FAULT_CORE_TOKENS` → reopen GAN（既有 r40 机制，本 sprint 确认其在保真透传后被正确触发）
- `tests/gp/f1/<新文件，避让 step3-* 同族命名>.test.js`：RED 复刻 r69，真 import 被改模块，禁 mock 被改的边
- 版本 bump 四处（`packages/brain/package.json` / `package-lock.json` / `.brain-versions` / `DEFINITION.md`）+ `DoD.md` + `sprints/08270110-kernel-r77-contract-fault-code/**`
- 若行为变更与既有回归测试（如 `orchestrator/__tests__/ground-truth.test.js`）冲突，须把该测试文件也 claim 进白名单更新（r73 教训）

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空（step+feature 双源均空）；以下取 PrepPRD 显式约束 -->
- 确定性/可重放: 分类为纯函数，同输入多次运行结果一致（thin_prd 显式要求）
- RED 先行: 修复前必须有一条能复现 r69 的 failing test，且永久保留进 CI 作回归（Bug 修复流程铁律 19/20）
- 可观测: 合同故障走 reopen GAN 时失败原因病族必须在案卷保真可见，不被 provider_exit 吞没
- 版本要求: 无外部版本约束

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 `target_environment=local_api` 填入（vitest 真跑 tests/gp/f1/ + 断言 exit code）。

```bash
# 占位：proposer 将填入真实脚本（local_api → 直接 vitest run 被改模块的新测试 + 校验 exit code 语义）
# 期望验收点（自然语言）：
#   1) RED 阶段——把结构化 CONTRACT_SELF_CONTRADICTION 上报包装成 provider_exit 场景喂入，
#      修前分类落 infrastructure/failed_targets 黑名单（测试断言现状红）。
#   2) GREEN 阶段——同一输入，回执保真透传 CONTRACT_* 后，kernel 分类走 reopen GAN
#      （ARBITRATE_CONTRACT_FAULT / contract_fault_reopen_gan），不进黑名单、不 infrastructure 重试。
#   3) 负向——真实 provider 崩溃（无结构化 result.error.code）仍判 provider_exit/infrastructure，语义不变。
#   ⚠️ 注意 vitest 对 include 范围外路径绿态也 exit 0（invariant [vitest范围外绿态]），
#      验证命令必须实跑确认 exit code 真语义。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级；本 sprint 相关子集 + 系统核心铁律（全量 area 含大量 capture-triage 学习条，此处按 kernel/generator/合同/测试落 f1 范围锚定筛选） -->
- [generator重试身份] generator infrastructure 重试须保持身份一致，不因分类漂移换 target（来源: area）
- [merge权归controller] generator 禁止自行 merge PR，merge 权归 controller（来源: area）
- [kernel验证时钟] kernel 对既有 PR 采用 evaluator validation clock（来源: area）
- [planner分支] planner 用服务端签发的 role branch，不在 Provider 内自行 checkout/switch（来源: area）
- [Fleet-Brain-URL] Fleet generator 的 Brain URL 以服务端为权威（来源: area）
- [vitest范围外绿态] 合同验证命令必须实跑确认 exit code；vitest 对 include 范围外路径绿态也 exit 0（来源: area）
- [status枚举全仓grep] 测试里 status 枚举硬编码断言，GAN 新增状态值时须全仓库 grep 同步（来源: area）
- [judge一手证据] evaluator .brain-result.json 须含顶层 exit_code + log_tail + behavior_tests[] 一手证据（来源: area）
- [Red精确add] Red commit 只 git add 精确路径（*.test.js），禁止 git add . / git add .harness（来源: area）
- [source-inspection] 调度接线类回归测试用 source-code inspection 比 mock 更直接有效（来源: area）
- [系统]单 slot 串行任务，并行只许跨 slot（来源: area）
- [系统]真环境验证才算 done（来源: area）
- [系统]测试默认多租户（来源: area）
- [系统]禁止写死环境假设值（来源: area）
- [系统]凭据安全 / 日志脱敏 / 端点鉴权 / 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey 现有 ability 均 status=planned，无 done/working 历史 -->
- （本 line 暂无已验收历史）

## journey_type: autonomous
## journey_type_reason: 改动落 packages/brain/src/orchestrator（harness kernel 后端分类/回执逻辑），无 UI、无远端 agent 协议、非 engine hook，属纯后端自治链路
## target_environment: local_api
## target_environment_reason: 纯函数分类逻辑，验收在本地 evaluator 直跑 vitest（tests/gp/f1/）+ 校验 exit code，无需真机 / 浏览器
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定 step）
