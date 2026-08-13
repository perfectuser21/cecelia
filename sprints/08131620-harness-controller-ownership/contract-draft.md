# Sprint Contract Draft (Round 2) — Harness 双运行时 Controller ownership 与 GP identity 收口

> journey_type: autonomous ｜ target_environment: local_api ｜ propose_round: 2
> BASE_REPO: perfectuser21/cecelia ｜ contract-gate: 本地 contract-gate.js 存在，走代码层 gate（cecelia 场景）

## Response Schema（推导来源: PRD字面 / 本任务无 HTTP 响应）

N/A — 本 sprint 是纯 `packages/brain` 后端内部改动（dispatcher 组包谓词 + relay 建 run 事务 + lease 续租写路径 + 无主 run 巡检），
不新增/修改任何 HTTP 端点，无对外 response body。相关"schema 契约"是 `initiative_runs` 两列（controller_session_id /
controller_lease_expires_at）的落库与续租语义，由下方 Golden Path Step 2/4 + DoD B-03/B-04/B-07..B-11 以 psql/真 PG 断言覆盖，不是 HTTP schema。

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js` → 「Session Controller ownership + createKernelRun fail-closed + 启动链收敛」：kernel-v1 主派发路径已带 ownership，本单不得回退。
- [回归] `packages/brain/src/__tests__/relay-runs-canonical-create.test.js` → 「canonical POST /orchestrator/relay-runs 经 createKernelRun 建 run」：canonical 建 run 走 createKernelRun 的路由契约不变。
- [回归] `packages/brain/src/__tests__/relay-runs-create.test.js` / `harness-skill-relay.test.js` → legacy relay 四分支 spawn / 回滚语义：本单只加 ownership 落库 + 续租，不得破坏 spawn 失败回滚（`UPDATE tasks SET status='queued'`）与幂等守卫（`active_run_guard` / `live_container_guard`）。
- [生产事实 · Round 2 核对] `packages/brain/src/orchestrator/heartbeat.js::writeHeartbeat` 只 UPDATE `orchestrator_heartbeat_at/host/pid` 三列，**从不写 `controller_lease_expires_at`**；全仓 `SET.*controller_lease_expires_at` 在 Round 1 前零命中，lease 仅在 `createKernelRun` INSERT 时一次性写 `NOW()+leaseSeconds`。故"续租由既有 watchdog 承载"（Round 1 假设）为假 —— 生产不存在续租写路径。本轮必须**新增** CAS 续租写路径，见 Golden Path Step 4。
- [生产事实 · Round 2 核对] legacy one-session relay 在容器内跑 `claude`/`codex` skill，**不跑 kernel orchestrator loop（loop.js beat）**，故 legacy relay run 的 `orchestrator_heartbeat_at` 无进程内写入者；其唯一活性信号是容器本身（`harness-relay-watchdog.js::resumeStalledRelayRuns` 用 `docker ps -q --filter name=cecelia-relay-<short>` 探活）。→ 续租必须由既有 relay watchdog 的活容器扫描驱动，不能挂在 heartbeat 上。
- [累积FR] 本 line journey_id 为 null，无 line 级历史（PRD「累积 FR」段：本 line 暂无历史）。context-manifest: N/A（PRD journey_id=none，无 T3 累积 FR 端点可查）。

## 历史约束三源加载（EVA v2）

**源①：铁律清单 → DoD Invariant 覆盖（逐条映射，见 contract-dod.md INV 段）**

| 铁律（来源 PRD Invariant 段） | 映射 |
|---|---|
| [终态权归一] 两代运行时不得争夺 initiative_runs 终态权；所有 v2 active run 必须有可续租 Controller ownership | INV-1（DoD B-03/B-04 建 run 带 ownership + B-07..B-09 生产 CAS 续租 + B-10 活过 >30min 边界 + B-05/B-11 尊重有主/回收无主 真 PG 覆盖） |
| [local_api验证] judge 机械闸⑤ meta_verification_gap 对无 UI smoke 任务死锁，需显式声明验证方式 | INV-2（本合同 `## E2E 验收` 显式声明验证方式 = vitest 纯函数单测 + 真 PG integration + psql 列断言；无 UI smoke） |
| [台账不入库] `.harness/progress.md` 必须在 git 追踪外 | INV-3（N/A：本 sprint 不产出 `.harness/progress.md`；git add 白名单不含 `.harness/`） |
| [exit语义实跑] 验证命令必须实跑确认 exit code；vitest 对 include 范围外路径绿态也退出 0 | INV-4（DoD 每条 [BEHAVIOR] Test 命令用 `grep -E "Tests .* [0-9]+ passed"` + `! grep failed` 双闸，捕获 0-match 假绿） |

**源②：累积 FR 摘要（context-manifest T3 端点）**：PRD journey_id=none，无 journey 点火，端点不适用 → `context-manifest: N/A (journey_id=none)`。

**源③：回归测试约束**：见上「已知约束」段。

## 案卷 closure 声明（propose_round = 2）

上一轮（Round 2 reviewer 行，attempt 7a572dd5）blocker 台账逐条 closure：

### R2-E2-1（重开）：Controller lease 续租承诺没有生产实现且合同边界测试无效 — **CLOSED（真改）**

**Reviewer 原话核心**：默认 lease=30min，但 B-05 只推进 6min；生产只有创建 lease，没有 renewal writer；`heartbeat.js` 只更新 heartbeat/host/pid，全仓 `SET.*controller_lease_expires_at` 零命中；仅写 30min lease 只是把误杀从 5min 推迟到 30min，与 NFR/Invariant「可续租 Controller ownership」冲突。要求：新增绑定 controller_session_id 的 CAS renewal，并以 >30min 边界证明健康 run 不被 ownerless scanner 回收；覆盖 owner mismatch / 终态 / 陈旧 heartbeat 拒绝 / 真实过期 owner 回收。

**做了什么（本轮合同新增，可在 Round 2 contract-draft/dod 找到对应改动）**：
1. 合同新增 **Golden Path Step 4** 与 **禁 mock 边清单第 4/5 条**，要求生产**新增 CAS 续租写路径** `renewControllerLease(pool, {runId, controllerSessionId, leaseSeconds, now})`，CAS 谓词 `WHERE id=$runId AND controller_session_id=$controllerSessionId AND phase NOT IN ('done','failed')` —— owner 不匹配或终态 → `renewed=false`（不动 lease）。
2. 续租由**既有 relay watchdog** 的活容器扫描驱动（新增 `renewLiveRelayLeases`，接入 `runHarnessWatchdogOnce` 第 2.6 步），复用既有 5min 看门狗 + `docker ps` 活性信号 —— 不新造守护进程（守 PRD「不在范围内：新建独立续租守护进程」）。
3. DoD 新增 **B-07（owner 匹配续租成功）/ B-08（owner 不匹配拒绝）/ B-09（终态拒绝）/ B-10（活容器续租后活过 >30min 默认 lease 边界不被回收）/ B-11（死容器不续租 → lease 真过期 → reconcile 以 `controller_lease_expired` 回收）**，测试时钟推过真实到期边界（用例⑦ reconcile@t+40min、用例⑧ reconcile@t+31min，均 >30min）。B-05 的 6min 用例保留但不再是续租证据，续租证据落在 B-10/B-11。
4. 「陈旧 heartbeat 拒绝」落为 B-11：legacy relay 无进程内 heartbeat，活性=容器；死容器（`docker ps` 空）即 stale → 续租扫描跳过 → lease 到期被回收。

**为什么足以关闭**：生产从"只有创建 lease、无续租写路径"变为"有 owner 绑定 CAS 续租 + 活容器驱动续租 + >30min 边界真 PG 证据"，健康 relay 在容器存活期间每 5min 被续租，lease 恒在未来 → 不再被 30min 边界误杀；容器真死则不续租、lease 真过期、reconcile 以可区分 cause 回收。PRD P0 与 NFR/Invariant「所有 v2 active run 必须有可续租的 Controller ownership」由此闭合。

**quote（本轮新增条款原文，≥20 字）**：
> "生产新增 CAS 续租写路径 `renewControllerLease(pool, {runId, controllerSessionId, leaseSeconds, now})`，CAS 谓词 `WHERE id=$runId AND controller_session_id=$controllerSessionId AND phase NOT IN ('done','failed')`；owner 不匹配或终态 → `renewed=false`（不动 lease）。续租由既有 relay watchdog 的活容器扫描 `renewLiveRelayLeases` 驱动，接入 `runHarnessWatchdogOnce` 第 2.6 步，复用既有 5min 看门狗，不新造守护进程。"

（注：Round 1 reviewer 行 blockers=[] 无需 closure；本轮唯一重开项 R2-E2-1 已 CLOSED。）

## MAP 影响半径

MAP scope=`cecelia`、repo=`perfectuser21/cecelia`（已配置），但 task.payload.expected_files 为空 →
radius 无法计算 → `affected_business_nodes=[]`、`must_run_assertions=[]`。无额外 must-run 回归约束注入。
（非 `[MAP_NOT_CONFIGURED]`：scope/repo 已配，仅 expected_files 空。）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺做什么 | ①dispatcher 组包 journey-only generator-fix 不再抛 GP_CONTRACT_IDENTITY_INVALID / TASK_BUNDLE_ASSEMBLY_FAILED；②legacy relay 四分支建 initiative_runs 落库即带非空 controller_session_id + 未来 lease；③**新增生产 CAS 续租写路径**，活容器每巡检周期续租 lease（owner 绑定 + 终态拒绝）。 |
| **NFR（做得多好）** | 性能/可靠性/并发 | orchestrator_version='v2' active run 必须携带**可续租** ownership；健康 relay 必须活过 >30min 默认 lease 边界（续租周期 5min « lease 30min，容器存活期间 lease 恒在未来）。 |
| **Invariant（永不违反）** | 不变量 | [终态权归一] 两代运行时不得争夺终态权；续租只允许 owner 且非终态（CAS）；无主/真过期 run 仍必须被回收（回收能力不削弱，cause 可区分）；部分 GP 身份继续 fail-closed。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方判定点登记表。 |
| **保质期（何时过期）** | 能力/数据何时失效 | controller lease 默认 1800s(30min) 到期；**由本单新增的 relay watchdog 活容器续租扫描每 5min 续租**（容器活即续，容器死即不续 → 到期回收）。 |
| **死亡告警（停了谁知道）** | 停摆谁知道 | reconcileOwnerlessKernelRuns 每巡检周期扫描；无主/过期 run finalize failed 并落结构化 failure_reason（`ownerless_kernel_run_recovered:no_controller_ownership` vs `:controller_lease_expired`），既有恢复流程重派。 |
| **失败语义（挂了怎么办）** | 故障放行/拦截/重试 | 见下方失败语义声明。fail-closed：ownership 写入失败即建 run 失败（不产半态无主 run）；续租 CAS 命中 0 行（owner 不符/终态）不报错、不动 lease。 |
| **效果确认（已发≠已生效）** | 回执确认 | 建 run 后真 PG SELECT 确认两列非空 + lease 未来；续租后 SELECT 确认 lease 被推到 now+leaseSeconds；健康 relay 活过巡检以真 reconcile 后 phase 仍非终态确认。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ relay run 是否"无主"（该不该终态化） | A. controller_session_id 为空或 lease 过期即无主; B. 探活容器进程 | A（既有 isOwnerlessRun 纯谓词，不改判据） | 生产证据：lease 是唯一持久化可续租凭据；容器探活跨节点不可靠（#3848） | ⚠️ 误判"有主为无主"→ 误杀活 relay（本单正修的 P0）；误判"无主为有主"→ 真无主 run 逃逸不回收。B-10（不误杀有主续租 run）与 B-11/B-03对照（正常回收真过期/无主）双向锁死。 |
| ⚠️ relay 容器是否"仍活"（该不该续租 lease） | A. `docker ps -q --filter name=cecelia-relay-<short>` 非空即活; B. orchestrator_heartbeat_at 新鲜度 | A（沿用 resumeStalledRelayRuns 既有活性判据；legacy relay 无进程内 heartbeat，B 不适用） | legacy relay 在容器内跑 skill、不跑 orchestrator loop，heartbeat 无写入者；容器是唯一活性信号 | ⚠️ 误判"死容器为活"→ 续租僵尸 run 逃逸回收；误判"活容器为死"→ 停续租致误杀。B-10（活容器续租过 30min）与 B-11（死容器不续租 → 回收）双向锁死。 |
| journey-only 任务是否"带 GP 合同" | A. 任意 GP 相关字段（含通用 journey_id）非空即触发; B. 仅版本化 GP 身份字段（gp_contract_id/version/hash/golden_path_id/step_id）非空才触发 | B | journey_id 是通用路径标识，非版本化 GP 合同身份；A 会把 journey-only 误判为不完整合同（本单正修的 P0） | 误判 journey-only 为"部分 GP 身份"→ fail-closed 抛错阻断 generator-fix 派发。B-01/B-02 双向锁死。 |

（⚠️ 行为「升拍板点」级：误判后果面客严重。判据本身沿用既有 `isOwnerlessRun` 纯谓词 + `resumeStalledRelayRuns` 既有容器活性判据 + PRD 边界，PrepPRD 已拍板，无需再请示 → 不加 `judgment-pending-user`。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| ownership 写入失败（创建事务内） | 建 run 失败，不产半态无主 run（fail-closed，与 createKernelRun 现语义一致） | 是（既有 active_run_guard / advisory lock 去重） | 上抛 spawn 失败 → task 回滚 queued，下一 tick 续派 |
| 续租 CAS owner 不匹配 / run 已终态 | `renewed=false`，不动 lease、不报错（幂等 no-op；防两代运行时争夺终态权 / 非 owner 越权续租） | 是（纯 CAS，rowCount 判定） | 无（该 run 由真 owner 续租或到期被回收） |
| relay 容器真死 / lease 真过期 | 续租扫描不续租（容器探活为空）→ reconcile 正常 finalize failed + 结构化 failure_reason（cause=controller_lease_expired） | 是（幂等，二次纯谓词确认） | 既有恢复流程重派（本单不改） |
| 部分 GP 身份（缺 version/hash） | 抛 GP_CONTRACT_IDENTITY_INVALID（fail-closed，行为不变） | N/A | preAttemptAssemblyFault 上报 |

### 输入对抗面（对外暴露 agent）

N/A — 本 sprint 无对外暴露 agent/webhook 输入面。dispatcher 组包读的是 Brain 自身派发的 task.payload（内部可信来源，非外部用户可写），relay 建 run / 续租读的是内部 task/run 行。无 prompt injection / 越权指令面。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

（当前仓库 `perfectuser21/cecelia` 根目录无 `product-map/generated/product-map.json`，本段整体跳过，不阻塞。）

## 真实调用方请求 shape

N/A — 本单无"设备/外部 agent 调服务端"接缝。刀一的"调用方"是 Brain 自身 CI-fail 后的 `spawn:generator-fix` 内部派发（读 task.payload，非外部 header/body 双路径）；刀二的"调用方"是 Brain tick 内部拉起 relay + 内部 watchdog 续租。均为进程内内部调用，无生产外部调用方 shape 需对齐。

## 未覆盖真实链路清单

- session 分支 ownership 落库 + reconcile + 续租交互：**真 PG 覆盖**（`relay-ownership.pg.integration.test.js` 真 spawnSkillRelaySession + 真 renewControllerLease + 真 renewLiveRelayLeases + 真 testPool，见禁 mock 边清单），非 mock。
- grok fallback / xian / headed 三分支的 ownership 落库：本轮 Red 种子只真 PG 驱动 session 分支（生产事故实证路径 = session relay run 59a41559）。generator 必须扩展覆盖另三分支的 ownership（首选真 PG 驱动各分支到其 INSERT；次选断言各分支委托同一带 ownership 的创建函数 / createKernelRun 且传入非空 controllerSessionId）。**登记为待补真验位**：三分支若以 fake pool 仅验 SQL-shape，controller 需将此呈现进 PR 描述；DoD B-03 要求四分支全覆盖，evaluator 核四分支非空 ownership。
- `renewLiveRelayLeases` 的 `docker ps` 活性探针：测试以 `execFn` 替身（返回容器 id=活 / 空=死）注入两态 —— docker CLI 是最外层无关边界（非被改的 DB 续租边），替身合规；被改的续租写路径（renewControllerLease UPDATE + initiative_runs）全程真 PG。
- 无第三方 API 依赖 → 规则 B（第三方真调）N/A。

## 禁 mock 边清单

本单改动涉及【状态机（run 终态判定）+ 生命周期钩子（建 run 创建事务 + lease 续租）+ 跨模块数据传递（relay/watchdog→创建/续租函数→DB）+ DB 写路径（initiative_runs 两列 INSERT + 续租 UPDATE）】，failing test 必须真 PG 真相邻模块：

1. 代码 ↔ `initiative_runs.controller_session_id` / `controller_lease_expires_at`（本单新增写这两列 + 新增续租 UPDATE）：真 testPool 连真 PG，禁 mock `pool.query` 顶替 INSERT/SELECT/UPDATE。
2. `harness-skill-relay` 建 run 分支 ↔ 创建事务 ↔ `initiative_runs`：真 `spawnSkillRelaySession` + 真 pool，只替身与"落库带 ownership"无关的最外层依赖（docker ps `execFn` / `spawnFn` / worktree `ensureWt` / `loadSkill` / `tokenFn` / 账号 `resolveAccountFn`）。
3. `reconcileOwnerlessKernelRuns` ↔ `initiative_runs`（状态机终态判定 + DB 读写）：真 PG，禁 mock。
4. `renewControllerLease` ↔ `initiative_runs`（本单新增 CAS 续租 UPDATE 写路径）：真 PG，禁 mock pool.query。
5. `renewLiveRelayLeases` ↔ `initiative_runs` + `renewControllerLease`（本单新增活容器续租扫描，是被改的续租调用链）：真 PG；仅 `docker ps` 活性探针 `execFn` 为最外层替身（非被改的 DB 边）。
6. 纯函数例外：dispatcher `gpContractIdentity`（经 `__test__.buildInputs`）无 DB/接缝边，纯函数真调，无需真 PG。

集成测试放 `src/__tests__/integration/`（`*.pg.integration.test.js`），登记进 `vitest.config.js` `POSTGRES_INTEGRATION_TESTS`，由 CI brain-integration job（`vitest.integration.config.js` + 真 PG service）执行。

## Golden Path

**锚定父路声明**：独立小路（无父路）。

[CI fail 触发修复 / relay 拉起] → [组包与建 run] → [活容器续租] → [派发成功且 run 活过 >30min lease 边界]

---

### Step 1: journey-only generator-fix 组包不再误判 GP 合同（刀一）

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条 + 「范围限定/在范围内」第 1 项（gpContractIdentity 触发谓词剔除通用 journey_id）。

**可观测行为**: dispatcher 用 journey-only payload（含 `journey_id`、无版本化 GP 身份字段）为 `spawn:generator-fix` 组 TaskBundle 时，`gpContractIdentity` 判为"无 GP 合同"返回 null，`buildInputs` 正常返回、不抛 `GP_CONTRACT_IDENTITY_INVALID` / `TASK_BUNDLE_ASSEMBLY_FAILED`，且 bundle 无 `gp_contract`；部分 GP 身份继续 fail-closed 抛错；完整版本化 GP 身份继续透传 frozen contract。

**验证命令**:
```bash
cd packages/brain
OUT=$(NODE_ENV=test npx vitest run src/__tests__/dispatcher-gp-contract-identity.test.js --reporter=dot 2>&1)
echo "$OUT" | grep -E "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"
# 期望：3 用例全过（journey-only 不抛 / 部分身份仍抛 / 完整身份透传）
```

**硬阈值**: 3 用例全 passed，0 failed。触发谓词仅版本化 GP 身份字段（gp_contract_id/version/hash/golden_path_id/step_id），不含 journey_id。

---

### Step 2: legacy relay 四分支建 run 落库即带 Controller ownership（刀二）

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 「范围限定/在范围内」第 2 项（四处直写 INSERT 收敛为带 controller ownership 的创建）。

**可观测行为**: legacy one-session relay（session / grok fallback / xian / headed）创建 `initiative_runs` 时，在同一创建事务写非空 `controller_session_id` + 未来 `controller_lease_expires_at`（复用 `createKernelRun` 或等价单一创建函数）。真 PG 查该 v2 run，两列均非空、lease 在未来。

**验证命令**:
```bash
cd packages/brain
OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js -t "落库即带非空" --reporter=dot 2>&1)
echo "$OUT" | grep -E "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"
# 期望：真 PG 建 run 后 controller_session_id / controller_lease_expires_at 均非空
```

**硬阈值**: 建 run 后 `controller_session_id IS NOT NULL` 且 `controller_lease_expires_at > NOW()`；四分支（session/grok fallback/xian/headed）均满足。

---

### Step 3: 生产 CAS 续租写路径 — owner 绑定、终态拒绝（刀二 · Round 2 新增，关闭 E2-1）

**来源**: `[AI_ADDED]` — GAN Round 2 Reviewer blocker E2-1 要求。理由：生产核对确证「续租由既有 watchdog 承载」为假（heartbeat.js 只写三列、全仓无 `SET controller_lease_expires_at`），仅写 30min lease 只把误杀从 5min 推迟到 30min，与 Invariant「可续租 ownership」冲突。必须新增真实续租写路径，否则健康 relay 30min 后仍被 `controller_lease_expired` 误杀。

**可观测行为**: 生产新增 CAS 续租写路径 `renewControllerLease(pool, {runId, controllerSessionId, leaseSeconds, now})`，CAS 谓词 `WHERE id=$runId AND controller_session_id=$controllerSessionId AND phase NOT IN ('done','failed')`。owner 匹配且非终态 → `controller_lease_expires_at = now + leaseSeconds*INTERVAL '1 second'`、`renewed=true`；owner 不匹配 → `renewed=false`、lease 一字不动；run 已终态（done/failed）→ `renewed=false`（终态不复活 lease，防两代运行时争夺终态权）。

**验证命令**:
```bash
cd packages/brain
OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js -t "renewControllerLease" --reporter=dot 2>&1)
echo "$OUT" | grep -E "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"
# 期望：owner 匹配续租成功 / owner 不匹配 renewed=false 且 lease 不变 / 终态 renewed=false，3 用例全过
```

**硬阈值**: owner 匹配 → `renewed=true` 且 `controller_lease_expires_at > now`；owner 不匹配 → `renewed=false` 且 lease 值不变（严格相等）；终态 run → `renewed=false`。

---

### Step 4: 活容器续租使健康 relay 活过 >30min lease 边界；死容器不续租则真过期回收（刀二出口 · Round 2 新增，关闭 E2-1）

**来源**: `[AI_ADDED]` — GAN Round 2 Reviewer blocker E2-1「必须以 >30min 边界证明健康 run 不被 ownerless scanner 回收」+「陈旧 heartbeat / 真实过期 owner 回收」。理由：把续租接进既有 relay watchdog 的活容器扫描（复用既有 5min 看门狗 + docker ps 活性信号；legacy relay 无进程内 heartbeat，容器是唯一活性信号），不新造守护进程（守 PRD 不在范围内条款）。

**可观测行为**: 既有 relay watchdog 新增活容器续租扫描 `renewLiveRelayLeases(pool, {execFn, now, leaseSeconds})`，接入 `runHarnessWatchdogOnce`（新增第 2.6 步）：扫 v2 active、`orchestrator_host LIKE 'skill-relay%'`、`controller_session_id` 非空的 run，逐条 `docker ps -q --filter name=cecelia-relay-<short>` 探活；容器活 → 调 `renewControllerLease`（owner 绑定）续租、进 `renewed` 列表；容器死（探活空）→ 跳过不续租。由此：①活容器 relay 每 5min 续租，lease 恒在未来 → 经 `reconcileOwnerlessKernelRuns` 推进至 >30min（默认 lease 边界）后仍非终态、不被回收；②死容器 relay 不续租，lease 真过期后 reconcile 以 `controller_lease_expired`（区别于 `no_controller_ownership`）finalize failed（回收能力未削弱）。

**验证命令**:
```bash
cd packages/brain
OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js -t "renewLiveRelayLeases 续租|死容器不续租" --reporter=verbose 2>&1)
echo "$OUT" | grep -qE "活过 >30min" && echo "$OUT" | grep -qE "controller_lease_expired 回收"
echo "$OUT" | grep -E "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"
```

**硬阈值**: 活容器续租后 reconcile@t+40min（>30min）→ 该 run 不在 recovered 列表且 phase ∉ {done,failed}；死容器不续租 → reconcile@t+31min → phase=failed 且 cause=`controller_lease_expired`。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 说明：本 sprint 无 HTTP app / 无 UI smoke，验证方式=纯函数单测（刀一）+ 真 PG integration（刀二建 run + CAS 续租 + 活过 >30min 边界）+ psql 列断言。
> Fleet 注入 attempt 级 `DB_URL`；本脚本由其派生 DB_HOST/PORT/USER/PASSWORD/NAME 供仓库既有隔离 DB 测试框架使用
> （集成测试自建隔离库 + 真跑 `src/migrate.js` 至最新迁移，controller ownership 列由 migration 415 落库；不复制生产数据、无业务身份需登录自举）。
> 身份 late-binding：本测试 run 的 `controller_session_id` 由运行时 `randomUUID()`（或 spawn 生成）产生，无 attempt_id/UUID 字面值固化为验收身份（无 HARNESS_* 需注入的执行角色断言）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"

# 1. 从 DB_URL 派生仓库测试框架所需的 DB_* env（隔离库 admin 连 'postgres' 建库 + CREATE DATABASE）
eval "$(node -e '
  const u = new URL(process.env.DB_URL);
  const q = (s) => (s || "");
  process.stdout.write(
    "export DB_HOST=" + JSON.stringify(q(u.hostname)) + "\n" +
    "export DB_PORT=" + JSON.stringify(q(u.port || "5432")) + "\n" +
    "export DB_USER=" + JSON.stringify(decodeURIComponent(q(u.username))) + "\n" +
    "export DB_PASSWORD=" + JSON.stringify(decodeURIComponent(q(u.password))) + "\n" +
    "export DB_NAME=" + JSON.stringify(q(u.pathname.replace(/^\//, "")) || "cecelia_test") + "\n"
  );
')"
export NODE_ENV=test
cd packages/brain

# 2. 空库真跑仓库迁移，机检 controller ownership 列存在（防"列缺失"假通过；列由 migration 415 落库）
node src/migrate.js
COLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')")
[ "$COLS" = "2" ] || { echo "FAIL: initiative_runs 缺 controller ownership 列 (found=$COLS)"; exit 1; }

# 3. 刀一：纯函数单测（journey-only 不抛 / 部分身份仍抛 / 完整身份透传）
OUT1=$(NODE_ENV=test npx vitest run src/__tests__/dispatcher-gp-contract-identity.test.js --reporter=dot 2>&1) || true
echo "$OUT1" | tail -5
echo "$OUT1" | grep -qE "Tests .* [0-9]+ passed" || { echo "FAIL: 刀一单测未运行(0-match 假绿防护)"; exit 1; }
echo "$OUT1" | grep -qE "Tests .* [0-9]+ failed" && { echo "FAIL: 刀一单测有失败"; exit 1; } || true

# 4. 刀二：真 PG integration（四分支建 run ownership + CAS 续租 owner/终态 + 活过 >30min 边界 + 死容器真过期回收 + 无主对照）
OUT2=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js --reporter=verbose 2>&1) || true
echo "$OUT2" | tail -20
echo "$OUT2" | grep -qE "Tests .* [0-9]+ passed" || { echo "FAIL: 刀二集成未运行(0-match 假绿防护)"; exit 1; }
echo "$OUT2" | grep -qE "Tests .* [0-9]+ failed" && { echo "FAIL: 刀二集成有失败"; exit 1; } || true

echo "✅ Golden Path 验证通过（刀一纯函数 + 刀二真 PG 建 run/续租/活过30min边界/真过期回收）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 12 分钟 / 18 动作（续租 CAS + 边界时钟维度较多，较默认略放大）
高风险面:
- 错输入: `renewControllerLease` 传 `leaseSeconds<=0` / 非有限数 → 必须拒绝（不产负/无穷 lease）；`controllerSessionId` 空串 → 视为 owner 不匹配 renewed=false，不得误命中 `controller_session_id IS NULL` 的行。
- 重复提交: 同一 task 连续两次 spawnSkillRelaySession → active_run_guard / advisory lock 必须仍去重，不产生第二条 run；`renewLiveRelayLeases` 对同一活 run 多轮调用幂等（每轮把 lease 推到 now+leaseSeconds）。
- 中途中断: 活容器续租后容器突死 → 下一轮扫描不再续租，lease 到期被 `controller_lease_expired` 回收（不得因上一轮续租过就永久豁免）。
- 边界值: lease 恰好等于 now（`isOwnerlessRun` 用 `<` 严格比较，等于不算过期）；续租时 run 在 CAS 与 reconcile 之间并发终态 → 终态方赢（renewed=false，reconcile 二次纯谓词确认防竞态误伤）。
- 竞态: `renewControllerLease` 与 `reconcileOwnerlessKernelRuns` 同 now 并发 → CAS `phase NOT IN ('done','failed')` + reconcile 二次 `isOwnerlessRun` 确认，二者不得互相把对方结果覆盖成矛盾态。
发现分级: P0/P1（误杀活 relay / 真无主逃逸 / journey-only 再被阻断 / 非 owner 越权续租）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 刀一 gpContractIdentity 触发谓词 | `packages/brain/src/__tests__/dispatcher-gp-contract-identity.test.js` | `journey-only payload 不触发 GP 校验`、`部分 GP 身份`、`完整版本化 GP 身份继续透传 frozen contract` | 未修前 journey-only 用例 FAIL（抛 GP_CONTRACT_IDENTITY_INVALID）→ 1 failed \| 2 passed（已实测） |
| 刀二 relay ownership 建 run | `packages/brain/src/__tests__/integration/relay-ownership.pg.integration.test.js` | `session 分支建 run 落库即带非空 controller_session_id + 未来 lease`、`活过一个巡检周期`、`无 ownership 的 v2 active run 经 reconcile 仍被终态化` | 未修前两列 NULL → ①② FAIL（Red by construction；真 PG） |
| 刀二 CAS 续租 owner/终态 | `packages/brain/src/__tests__/integration/relay-ownership.pg.integration.test.js` | `renewControllerLease：owner 匹配`、`renewControllerLease：owner 不匹配`、`renewControllerLease：run 已终态` | 未修前 renewControllerLease 未导出/未实现 → import 或调用 FAIL |
| 刀二 活容器续租过 30min / 死容器真过期回收 | `packages/brain/src/__tests__/integration/relay-ownership.pg.integration.test.js` | `renewLiveRelayLeases 续租 → 健康 relay 活过 >30min`、`死容器不续租（stale）→ lease 真过期后 reconcile 以 controller_lease_expired 回收` | 未修前 renewLiveRelayLeases 未实现 + lease 30min → t+40min reconcile 回收健康 run（⑦ FAIL）；ownership NULL → cause≠controller_lease_expired（⑧ FAIL） |
