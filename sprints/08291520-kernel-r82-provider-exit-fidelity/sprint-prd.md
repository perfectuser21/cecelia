# Sprint PRD — 结构化上报保真透传，根除 provider_exit 语义埋没 [r82]

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（harness 内核失败归因保真，止住"失败不留原因病族"）

## 背景

第七次点火本主题。r81 死墙（deadline 尾期预算钳到秒级 → 依赖装失败）已随 42/43 批（145/146）assertion npm 预算保底 600s + 新镜像 720c9c7b 上产 rollout 彻底拆除；管线全部已知修复在产、常驻监工值守、claude 凭据永续。r79–r81 实现三次全绿（合同 19/19），每次只死在不同基础设施墙上——墙已拆完。

本主题真根因：generator/commander 的**结构化终态上报**（success 结果 JSON / 结构化 BLOCKED + `CONTRACT_*` 家族错误码）在回执链路被**降级/包装成 `provider_exit`**，语义被埋没——合同自身故障（应重开 GAN）被误当 provider 进程崩溃，被拉进 `failed_targets` 黑名单、按 infrastructure 重试，"失败不留原因"。病根三实证：r69 attempt 56a09164 / r76 / r77 attempt e022a331。

## Golden Path（核心场景）

系统从 [runner 产出结构化终态] → 经过 [回执链路保真透传 + kernel 归因分流] → 到达 [CONTRACT_* 走合同重开 GAN、真崩溃仍按 provider_exit]

具体：
1. **[触发条件·合同故障]** generator/commander 在容器内产出结构化 `.brain-result.json`：`status=blocked` + `error.code` 属 `CONTRACT_*` 家族（如 `CONTRACT_SELF_CONTRADICTION` / `CONTRACT_TEST_UNSATISFIABLE`）。
2. **[系统处理·保真]** entrypoint 回执链路原样透传该结构化终态与 `CONTRACT_*` 码，**禁止**因进程退出码非零而覆写/包装成 `provider_exit`。
3. **[系统处理·分流]** kernel 摄入后：`CONTRACT_*` 家族走既有合同故障重开 GAN 路径；**不进** `failed_targets` 黑名单、**不按** infrastructure 重试。
4. **[可观测结果·正路]** attempt 记录保留原 `CONTRACT_*` error_code，derive 据此重开 GAN；该 target 不被拉黑。
5. **[触发条件·真崩溃/负向]** provider 进程真实崩溃、无结构化产出（无合法 `.brain-result.json`）。
6. **[可观测结果·负路]** 仍归类 `provider_exit` / `infrastructure_blocked`，进重试/黑名单，语义**不变**。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 结构化产出存在但 error.code 非 `CONTRACT_*`（如 `provider_timeout`）：不走合同重开，维持既有 runtime 分类。
- 进程退出码非零 **但** 已落一份合法结构化 BLOCKED：以结构化终态为准，退出码不得覆盖语义（保真优先）。
- `.brain-result.json` 缺失/损坏（schema 不合法）：视同无结构化产出，落负向路径。
- success 结果 JSON（status=completed）同样保真透传，不得被非零退出码误判为失败。

## 范围限定

**在范围内**：
- runner/entrypoint 侧结构化终态保真透传（`docker/cecelia-runner/entrypoint.sh` 如需）。
- kernel 侧 `CONTRACT_*` 家族归因分流（`packages/brain/src/orchestrator/` 内 ground-truth / attempt-store / dispatcher 分类与 failed_targets 采集）。
- RED 先行复刻 r69/r77 场景，纯函数可重放回归测试。

**不在范围内**：
- 不改合同重开后主链路由缺陷（台账另修）。
- 不动 provider 真崩溃的黑名单/infrastructure 语义。
- 不改 CI 共享基础设施文件、不动预算/镜像。

## 假设

- [ASSUMPTION: `CONTRACT_*` 家族 = error.code 以 `CONTRACT_` 前缀开头的错误码集合（含 `CONTRACT_SELF_CONTRADICTION` / `CONTRACT_TEST_UNSATISFIABLE`），以实现基线 `packages/brain/src/orchestrator/attempt-store.js` 既有消费点为准。]
- [ASSUMPTION: 保真透传的载体为 `.brain-result.json` 结构化终态；判定"有无结构化产出"以该文件合法 schema 存在为准。]
- [ASSUMPTION: RED 测试真 import 被改模块（ground-truth / attempt-store / dispatcher），禁 mock 被改的边。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`：`GENERATOR_RUNTIME_ERROR_CODES` 归因，CONTRACT_* 不落 runtime-error 埋没。
- `packages/brain/src/orchestrator/attempt-store.js`：结构化终态摄入与 error_code 保真、failed_targets 采集查询排除 CONTRACT_*。
- `packages/brain/src/orchestrator/dispatcher.js`：failed_targets 黑名单/infrastructure 重试对 CONTRACT_* 的豁免。
- `docker/cecelia-runner/entrypoint.sh`：结构化终态回执不被非零退出码包装成 provider_exit（如需）。
- `tests/gp/f1/`：新增 RED 复刻 r69/r77 的纯函数回归测试（文件名避让 main 已有同族）。
- `packages/brain/package.json` + `package-lock.json` + `DEFINITION.md` + `ci/scripts/check-version-sync.sh`（版本四处同步）。
- `sprints/08291520-kernel-r82-provider-exit-fidelity/DoD.md`。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空），PrepPRD 显式值优先；缺项标待定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: brain 版本四处同步 bump（check-version-sync 通过）
- 可观测: 失败必须留原因——attempt 保留结构化 error_code；Brain judge `.brain-result.json` 必须含顶层 exit_code + log_tail + behavior_tests[]（来源: area invariant）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step+journey_feature 空，area 源按相关性收敛 -->
- [归因保真] generator 基础设施重试身份不得吞掉真实失败归因（来源: area — generator_infrastructure_retry_identity）
- [结果契约] Brain judge `.brain-result.json` 必须有顶层 exit_code + log_tail + behavior_tests[]，每条含 exit_code + log_tail（来源: area）
- [RED纯净] Red commit 必须只 git add 精确路径（*.test.js），禁 git add . 或 git add .harness（来源: area）
- [测试契约表] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [毕业顺序] 毕业 commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push（来源: area）
- [真环境] 真环境验证才算 done（来源: 系统）
- [多租户] 测试默认多租户（来源: 系统）
- [凭据安全] API Key/Token/密钥不入 git（来源: 系统）
- [日志脱敏] 日志脱敏（来源: 系统）
- [端点鉴权] 端点鉴权（来源: 系统）
- [租户隔离] 租户隔离，记忆/资源按租户隔离（来源: 系统）
- [禁写死环境] 禁止写死环境假设值（来源: 系统）
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: 系统）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收 ability；journey golden-paths 仅含 planned 态 "Agent 一键归零重置"，无 done/working 历史）

## E2E 验收

> Planner 初稿此区块留空占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql / node -e 纯函数重放）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#  1. RED 复刻：构造 r69/r77 场景——结构化 BLOCKED + CONTRACT_* 输入喂给 ground-truth/attempt-store 分类纯函数，
#     修复前该输入被判为 provider_exit/infrastructure（RED 红），修复后判为合同故障、走 GAN 重开、不进 failed_targets（PASS）。
#  2. 负向不回退：无结构化产出的真崩溃输入仍判 provider_exit/infrastructure_blocked（语义不变）。
#  3. failed_targets 采集查询对 CONTRACT_* error_code 的 target 不拉黑（真 import 被改模块断言）。
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain 内核 orchestrator 数据流（runner 产出→kernel 归因分流），无 UI、无 engine、无用户交互，属自治后台链路。
## target_environment: local_api
## target_environment_reason: 纯后端/内核分类，验收为纯函数可重放 + curl localhost:5221 + psql，本地 evaluator 执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
