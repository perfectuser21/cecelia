# Sprint PRD — 结构化上报保真透传，根除 provider_exit 语义埋没 [r81]

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（harness kernel 失败留原因病族，合同故障不再被埋没）

## 背景

第六次点火本主题。执行体（generator/commander）明明产出了结构化终态（success 结果 JSON，或结构化 BLOCKED + CONTRACT_* 家族错误码），却在回执链路上被非零退出码覆盖为 `provider_exit`，导致失败不留原因病族、合同故障被误当基础设施崩溃。三实证：r69 attempt 56a09164、r76、r77 attempt e022a331（success JSON 被判 provider_exit）。两个埋没点已定位：`docker/cecelia-runner/entrypoint.sh` 的 `normalize_provider_failure` 在构造失败回执前不读已写出的结构化终态；`packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs` 的 close handler 在 `code !== 0` 时直接丢弃 result.json、盖章 `provider_exit_${code}`。

## Golden Path（核心场景）

执行体跑完写出结构化终态到 result.json（进程可能以非零码退出）→ 回执链路保真透传 → kernel 走合同故障重开 → 失败留原因病族。

具体：
1. runner/entrypoint（`normalize_provider_failure`）在构造失败回执前，先读 result.json；若已是合法结构化终态（success 或结构化 BLOCKED + `error.code ∈ CONTRACT_*`）则原样透传，禁止覆盖为 `provider_exit`。
2. kernel bridge（`kernel-attempt-handler` close handler）在 `code !== 0` 时先尝试 `parseHarnessResult(resultPath)`；解析成功且为结构化终态则保真透传，仅无结构化产出时才回退 `provider_exit_${code}`。
3. kernel 分类：`error.code ∈ CONTRACT_*` 家族 → 走既有合同故障重开 GAN 路径，不进 `failed_targets` 黑名单、不按 infrastructure 重试。
4. 出口：合同故障不再被埋没为 `provider_exit`；GAN 重开，回执/日志可观察到 `CONTRACT_*` code。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 真实 provider 进程崩溃（无 result.json / 解析失败 / spawn 失败）→ 仍为 `provider_exit` / `provider_result_invalid` / `provider_spawn_failed`（infrastructure），语义不变。
- exit 124 超时 → `provider_timeout` 语义不变。
- claude 认证失败（`not logged in` 等）→ `provider_unavailable` 语义不变。
- result.json 存在但结构非法（不满足 `parseHarnessResult` 契约）→ 视为无结构化产出，回退 `provider_exit` / `provider_result_invalid`。

## 范围限定

**在范围内**：`normalize_provider_failure` 与 kernel-attempt-handler close handler 的结构化终态前置读取与保真透传；`CONTRACT_*` 家族分类进合同故障重开路径的断言。
**不在范围内**：合同重开后主链路由缺陷 / assertion npm 预算解耦（42 批另修）；provider 真崩溃的黑名单语义（不动）。

## 假设

- [ASSUMPTION: CONTRACT_* 家族错误码的合同故障重开 GAN 路径既已存在，本 sprint 仅保证结构化终态保真到达该路径、不新建路由。]
- [ASSUMPTION: 结构化 BLOCKED 终态在 result.json 中以 `status` + `error.code` 形式落盘，且满足 `parseHarnessResult` 契约（contract_version=1.0 等）。]

## 预期受影响文件

- `docker/cecelia-runner/entrypoint.sh`: `normalize_provider_failure` 加结构化终态前置读取/透传闸
- `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs`: close handler `code !== 0` 分支先 `parseHarnessResult` 透传
- `packages/brain/src/orchestrator/ground-truth.js`（或 kernel 分类模块）: `CONTRACT_*` → 合同故障重开而非 infrastructure 的分类断言（若既有已支持则仅补测）
- `tests/gp/f1/step3-provider-exit-structured-fidelity.test.js`: RED 先行复刻 r69/r77（结构化 success/BLOCKED+CONTRACT_* 被判 provider_exit）
- 版本 bump 四处（`packages/brain/package.json` 等，check-version-sync 覆盖点）
- `sprints/08290210-kernel-r81-provider-exit-fidelity/DoD.md`
- 行为变更冲突的既有回归测试（如 `codex-bridge-kernel-attempt.test.js`）按需 claim 更新

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node 跑 tests/gp/f1 新测试 + 纯函数重放）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node --test tests/gp/f1/step3-provider-exit-structured-fidelity.test.js）
# 期望验收点（自然语言）：
#  (a) 非零退出 + 结构化 success result → 回执 status 保真 completed，非 provider_exit；
#  (b) 非零退出 + 结构化 BLOCKED + error.code=CONTRACT_X → error.code 保真透传，分类走合同重开、不进 failed_targets/infrastructure；
#  (c) 无 result.json（真崩溃）→ provider_exit / provider_spawn_failed 语义不变。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；以下为 thin_prd 显式约束（主源） -->
- 可观测: 结构化终态（success/BLOCKED+CONTRACT_*）失败必须留原因病族，禁止被 `provider_exit` 覆盖（本 sprint 核心 NFR）
- 纯函数可重放: 透传/分类逻辑必须纯函数、可离线重放（RED 先复刻 r69/r77 场景）
- 超时/预算: 信任断言 npm 预算 = min(1800s, deadline 余量)（来源: thin_prd 已知风险；不在本 sprint 修，仅记录——若 FAIL 且 failure_signature=required_assertion_dependency_invalid，kernel 已按 infra 有界重派，无需人工）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 空，area 一源 -->
- [语义不变] 真实 provider 崩溃（无结构化产出）仍按 provider_exit / infrastructure 处理，黑名单语义不动（来源: 本 sprint 不做边界 / 负向铁律）
- [凭据隔离] 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史；journey golden-paths 返回跨域 ability，不作为本 sprint 累积 FR）

## journey_type: autonomous
## journey_type_reason: 纯后端 kernel/harness 回执分类逻辑，落在 packages/brain 与 docker/cecelia-runner，无 UI、无远端 agent 协议测试
## target_environment: local_api
## target_environment_reason: 纯函数可重放，本地 evaluator 用 node 跑 tests/gp/f1 新测试（localhost 无需真机）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: F1（map_scope 锚定；PrepPRD 未提供更细 Step UUID）
