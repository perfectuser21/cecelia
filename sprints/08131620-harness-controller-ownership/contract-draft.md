# Sprint Contract Draft (Round 1) — Harness 双运行时 Controller ownership 与 GP identity 收口

> journey_type: autonomous ｜ target_environment: local_api ｜ propose_round: 1
> BASE_REPO: perfectuser21/cecelia ｜ contract-gate: 本地 contract-gate.js 存在，走代码层 gate（cecelia 场景）

## Response Schema（推导来源: PRD字面 / 本任务无 HTTP 响应）

N/A — 本 sprint 是纯 `packages/brain` 后端内部改动（dispatcher 组包谓词 + relay 建 run 事务 + 无主 run 巡检），
不新增/修改任何 HTTP 端点，无对外 response body。相关"schema 契约"是 `initiative_runs` 两列的落库语义，
由下方 Golden Path Step 2 + DoD B-03/B-04 以 psql/真 PG 断言覆盖，不是 HTTP schema。

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js` → 「Session Controller ownership + createKernelRun fail-closed + 启动链收敛」：kernel-v1 主派发路径已带 ownership，本单不得回退。
- [回归] `packages/brain/src/__tests__/relay-runs-canonical-create.test.js` → 「canonical POST /orchestrator/relay-runs 经 createKernelRun 建 run」：canonical 建 run 走 createKernelRun 的路由契约不变。
- [回归] `packages/brain/src/__tests__/relay-runs-create.test.js` / `harness-skill-relay.test.js` → legacy relay 四分支 spawn / 回滚语义：本单只加 ownership 落库，不得破坏 spawn 失败回滚（`UPDATE tasks SET status='queued'`）与幂等守卫（`active_run_guard` / `live_container_guard`）。
- [累积FR] 本 line journey_id 为 null，无 line 级历史（PRD「累积 FR」段：本 line 暂无历史）。context-manifest: N/A（PRD journey_id=none，无 T3 累积 FR 端点可查）。

## 历史约束三源加载（EVA v2）

**源①：铁律清单 → DoD Invariant 覆盖（逐条映射，见 contract-dod.md INV 段）**

| 铁律（来源 PRD Invariant 段） | 映射 |
|---|---|
| [终态权归一] 两代运行时不得争夺 initiative_runs 终态权；所有 v2 active run 必须有可续租 Controller ownership | INV-1（DoD B-03/B-04/B-05/B-06 真 PG 覆盖：relay run 带 ownership + reconcile 尊重有主/回收无主） |
| [local_api验证] judge 机械闸⑤ meta_verification_gap 对无 UI smoke 任务死锁，需显式声明验证方式 | INV-2（本合同 `## E2E 验收` 显式声明验证方式 = vitest 纯函数单测 + 真 PG integration + psql 列断言；无 UI smoke） |
| [台账不入库] `.harness/progress.md` 必须在 git 追踪外 | INV-3（N/A：本 sprint 不产出 `.harness/progress.md`；提交仅限 dispatcher.js / harness-skill-relay.js / kernel-run-store.js 及测试文件，git add 白名单不含 `.harness/`） |
| [exit语义实跑] 验证命令必须实跑确认 exit code；vitest 对 include 范围外路径绿态也退出 0 | INV-4（DoD 每条 [BEHAVIOR] Test 命令用 `grep -E "Tests .* [0-9]+ passed"` + `! grep failed` 双闸，捕获 0-match 假绿；见下方「exit 语义防假绿」范式） |

**源②：累积 FR 摘要（context-manifest T3 端点）**：PRD journey_id=none，无 journey 点火，端点不适用 → `context-manifest: N/A (journey_id=none)`。

**源③：回归测试约束**：见上「已知约束」段。

## 案卷 closure 声明

propose_round = 1，`inputs.case_file` 为空 → 无上一轮 blocker 需 closure，跳过（本轮 `case_file.blockers=[]`）。

## MAP 影响半径

MAP scope=`cecelia`、repo=`perfectuser21/cecelia`（已配置），但 task.payload.expected_files 为空 →
radius 无法计算 → `affected_business_nodes=[]`、`must_run_assertions=[]`。无额外 must-run 回归约束注入。
（非 `[MAP_NOT_CONFIGURED]`：scope/repo 已配，仅 expected_files 空。）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺做什么 | ①dispatcher 组包 journey-only generator-fix 不再抛 GP_CONTRACT_IDENTITY_INVALID / TASK_BUNDLE_ASSEMBLY_FAILED；②legacy relay 四分支建 initiative_runs 落库即带非空 controller_session_id + controller_lease_expires_at（未来 lease）。 |
| **NFR（做得多好）** | 性能/可靠性/并发 | orchestrator_version='v2' active run 必须携带可续租 ownership；relay run 必须活过一个 reconcile 巡检周期（~5min，默认 lease 1800s）。 |
| **Invariant（永不违反）** | 不变量 | [终态权归一] 两代运行时不得争夺终态权；无主 run 仍必须被回收（回收能力不削弱）；部分 GP 身份继续 fail-closed。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方判定点登记表。 |
| **保质期（何时过期）** | 能力/数据何时失效 | controller lease 默认 1800s 到期；由既有 controller 心跳/watchdog 续租（本单不新造续租器）。 |
| **死亡告警（停了谁知道）** | 停摆谁知道 | reconcileOwnerlessKernelRuns 每巡检周期扫描；无主/过期 run finalize failed 并落结构化 failure_reason（`ownerless_kernel_run_recovered:no_controller_ownership` vs `:controller_lease_expired`），既有恢复流程重派。 |
| **失败语义（挂了怎么办）** | 故障放行/拦截/重试 | 见下方失败语义声明。fail-closed：ownership 写入失败即建 run 失败（不产半态无主 run）。 |
| **效果确认（已发≠已生效）** | 回执确认 | 建 run 后以真 PG SELECT 确认两列非空 + lease 未来；relay 活过巡检周期以真 reconcile 后 phase 仍非终态确认。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ relay run 是否"无主"（该不该终态化） | A. controller_session_id 为空或 lease 过期即无主; B. 探活容器进程 | A（既有 isOwnerlessRun 纯谓词，不改判据） | 生产证据：lease 是唯一持久化可续租凭据；容器探活跨节点不可靠（#3848） | ⚠️ 误判"有主为无主"→ 误杀活 relay（本单正修的 P0）；误判"无主为有主"→ 真无主 run 逃逸不回收。二者皆面客严重，故 B-04/B-05（不误杀有主）与 B-06（正常回收无主）双向锁死。 |
| journey-only 任务是否"带 GP 合同" | A. 任意 GP 相关字段（含通用 journey_id）非空即触发; B. 仅版本化 GP 身份字段（gp_contract_id/version/hash/golden_path_id/step_id）非空才触发 | B | journey_id 是通用路径标识，非版本化 GP 合同身份；A 会把 journey-only 误判为不完整合同（本单正修的 P0） | 误判 journey-only 为"部分 GP 身份"→ fail-closed 抛错阻断 generator-fix 派发。B-01/B-02 双向锁死（journey-only 不抛；部分身份仍抛）。 |

（⚠️ 行为「升拍板点」级：误判后果面客严重。判据本身沿用既有 `isOwnerlessRun` 纯谓词与 PRD 边界，PrepPRD 已拍板，无需再请示 → 不加 `judgment-pending-user`。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| ownership 写入失败（创建事务内） | 建 run 失败，不产半态无主 run（fail-closed，与 createKernelRun 现语义一致） | 是（既有 active_run_guard / advisory lock 去重） | 上抛 spawn 失败 → task 回滚 queued，下一 tick 续派 |
| relay 容器真死 / lease 真过期 | reconcile 正常 finalize failed + 结构化 failure_reason | 是（幂等，二次纯谓词确认） | 既有恢复流程重派（本单不改） |
| 部分 GP 身份（缺 version/hash） | 抛 GP_CONTRACT_IDENTITY_INVALID（fail-closed，行为不变） | N/A | preAttemptAssemblyFault 上报 |

### 输入对抗面（对外暴露 agent）

N/A — 本 sprint 无对外暴露 agent/webhook 输入面。dispatcher 组包读的是 Brain 自身派发的 task.payload（内部可信来源，非外部用户可写），relay 建 run 读的是内部 task 行。无 prompt injection / 越权指令面。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

（当前仓库 `perfectuser21/cecelia` 根目录无 `product-map/generated/product-map.json`，本段整体跳过，不阻塞。）

## 真实调用方请求 shape

N/A — 本单无"设备/外部 agent 调服务端"接缝。刀一的"调用方"是 Brain 自身 CI-fail 后的 `spawn:generator-fix` 内部派发（读 task.payload，非外部 header/body 双路径）；刀二的"调用方"是 Brain tick 内部拉起 relay。两者均为进程内内部调用，无生产外部调用方 shape 需对齐。

## 未覆盖真实链路清单

- session 分支 ownership 落库 + reconcile 交互：**真 PG 覆盖**（`relay-ownership.pg.integration.test.js` 真 spawnSkillRelaySession + 真 testPool，见禁 mock 边清单），非 mock。
- grok fallback / xian / headed 三分支的 ownership 落库：本轮 Red 种子只真 PG 驱动 session 分支（生产事故实证路径 = session relay run 59a41559）。generator 必须扩展覆盖另三分支的 ownership（首选真 PG 驱动各分支到其 INSERT；次选断言各分支委托同一带 ownership 的创建函数 / createKernelRun 且传入非空 controllerSessionId）。**登记为待补真验位**：三分支若以 fake pool 仅验 SQL-shape，controller 需将此呈现进 PR 描述；DoD B-03 要求四分支全覆盖，evaluator 核四分支非空 ownership。
- 无第三方 API 依赖 → 规则 B（第三方真调）N/A。

## 禁 mock 边清单

本单改动涉及【状态机（run 终态判定）+ 生命周期钩子（建 run 创建事务）+ 跨模块数据传递（relay→创建函数→DB）+ DB 写路径（initiative_runs 新写两列）】，failing test 必须真 PG 真相邻模块：

- 代码 ↔ `initiative_runs.controller_session_id` / `controller_lease_expires_at`（本单新增写这两列）：真 testPool 连真 PG，禁 mock `pool.query` 顶替 INSERT/SELECT。
- `harness-skill-relay` 建 run 分支 ↔ 创建事务 ↔ `initiative_runs`：真 `spawnSkillRelaySession` + 真 pool，只替身与"落库带 ownership"这条边无关的最外层依赖（docker ps `execFn` / `spawnFn` / worktree `ensureWt` / `loadSkill` / `tokenFn` / 账号 `resolveAccountFn`）。
- `reconcileOwnerlessKernelRuns` ↔ `initiative_runs`（状态机终态判定 + DB 读写）：真 PG，禁 mock。
- 纯函数例外：dispatcher `gpContractIdentity`（经 `__test__.buildInputs`）无 DB/接缝边，纯函数真调，无需真 PG。

集成测试放 `src/__tests__/integration/`（`*.pg.integration.test.js`），登记进 `vitest.config.js` `POSTGRES_INTEGRATION_TESTS`，由 CI brain-integration job（`vitest.integration.config.js` + 真 PG service）执行。

## Golden Path

**锚定父路声明**：独立小路（无父路）。

[CI fail 触发修复 / relay 拉起] → [组包与建 run] → [派发成功且 run 活过巡检周期]

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

### Step 2: legacy relay 四分支建 run 落库即带可续租 Controller ownership（刀二）

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 「范围限定/在范围内」第 2 项（四处直写 INSERT 收敛为带 controller ownership 的创建）。

**可观测行为**: legacy one-session relay（session / grok fallback / xian / headed）创建 `initiative_runs` 时，在同一创建事务写非空 `controller_session_id` + 未来 `controller_lease_expires_at`（复用 `createKernelRun` 或等价单一创建函数）。真 PG 查该 v2 run，两列均非空、lease 在未来。

**验证命令**:
```bash
cd packages/brain
OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js --reporter=dot 2>&1)
echo "$OUT" | grep -E "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"
# 期望：真 PG 建 run 后 controller_session_id / controller_lease_expires_at 均非空
```

**硬阈值**: 建 run 后 `controller_session_id IS NOT NULL` 且 `controller_lease_expires_at > NOW()`；四分支（session/grok fallback/xian/headed）均满足。

---

### Step 3: relay 活过一个巡检周期不被误杀，且无主 run 仍正常回收（刀二出口）

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 + 「E2E 验收」占位第 4/5 点 + 「边界情况」第 4 条（真死/真过期仍回收）。

**可观测行为**: 带有效 lease 的活 relay run，经 `reconcileOwnerlessKernelRuns`（now 推进 >5min 但 lease 仍有效）后仍为非终态（未被 `no_controller_ownership` 终态化）；对照：无 ownership 的 v2 active run 经同一 reconcile 仍被 finalize failed（回收能力未削弱）。

**验证命令**:
```bash
cd packages/brain
# 与 Step 2 同一集成文件覆盖（用例②活过巡检 + 用例③对照回收）
OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js --reporter=verbose 2>&1)
echo "$OUT" | grep -qE "活过一个巡检周期" && echo "$OUT" | grep -qE "无 ownership.*仍被终态化|回收能力未削弱"
echo "$OUT" | grep -E "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"
```

**硬阈值**: 有主 run 6min 后 phase ∉ {done,failed}；无主对照 run reconcile 后 phase = failed 且 cause = `no_controller_ownership`。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 说明：本 sprint 无 HTTP app / 无 UI smoke，验证方式=纯函数单测（刀一）+ 真 PG integration（刀二）+ psql 列断言。
> Fleet 注入 attempt 级 `DB_URL`；本脚本由其派生 DB_HOST/PORT/USER/PASSWORD/NAME 供仓库既有隔离 DB 测试框架使用
> （集成测试自建隔离库 + 真跑 `src/migrate.js` 至最新迁移，controller ownership 列由既有迁移落库；不复制生产数据、无业务身份需登录自举）。
> 身份 late-binding：本测试 run 的 `controller_session_id` 由运行时 `randomUUID()` 生成，无 attempt_id/UUID 字面值固化为验收身份（无 HARNESS_* 需注入的执行角色断言）。

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

# 2. 空库真跑仓库迁移，机检 controller ownership 列存在（防"列缺失"假通过）
node src/migrate.js
PSQL="psql \"$DB_URL\""
COLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')")
[ "$COLS" = "2" ] || { echo "FAIL: initiative_runs 缺 controller ownership 列 (found=$COLS)"; exit 1; }

# 3. 刀一：纯函数单测（journey-only 不抛 / 部分身份仍抛 / 完整身份透传）
OUT1=$(NODE_ENV=test npx vitest run src/__tests__/dispatcher-gp-contract-identity.test.js --reporter=dot 2>&1) || true
echo "$OUT1" | tail -5
echo "$OUT1" | grep -qE "Tests .* [0-9]+ passed" || { echo "FAIL: 刀一单测未运行(0-match 假绿防护)"; exit 1; }
echo "$OUT1" | grep -qE "Tests .* [0-9]+ failed" && { echo "FAIL: 刀一单测有失败"; exit 1; } || true

# 4. 刀二：真 PG integration（四分支 ownership + 活过巡检 + 对照回收）
OUT2=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js --reporter=verbose 2>&1) || true
echo "$OUT2" | tail -15
echo "$OUT2" | grep -qE "Tests .* [0-9]+ passed" || { echo "FAIL: 刀二集成未运行(0-match 假绿防护)"; exit 1; }
echo "$OUT2" | grep -qE "Tests .* [0-9]+ failed" && { echo "FAIL: 刀二集成有失败"; exit 1; } || true

echo "✅ Golden Path 验证通过（刀一纯函数 + 刀二真 PG）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `spawn:generator-fix` 的 payload 里 `gp_contract_id` 为非 UUID 垃圾串 / `gp_contract_version` 为 0 或负 / `gp_contract_hash` 长度非 64 → 必须仍 fail-closed 抛 GP_CONTRACT_IDENTITY_INVALID（不得因剔除 journey_id 而放松部分身份校验）。
- 重复提交: 同一 task 连续两次 spawnSkillRelaySession → active_run_guard / advisory lock 必须仍去重，不产生第二条无 ownership 的 run。
- 中途中断: relay 建 run 后 lease 未过期时 controller 进程假死 → reconcile 不应在 lease 内回收（B-05 语义）；lease 过期后必须回收（cause=controller_lease_expired，与 no_controller_ownership 可区分）。
- 边界值: lease 恰好等于 now（边界）→ isOwnerlessRun 用 `<` 严格比较，等于不算过期，确认不误杀。
发现分级: P0/P1（误杀活 relay / 真无主逃逸 / journey-only 再被阻断）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 刀一 gpContractIdentity 触发谓词 | `packages/brain/src/__tests__/dispatcher-gp-contract-identity.test.js` | `journey-only payload 不触发 GP 校验`、`部分 GP 身份`、`完整版本化 GP 身份继续透传 frozen contract` | 未修前 journey-only 用例 FAIL（抛 GP_CONTRACT_IDENTITY_INVALID）→ 1 failed \| 2 passed（已实测） |
| 刀二 relay ownership + reconcile | `packages/brain/src/__tests__/integration/relay-ownership.pg.integration.test.js` | `session 分支建 run 落库即带非空 controller_session_id + 未来 lease`、`活过一个巡检周期`、`无 ownership 的 v2 active run 经 reconcile 仍被终态化` | 未修前两列 NULL → 用例①②FAIL（Red by construction；真 PG 执行） |
