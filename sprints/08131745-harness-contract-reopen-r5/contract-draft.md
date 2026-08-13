# Sprint Contract Draft (Round 1) — Harness 合同重开后批准证据原子换版（r5）

> 锚定父路声明：独立小路（无父路）。本 sprint 是 Brain 合同状态机 bugfix，PRD `journey_id: none`/`step_id: none`，不隶属任何 Golden Path。
> gp-anchor: skipped (product-map.json not found)
> contract-gate: cecelia 仓（packages/brain/src/lib/contract-gate.js 存在），代码层 Contract Gate 生效，非跳过。
> [MAP_NOT_CONFIGURED]：task.payload 无 map_scope/map_repo，Unified Map 未配置；must_run_assertions 为空，无额外已知回归断言注入。

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应。本刀是 `packages/brain/src/orchestrator/contract-store.js` 内部函数
`materializeApprovedContract(db, {...})` 的状态机修复，无对外 HTTP 端点、无 response body。
可观测契约是 DB 行状态（`initiative_contracts.status` / `initiative_runs.contract_id`）与函数返回对象
`{ id, version, status, branch }`，全部由下方 [BEHAVIOR] 用真实 Postgres 断言。

---

## 真实调用方请求 shape

N/A — 本刀无“设备/agent 调服务端”入口。`materializeApprovedContract` 是 Kernel loop（in-process）
在 `materializeApprovedContractOrFail`（loop.js）中直接调用的库函数，调用方 shape 即函数入参
`{ runId, version, branch, prdContent, contractContent, artifacts?, approvedAt }`，与生产调用点逐字段一致
（loop.js:910/1186/1226 三处 `PERSIST_CONTRACT_APPROVAL`/`FORCE_APPROVE_CONTRACT` 均传该 shape）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——测试全程真实 Postgres，无 `force_*`/stub/假数据；被改的 DB 边零 mock。

## 禁 mock 边清单

本单改动同时命中「状态机（draft/approved/superseded 迁移与终态判定）」与「DB 写路径（initiative_contracts /
initiative_runs 的 UPDATE/INSERT）」两类，故 failing test 必须真 Postgres、真相邻表，禁 mock 被改的边：

- `materializeApprovedContract` ↔ `initiative_contracts` 表（本单改状态机分流写路径：draft 附着时新插 v2='approved'、旧 v1 置 'superseded'；测试必须真 Postgres 验落库版本与 status）
- `materializeApprovedContract` ↔ `initiative_runs` 表（本单改 `run.contract_id` 原子切换到 v2；测试必须真 Postgres 验 `contract_id = v2.id`）
- 已附着合同 status 读分支（`run.contract_id → initiative_contracts.status` 的 draft/approved 分流判定，真表读，禁 mock 该读结果）

需真 PG 的用例落在 CI 永久回归文件 `packages/brain/src/orchestrator/__tests__/contract-store.test.js` 的
`describe.runIf(HAS_REAL_POSTGRES)` 块（ci.yml `brain-integration` job 起真 Postgres 跑，见 ci.yml:830 显式点名该文件）。
本 sprint `tests/contract-reopen-atomic-swap.test.js` 是同结构的 RED 规格与移植来源。

---

## Golden Path

[reopen 后 run.contract_id 附着 v1 draft] → [Round2 批准新 SHA/branch/artifacts，识别附着为 draft] → [单事务原子：插 v2 approved + v1 置 superseded + run.contract_id 切 v2] → [run 按 v2 冻结基线，Generator 得以启动]

### Step 1: reopen 后附着 v1 draft，Round2 提交新证据触发 materializeApprovedContract
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步（第 25-26 行）+「背景」（第 11-15 行）。

**可观测行为**: `initiative_runs.contract_id` 指向一份 `status='draft'/version=1` 的 `initiative_contracts` 行；
以新 SHA/branch/artifacts（version=2）调用 `materializeApprovedContract`。

**验证命令**:
```bash
# 造数后调用（见 tests/contract-reopen-atomic-swap.test.js 第 1 例）；修复前此调用抛
# "attached approved contract evidence mismatch"（RED），修复后返回 v2 approved。
bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh 'reopen v1 draft attached'
```

**硬阈值**: 修复后该用例通过（Tests ≥1 passed 且 0 failed）；修复前该用例 FAIL（复现 mismatch）。

---

### Step 2: 单事务原子换版 —— 插 v2 approved、v1 置 superseded、run.contract_id 切 v2
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2-3 步（第 27-31 行）+「NFR 约束」原子性/可观测（第 71/74 行）。

**可观测行为**: 事务提交后 DB 中 `v2.status='approved'`、`v1.status='superseded'`、`run.contract_id = v2.id`；
函数返回 `{ version: 2, status: 'approved', branch: <新分支> }`。任一步失败整体回滚（原子性由单事务保证）。

**验证命令**:
```bash
# 用例内 psql 断言三态（v1 superseded / v2 approved / run.contract_id=v2.id）。
bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh 'reopen v1 draft attached'
```

**硬阈值**: 三态断言全过；版本数从 1（v1）增到 2（v1+v2），run.contract_id 指向 v2。

---

### Step 3: 幂等重放 —— 相同 v2 证据再调用返回同一合同，不新建版本
**来源**: `[FROM_PRD]` — PRD「幂等重放」（第 33 行）+「边界情况」第 2/4 条（第 40/42 行）+「NFR」幂等性（第 72 行）。

**可观测行为**: 以完全相同的 v2 证据（SHA/branch/content/seal 全一致）再次调用，返回 `id` 与首次相同的合同对象；
`initiative_contracts` 该 initiative 版本数不增（仍为 2），不重复 supersede。

**验证命令**:
```bash
bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh 'reopen 换版幂等'
```

**硬阈值**: 第二次返回 `id === 第一次.id`；版本 count 仍为 2。

---

### Step 4: fail-closed 保持 —— 附着 approved 合同证据不一致仍抛 mismatch
**来源**: `[FROM_PRD]` — PRD「fail-closed 保持」（第 35 行）+「边界情况」第 3 条（第 41 行）+「NFR」fail-closed 安全红线（第 73 行）。

**可观测行为**: 当附着合同**已是 approved**（非 draft），且新证据 SHA/branch/prd_content/contract_content/seal 任一不一致，
仍抛 `attached approved contract evidence mismatch`，绝不静默换版。

**验证命令**:
```bash
bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh 'fail-closed'
```

**硬阈值**: 用例断言 `rejects.toThrow(/evidence mismatch|approved_contract_immutable_mismatch/)` 通过。

---

### Step 5: 首轮无 contract_id 不回归
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：draft 分流改动可能误伤既有「run.contract_id 为 NULL 首轮插入」路径，须回归守护，防止修一处炸另一处（禁 mock 边规则要求真表验）。

**可观测行为**: `run.contract_id IS NULL` + 存在 v1 draft 时，materialize v2 仍走既有插入/supersede/attach 路径，行为不变。

**验证命令**:
```bash
bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh 'run 首轮无 contract_id'
```

**硬阈值**: 用例通过；v1 superseded、v2 approved 且 attached。

---

## 已知约束（来自回归测试 + 累积 FR）

- [contract-store.test.js] → `materializes the approved version, supersedes older versions, and attaches the run atomically`（既有：run.contract_id 为 NULL 起点的原子换版，不得回退）
- [contract-store.test.js] → `allocates a new immutable version when a rerun approves the same GAN round`（既有：approved 存在时分配不可变新版本）
- [contract-store.test.js] → `serializes concurrent approvals for one initiative onto distinct versions`（既有：并发批准串行化到不同 version，本刀不得破坏）
- [contract-status-literals.test.js] → `initiative_contracts_status_check 只允许 draft/approved/superseded`（status 合法集，draft 分流不得引入新枚举值）
- [累积FR] context-manifest: unavailable（PRD payload 无 journey_id，端点无法拉取累积 FR；PRD「累积 FR」段明示本 line 暂无历史）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | reopen 后附着 v1 draft + Round2 新证据时，`materializeApprovedContract` 在单事务内原子插 v2 approved、置 v1 superseded、切 run.contract_id 到 v2；不再把 draft 附件当同轮批准证据误抛 mismatch。 |
| **NFR（做得多好）** | 性能/可靠/并发 | 原子性（单事务，任一失败整体回滚）；幂等（相同 v2 证据重放返回同一合同、版本不增）；并发两次 Round2 批准同 run 经事务串行化只产一个 v2。 |
| **Invariant（永不违反）** | 不变量 | ①fail-closed：附着 **approved** 合同证据任一字段不一致必须抛错，禁静默换版（安全红线）。②status 只能取 draft/approved/superseded（check 约束）。③换版必须原子，禁出现 v2 已插但 v1 未 supersede 或 run 未切的中间态被提交。 |
| **判定点（怎么知道）** | 对模糊状态的判断 | 见下方登记表（附着合同是否为“同轮批准证据”）。 |
| **保质期（何时过期）** | 何时失效 | N/A —— 合同行状态由 reopen/materialize 状态机管理，无独立 TTL；superseded 为终态，本刀不新增退役逻辑。 |
| **死亡告警（停了谁知道）** | 停摆谁知道 | 复用既有：materialize 失败在 loop.js 返回 `assembly_fault`/`kernel_process_fatal`，经 Kernel 决策日志与既有 P1 告警路径可见；本刀不新增告警通道（修复的正是它误抛 fatal 的根因）。 |
| **失败语义（挂了怎么办）** | 放行还是拦截 | 见下方失败语义声明。核心：draft 附着=可原子换版（放行本轮新证据）；approved 附着+证据不一致=拦截（抛错）；事务任一步失败=整体 ROLLBACK。 |
| **效果确认（已发≠已生效）** | 回执确认 | 换版“已生效”以 DB 三态为唯一回执：`v2.status=approved` ∧ `v1.status=superseded` ∧ `run.contract_id=v2.id`，由 [BEHAVIOR] 真 Postgres 断言，不看函数是否“返回了”。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 附着合同是否为“本轮批准证据”（决定原子换版 vs 逐字段比对） | A. 按附着合同 `status`（draft=可换版 / approved=须逐字段匹配否则 fail-closed）; B. 按 version 号大小; C. 按 approved_sha 是否等于新 SHA | A. 按附着合同 `status` 分流 | PRD [ASSUMPTION]（第 60 行）已确立判据为 status；status 是合同生命周期的权威终态标记，version/sha 比大小会与 reopen 纪元语义冲突 | 误判 draft→approved：本轮新证据被拒→run 死锁（当前 bug）；误判 approved→draft：静默覆盖已批准合同→破坏 fail-closed 安全红线 |

> ⚠️ 判定点：误判后果严重（run 死锁 / 破坏 fail-closed）。该判据已由 PRD [ASSUMPTION]（第 59-60 行，产品法律）确立，非待确认——**不**标 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| 附着 approved 合同 + 证据任一字段不一致 | 抛 `attached approved contract evidence mismatch`，整体不换版 | 是（相同证据幂等命中同一合同） | 无降级——安全红线，fail-closed 拦截 |
| 换版事务中途失败（插 v2/supersede/切 run 任一炸） | 整个事务 ROLLBACK，DB 保持调用前状态 | 是（幂等键=v2 证据 SHA/branch/content/seal） | 上层 loop 收 error 走既有 assembly_fault 路径 |
| 附着合同 status 非法（非 draft/approved/superseded） | 由 check 约束在写入侧拦截（本刀不放宽枚举） | N/A | 保持既有约束不动 |

### 输入对抗面（对外暴露 agent 必填）

N/A —— 本刀是 Kernel in-process 库函数，无对外暴露 agent、无外部用户可写入接口，输入全部来自受信的 Kernel loop 决策路径。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 模式B：evaluator 在注入 attempt 级 `DB_URL` 的空库上，先跑仓库真实 migration bootstrap，机检目标表存在，
> 再用真实 Postgres 跑永久回归 CI 文件 `contract-store.test.js` 全量用例（含本刀新增的 reopen 换版 4 例），
> 全绿即 Golden Path RED→GREEN 收敛。无 HTTP app、无业务身份/tenant（纯 Brain 合同状态机），故不走 signup/login 自举。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
ROOT="$(pwd)"
# 从 DB_URL 派生离散连接变量（DB_DEFAULTS/migrate.js 只认 DB_HOST/DB_NAME/... 离散变量）。
source "$ROOT/sprints/08131745-harness-contract-reopen-r5/e2e-db-env.sh"
[ -d node_modules/pg ] || npm ci >/tmp/harness-e2e-npm.log 2>&1 || true

cd "$ROOT/packages/brain"
# 1. 空库真实 migration bootstrap（Fleet 不提供业务 schema）。
node src/migrate.js
# 2. 机检目标表在空库中已建立。
for t in initiative_contracts initiative_runs initiative_contract_artifact_seals; do
  psql "$DB_URL" -tAc "SELECT to_regclass('public.${t}') IS NOT NULL" | grep -qx t \
    || { echo "FAIL: 目标表 ${t} 不存在"; exit 1; }
done
# 3. 真实 PostgreSQL RED→GREEN：跑永久回归文件全量用例（含 reopen 换版 4 例 + 既有原子换版/并发用例）。
OUT="$(mktemp)"
npx vitest run --config vitest.integration.config.js \
  src/orchestrator/__tests__/contract-store.test.js \
  --reporter=verbose > "$OUT" 2>&1 || true
tail -n 40 "$OUT"
grep -qE 'Tests[^0-9]*[1-9][0-9]* passed' "$OUT" || { echo "FAIL: 无通过用例"; exit 1; }
if grep -qE 'Tests[^0-9]*[1-9][0-9]* failed' "$OUT"; then echo "FAIL: 存在失败用例（GREEN 未达成）"; exit 1; fi
echo "✅ Golden Path 验证通过：合同重开后 v2 原子换版（v2 approved / v1 superseded / run.contract_id 切 v2）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: 以 `version=1`（不是 2）对附着 v1 draft 调用 materialize —— 验证不会把 draft 就地“批准”成 v1 又漏建 v2（版本单调性）。
- 错输入: `branch=''` 或 `version=0`/非整数 —— 应在入参校验处即抛（`approved contract branch is required` / `invalid approved contract version`），不进事务。
- 重复提交: 连续三次以相同 v2 证据调用 —— 版本数恒为 2，run.contract_id 恒指向同一 v2（幂等稳定）。
- 中途中断: 换版事务中途注入错误（如 seal_guard 触发）后重放 —— 应 ROLLBACK 且下次重放能达成一致终态，不留半换版中间态。
- 边界值: 附着合同已是 `superseded` 时再调用 —— 明确其归入 draft 分流（可换版）还是 approved 分流（比对），避免落入未定义分支。
发现分级: P0/P1（静默覆盖已批准合同 / run 死锁 / 半换版中间态被提交）→ 阻塞 merge；P2/P3（错误信息不精确等）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| reopen 后原子换版 | `packages/brain/src/orchestrator/__tests__/contract-store.test.js`（移植自 `sprints/08131745-harness-contract-reopen-r5/tests/contract-reopen-atomic-swap.test.js`） | `reopen v1 draft attached`；`reopen 换版幂等`；`fail-closed`；`run 首轮无 contract_id` | 修复前第 1 例抛 attached approved contract evidence mismatch → FAIL |

> BEHAVIOR 覆盖名均为对应 `it()` 测试名的字面子串，供下游按字符串映射 DoD↔用例。
