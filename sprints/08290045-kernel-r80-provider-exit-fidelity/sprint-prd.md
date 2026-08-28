# Sprint PRD — 结构化上报保真透传，根除 provider_exit 语义埋没 [r80]

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（失败留真因、合同故障不被基础设施病族埋没，Harness 闭环可信度提升）

## 背景

第五次点火（r80）。历轮死因已全清并上产：管线四层（137/140/141/142）+ 信任断言归因修正与留证（143，r75/r79 双杀根治）+ runner 镜像 repin b3ff98ff（144）+ claude 凭据单写者守护（账号永续）。

病根三实证：①r69 generator 合同死锁分析被包装成 `provider_exit`（attempt 56a09164）；②r76 同类；③r77 commander 的 claude 返回 success 结果 JSON 却被判 `provider_exit` failed（attempt e022a331）。r79 实现曾全绿（合同 7/7 + 回归 5/5）却死于基础设施误归因。本轮同题重跑、条件最全。

## Golden Path（核心场景）

用户/系统从 [执行体产出结构化终态] → 经过 [runner 回执 + kernel 分类] → 到达 [真因保真、合同故障走重开 GAN]

具体：

1. **触发**：执行体（generator/commander）产出结构化终态——success 结果 JSON，或结构化 BLOCKED 携 `CONTRACT_*` 家族错误码（如合同死锁分析）。
2. **runner/entrypoint 保真透传**（`docker/cecelia-runner/entrypoint.sh`）：检测到结构化终态时回执必须保真透传该终态，**禁止**在进程退出码非零时一律降级/包装为 `failure_code=provider_exit`。
3. **kernel 分类**（`packages/brain/src/orchestrator/ground-truth.js`）：收到 `CONTRACT_*` 家族故障码 → 走既有合同故障重开 GAN 路径，**不**归入 `provider_exit` / `provider_timeout` 基础设施病族。
4. **kernel 派发**（`packages/brain/src/orchestrator/dispatcher.js`）：`CONTRACT_*` 故障 **不进 failed_targets 黑名单、不按 infrastructure 重试**。
5. **可观测出口**：结构化终态的真因（success 结果 / `CONTRACT_*` 码）在回执与案卷中原样可见，不被埋没。

## 边界情况

- **负向（语义不变）**：真实 provider 进程崩溃（无任何结构化产出、纯退出码非零）仍按 `provider_exit` / infrastructure 处理——保真透传只对"有结构化终态"生效。
- success 结果 JSON 与结构化 BLOCKED 两类都要覆盖（r69 是 BLOCKED，r77 是 success）。
- 纯函数可重放：相同回执输入 → 相同分类结果，无隐藏时钟/随机态。

## 范围限定

**在范围内**：
- runner/entrypoint 结构化终态的保真透传（不降级为 provider_exit）
- kernel 对 `CONTRACT_*` 家族的分类与派发（重开 GAN，不进黑名单、不 infra 重试）
- RED 先行复刻 r69/r77 场景的回归测试

**不在范围内**：
- 合同重开后主链路由缺陷（`WORKSPACE_RESOLUTION_FAILED`，台账另修）
- provider 真崩溃的黑名单语义（保持不变）

## 假设

- [ASSUMPTION: `CONTRACT_*` 家族错误码集合以现有 `golden-path-contract-schema.js` / `sprint-result-contract.js` 定义为准，本 sprint 只做分类透传，不新增码值。]
- [ASSUMPTION: 结构化终态判定信号来自 entrypoint 已提取的 `structured_output`（entrypoint.sh:2851-2878 已有提取逻辑），本 sprint 复用而非新建提取。]

## 预期受影响文件

- `docker/cecelia-runner/entrypoint.sh`：结构化终态存在时回执保真透传，禁止一律包装 provider_exit（约 line 2756-2798 分类块）
- `packages/brain/src/orchestrator/ground-truth.js`：`CONTRACT_*` 不入 `GENERATOR_RUNTIME_ERROR_CODES` 病族，走合同故障重开
- `packages/brain/src/orchestrator/dispatcher.js`：`CONTRACT_*` 不进 failed_targets 黑名单、不按 infrastructure 重试
- `tests/gp/f1/step3-<新名>.test.js`：RED 先行，真 import 被改模块，复刻 r69/r77（文件名避让 main 已有同族文件）
- 行为变更冲突的既有回归测试（如 `ground-truth.test.js` / `dispatcher` 相关）一并 claim 更新
- 版本 bump 四处（package.json + DEFINITION 同步链）
- `packages/quality/**/DoD.md`、`sprints/08290045-kernel-r80-provider-exit-fidelity/**`

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 结构化终态（success 结果 JSON / 结构化 BLOCKED + `CONTRACT_*` 码）真因必须保真回执并留痕，失败不得埋没为 provider_exit
- 幂等/可重放: 分类为纯函数可重放（相同回执输入恒得相同分类）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 源为空）；仅注入与本 kernel 主题相关项 -->
- [generator_infrastructure_retry_identity] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix（来源: area）
- [Kernel existing PR evaluator validation clock adoption] 保留 validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload 显式 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时首个 Evaluator intent 可建一次共享 validation clock，缺失/不一致一律拒绝（来源: area）
- [planner_role_branch] Planner workspace 必须停在服务端签发的 planner_branch；Provider 可校验但禁止 checkout/switch 分支（来源: area）
- [Fleet Generator Brain URL authority] Dispatcher 与 Fleet Worker 必须同时注入服务端权威 HARNESS_BRAIN_URL；Generator 仅在通用 BRAIN_URL 缺失时从该变量恢复，预检 fail-closed，禁止手工绕过（来源: area）
- [status 枚举 grep 复查] contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值时须全仓库 grep 复查，避免遗漏同类枚举检查点（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 golden-paths 返回空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node --test 真 import 被改模块 + 案卷断言）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node --test tests/gp/f1/ + 案卷/回执断言）
# 期望验收点（自然语言）：
# 1. RED 复刻：给入结构化终态回执（r69 结构化 BLOCKED + CONTRACT_* / r77 success 结果 JSON），
#    修复前 kernel 误判 provider_exit → 测试红。
# 2. GREEN：修复后 CONTRACT_* 走合同故障重开 GAN，不进 failed_targets、不按 infrastructure 重试；
#    success 结果 JSON 保真透传，真因原样可见。
# 3. 负向不回退：无结构化产出的真崩溃仍判 provider_exit / infrastructure，语义不变。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/src/orchestrator/（kernel 分类/派发）+ docker/cecelia-runner/entrypoint.sh 后端回执链路，无 UI/无远端 agent 协议，属自治后台。
## target_environment: local_api
## target_environment_reason: 纯函数可重放的 node 测试放 tests/gp/f1/，真 import 被改的 brain orchestrator 模块，本地 evaluator 执行（node --test + 案卷断言），无部署/无浏览器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
