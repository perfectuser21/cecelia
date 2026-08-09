# Sprint Contract Draft (Round 2) — kernel 真读 gear：三档在 orchestrator 状态机内分流

**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 覆盖父路 e6f803f2（工厂·F1 开发闭环）· 步1「接单进车间即分档」(3bf6c116) 第 3-4 步

gate 提示：`contract-gate: applied (packages/brain/src/lib/contract-gate.js exists, cecelia worktree)`
`gp-anchor: skipped (product-map.json not found)`

---

## Response Schema（推导来源: PRD 字面）

**N/A — 任务无 HTTP 响应**。本 sprint 是纯 kernel 内部改动（`orchestrator/derive.js` 纯函数状态机分叉 + `initiative_runs` 新增列 + 读入 run context），不新增/不修改任何 HTTP 端点。可观测出口是 `harness_attempts`（角色分布）+ `initiative_runs.gear`（持久化列），全部经 psql 验证。Reviewer 第 6 维 schema oracle 部分按「无 HTTP 响应」处理。

---

## ⚠️ PRD 事实校正（Proposer 翻译必读，Reviewer 请核）

PRD 验收断言写「查 `initiative_attempts`」——**该表在本仓不存在**（`grep -rn initiative_attempts packages/brain` = 0 命中，非视图非表）。角色记录的真实表是 `harness_attempts`（migration 357，列 `role CHECK IN ('planner','proposer','reviewer','generator','evaluator','judge','reporter')`，`run_id` 外键指向 `initiative_runs`）。本合同所有角色分布断言一律落到 **`harness_attempts JOIN initiative_runs ON run_id`**。这是 What→How 翻译的忠实化，不是改字段名（PRD 无 Response Schema key 受此影响）。

---

## Golden Path

[Brain 派发带 `payload.gear` 的 harness_initiative] → [harness-skill-relay 建 run 时 `deriveGear(task)` 读档并持久化 `initiative_runs.gear`] → [collectGroundTruth 每跳把 `run.gear` 注入 `observed.gear`] → [derive 状态机按 gear 分叉] → [harness_attempts 角色分布可 psql 验证]

### Step 1: Brain 派发带 gear 的 harness_initiative，relay 建 run 时读档并持久化
**来源**: `[FROM_PRD]` — PRD「必须实现 1」+ Golden Path 第 2 步（`run.js`/relay 从 task.payload 读 gear，复用 `deriveGear`，持久化到 `initiative_runs` 新增 `gear` 列）

**可观测行为**: `harness-skill-relay.js` 建 run 时调用既有 `deriveGear(task)`（`GEAR_VALUES=['default','hotfix','segmented']`，缺省/undefined/null→'default'，非法值 throw），把结果作为 `gear` 传入 `createKernelRun`；`kernel-run-store.createKernelRun` 的 INSERT 增写 `gear` 列。gear 缺省时列写 NULL（= default 语义），存量行零回填、零变化。

**验证命令**:
```bash
# 迁移后 initiative_runs 有 gear 列；createKernelRun 传 gear='hotfix' 后可查回
psql "$DB_URL" -tAc "SELECT gear FROM initiative_runs WHERE id='$RUN_ID'"
# 期望：hotfix
```
**硬阈值**: `initiative_runs.gear` 列存在且 createKernelRun 传入值可无损查回；缺省写 NULL。
验证命令：`psql "$DB_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='gear'" | grep -qx gear`

---

### Step 2: collectGroundTruth 把持久化的 gear 注入 observed.gear
**来源**: `[FROM_PRD]` — PRD 假设 2（gear 由 run context 一次读入后透传给 derive 的 observed，而非 derive 每轮重查 DB）

**可观测行为**: `ground-truth.js` 已每跳 `SELECT * FROM initiative_runs`；新增 `observed.gear = run.gear ?? 'default'`，作为 derive 的输入。gear 是 observed 的**可选**字段（缺省 'default'），不进 `assertObservedShape` 的 REQUIRED_FIELDS——否则 100+ 存量 derive 用例全炸（零回归红线）。

**验证命令**:
```bash
# 集成测试断言：seed 一个 gear='hotfix' 的 run，collectGroundTruth 返回 observed.gear==='hotfix'
DATABASE_URL="$DB_URL" npx vitest run packages/brain/src/__tests__/integration/kernel-gear-dispatch.pg.integration.test.js -t 'observed.gear' 2>&1 | grep -qE '([1-9][0-9]* passed|passed \([1-9])'
```
**硬阈值**: `observed.gear` 等于 `initiative_runs.gear` 持久化值；列为 NULL 时 observed.gear==='default'。

---

### Step 3: derive 状态机按 gear 分叉（核心）
**来源**: `[FROM_PRD]` — PRD「必须实现 2」+ Golden Path 第 3 步（决策 1b677ae3 原文）

**可观测行为**: `derive(observed)` 在既有 gear 无关守卫（terminal / merged / human-review-reject / callbackRoute / contextRetry / noProgress / inflight）**之后**、planning 门（`if (!prdExists)`）**之前**插入 gear 分叉：
- `gear='hotfix'`：初始态（`prdExists=false` 且 `contract.approved=false`）**不再** `spawn:planner`，直接 `applyHopFence(deriveTask(observed), counters)` → `{phase:'generate', action:'spawn:generator'}`（免 planner/GAN，保留 generator→evaluator→judge）。
- `gear='segmented'`：**照跑 planner**（`spawn:planner`），与 default 路由等价（controller segmented 定义 = planner→proposer 多段 task-plan；kernel 主线无多段执行原语，本 sprint 只保证 gear 被读入并可分叉判定，段循环细节留待独立交付，见「接缝清单」+「未覆盖真实链路清单」）。
- `gear='default'` 或缺省：**现有代码一字不改**（新增分支对 default 是 no-op，逐字节等价）。
- `gear` ∈ 非枚举值（如 `turbo`）：`{phase:'failed', action:'mark_failed', reason:'invalid_gear'}`（kernel 侧 fail-closed，对齐 executor.js:3097 的 `invalid_gear` terminal failed）。

**验证命令**:
```bash
# derive 纯函数真验（无 mock、无替身、无 DB）——被改的边直接喂 observed 断言
npx vitest run packages/brain/src/orchestrator/__tests__/derive.test.js -t 'gear' 2>&1 | grep -qE 'Test Files.*passed' && npx vitest run packages/brain/src/orchestrator/__tests__/derive.test.js -t 'gear' 2>&1 | grep -q 'failed' && exit 1 || true
```
**硬阈值**: derive(hotfix,初始态).action==='spawn:generator'（≠spawn:planner）；derive(default,初始态).action==='spawn:planner'；derive(segmented,初始态).action==='spawn:planner'；derive(turbo).action==='mark_failed' 且 reason==='invalid_gear'。
验证命令：`npx vitest run packages/brain/src/orchestrator/__tests__/derive.test.js -t 'gear' 2>&1 | grep -qE 'Tests +[0-9]+ passed' && ! (npx vitest run packages/brain/src/orchestrator/__tests__/derive.test.js -t 'gear' 2>&1 | grep -q ' failed')`

---

### Step 4: 可观测出口 — harness_attempts 角色分布（hotfix 无 planner/proposer/reviewer，有 generator）
**来源**: `[FROM_PRD]` — PRD 验收断言 1/2 + Golden Path 第 5 步

**可观测行为**: hotfix run 的第一次派发（derive 首跳）产出 `spawn:generator` → dispatcher 按既有 `SPAWN_ROLE_BY_ACTION` 建 `role='generator'` 的 harness_attempts 行，且全程不会出现 planner/proposer/reviewer 角色；default run 首跳产出 `spawn:planner` → `role='planner'` 行。

集成测试用**真 Postgres + 真 collectGroundTruth + 真 derive + 真 attemptStore**驱动 `runLoop` 一跳，仅把最外层 dispatch/launcher（容器执行）替身为记录型 fake（合法外层边界），使 hotfix/default 各产出真实 harness_attempts 行，供 psql 断言。

**验证命令**:
```bash
# hotfix run：planner/proposer/reviewer 记录数 = 0 且 generator >= 1（时间窗防历史数据冒充）
psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts a JOIN initiative_runs r ON r.id=a.run_id WHERE r.gear='hotfix' AND a.role IN ('planner','proposer','reviewer') AND a.created_at > NOW() - interval '10 minutes'"
# 期望：0
psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts a JOIN initiative_runs r ON r.id=a.run_id WHERE r.gear='hotfix' AND a.role='generator' AND a.created_at > NOW() - interval '10 minutes'"
# 期望：>= 1
```
**硬阈值**: hotfix run 下 `role IN ('planner','proposer','reviewer')` 计数 = 0 且 `role='generator'` 计数 ≥ 1（均带 `created_at > NOW() - interval '10 minutes'` 时间窗）。

---

## 接缝清单（碰真实世界的点 — 逐条写明真目标验证方式）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 状态 |
|---|---|---|---|---|
| 1 | 代码 ↔ `initiative_runs.gear` 列（DB 写路径，本单新增） | createKernelRun INSERT / collectGroundTruth SELECT | 真 Postgres 集成测试 round-trip（`kernel-gear-dispatch.pg.integration.test.js`，进 POSTGRES_INTEGRATION_TESTS，brain-integration job 起真 PG 跑） | done（真 PG 验） |
| 2 | collectGroundTruth(run 行) ↔ derive.observed.gear（跨模块传递） | 每跳现查 run 行注入 observed | 真 PG 集成测试断言 observed.gear === 持久化值 | done（真 PG 验） |
| 3 | derive 首跳 action → harness_attempts.role（角色分布出口） | 一跳 runLoop 真派发（launcher 记录型替身） | 真 PG 一跳驱动 + psql 断言 hotfix 首角色=generator、无 planner | done（真 PG 验，hotfix 侧） |
| 4 | default run 全程 planner/proposer/reviewer 三者 ≥ 1 | 完整 GAN→generate 多跳真实全流程 | **非 shell 可跑**（需真 6 角色 fleet 跑到 merge）；由「零回归」保证——default 分支逐字节等价，现网近 30 天 192 条 default run 已产出三角色 | `logic-done-pending`（见未覆盖清单） |
| 5 | segmented 段循环（N 段串行点绿） | kernel 多段执行原语 | 本 sprint 不落地（PRD 假设 3 + 范围限定：仅保证 gear 读入 + 分叉判定，段循环独立交付） | `logic-done-pending`（见未覆盖清单） |

**禁止写死环境假设值**：本 sprint 无坐标/阈值/env 假设值——gear 全从 task.payload 推导（deriveGear），run context 从 DB 现查，无硬编码。

---

## 禁 mock 边清单

本单改动触及【状态机（derive）】+【跨模块数据传递（run 行→observed.gear）】+【DB 写路径（initiative_runs.gear）】三类，failing test 必须不 mock 被改的这些边：

- **derive 状态机（本单改 gear 分叉）** — derive 测试直接喂 observed 断言返回值，禁止 mock/stub derive 或其内部 gates；纯函数真验。
- **代码 ↔ `initiative_runs.gear` 列（本单新增 DB 写路径）** — 持久化/读取测试必须真 Postgres（`pool` 真连），禁止 mock pool.query 顶替 INSERT/SELECT；测试放 `src/__tests__/integration/*.pg.integration.test.js` 并登记进 `vitest.config.js` 的 POSTGRES_INTEGRATION_TESTS，由 brain-integration job 起真 PG 跑。
- **collectGroundTruth(run 行) ↔ derive.observed.gear（本单新增跨模块传递）** — 一跳驱动集成测试用真 collectGroundTruth + 真 derive + 真 attemptStore + 真 PG；**只允许**替身最外层 dispatch/launcher（Docker 容器执行 = 更外层无关依赖）。

（无纯 UI/纯文档豁免——本单是接缝层改动，清单非空。）

---

## 已知约束（来自回归测试 + 累积 FR）

- [`packages/brain/src/orchestrator/__tests__/derive.test.js`] → derive 纯函数全分支测试（terminal/merged/callback/GAN/verdict-chain），本 sprint 新增 gear 分叉必须与既有全部分支共存，不改既有断言（零回归执法处）。
- [`packages/brain/src/harness-skill-relay.js`] → 既有 `deriveGear`/`GEAR_VALUES`（default/hotfix/segmented，非法值 throw）+ `harness-skill-relay.test.js` 对 createKernelRun 入参的断言（新增 gear 入参不得破坏既有断言）。
- [`packages/brain/src/__tests__/integration/kernel-run-store.pg.integration.test.js`] → createKernelRun/finalize 的真 PG round-trip 模型（新增 gear 列测试照此模式写）。
- [`executor.js:3090-3101`] → 既有 drive-time invalid_gear terminal failed 形态（kernel 侧 derive fail-closed 与之语义对齐）。
- `[累积FR]` context-manifest: unavailable（本执行体 postgres:false 且 Brain 未起，端点不可达，按硬规则记一行不静默跳过）。
- `[累积FR]` 本 line 暂无 done/working 状态的已验收 ability 历史（PRD 累积 FR 段声明）。

---

## 历史约束三源加载（铁律 → INV 映射）

| 铁律来源 | 映射条目 |
|---|---|
| [零回归] gear=default 分支不得改变现行 derive 输出（决策 1b677ae3） | `INV-1`（见 contract-dod.md，B-03/B-04 覆盖） |
| [fail-closed] 非法 gear 在 kernel 侧不得静默放行须 terminal failed（决策 e8f6134f） | `INV-2`（见 contract-dod.md，B-06 覆盖） |
| [确定性] derive 分叉禁 Date.now/Math.random/new Date，缺字段 fail-fast | `INV-3`（derive 既有纪律；gear 分叉纯 switch，无时间/随机源） |

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | gear 从 payload 读入 kernel run context + 持久化 initiative_runs.gear；derive 按 hotfix/segmented/default 三档分叉；非法 gear kernel 侧 fail-closed |
| **NFR（做得多好）** | 非功能 | 零回归：default 逐字节等价；确定性：分叉纯 switch 无时间/随机源；超时/延迟 PrepPRD 未指定（N/A） |
| **Invariant（永不违反）** | 不变量 | INV-1 default 输出不变；INV-2 非法 gear terminal failed 不静默降级；INV-3 derive 确定性 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | （本任务无接缝判定点，N/A——gear 是 Brain 内部结构化字段，非外部真实状态推断；deriveGear 是确定性纯函数） |
| **保质期（何时过期）** | 何时失效 | N/A（gear 分档逻辑随 harness 档位定义演进，无 token/数据过期概念） |
| **死亡告警（停了谁知道）** | 停摆谁知道 | derive fork 若误伤 default → brain-unit CI 的 derive.test.js 100+ 用例立即红；gear 持久化失效 → brain-integration job 红 |
| **失败语义（挂了怎么办）** | 故障策略 | 非法 gear → terminal failed（拦截，不放行，无重试）；gear 列读失败/NULL → 降级 default（安全默认，行为等同现行）；migration 失败 → run 无法建（fail-closed 于建 run 前） |
| **效果确认（已发≠已生效）** | 回执 | gear 持久化：psql SELECT 查回列值；分叉生效：harness_attempts 角色分布 psql 断言（时间窗）+ derive 纯函数断言 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |

> 本任务无接缝判定点，N/A（gear 分档全由结构化 payload 字段 + 确定性 deriveGear 决定，不推断任何外部真实状态）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 非法 gear（不在 GEAR_VALUES） | derive → mark_failed reason=invalid_gear；kernel 侧 terminal failed | 否（终局，非法输入不重试） | 无降级（fail-closed，对齐 executor.js:3097） |
| gear 列为 NULL / 缺省 | 按 default 语义处理 | 是（幂等） | 降级 default，行为与现行逐字节等价 |
| initiative_runs 无 gear 列（迁移未跑） | createKernelRun INSERT 报错，run 建不出 | 是 | fail-closed 于建 run 前，不产生半态 run |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | — | — | — |

> 本任务非对外暴露 agent：gear 来自 Brain 内部派发的 task.payload（可信内部通道），且经 GEAR_VALUES 白名单枚举校验（非法值 fail-closed），N/A。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| derive gear 分叉（纯函数） | `packages/brain/src/orchestrator/__tests__/derive.test.js`（新增 gear describe 块；本 sprint 的 `tests/derive-gear.test.js` 为 TDD Red 证据副本） | `不等于 spawn:planner`、`返回 spawn:planner`、`mark_failed reason=invalid_gear` | → 3 failed（hotfix→generator / hotfix 无三角色 / turbo→mark_failed），3 passed（default/undefined/segmented 零回归守卫） |
| gear 持久化 + observed 注入 + 一跳角色分布 | `packages/brain/src/__tests__/integration/kernel-gear-dispatch.pg.integration.test.js`（新增，进 POSTGRES_INTEGRATION_TESTS） | `gear 列可 round-trip`、`observed.gear 等于持久化值`、`hotfix 首角色 generator 无 planner` | → 真 PG job 红（列不存在 / observed.gear undefined / derive 首跳仍 planner） |

> 「BEHAVIOR 覆盖」列每个覆盖名都是对应 `it()` 名的字面子串（下游字符串匹配用）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
cd "$REPO_ROOT"

echo "== 1. 空库跑仓库真实迁移（migrate.js 按文件名序执行至 395），机检 gear 列落库 =="
# db-config.js 的 DB_DEFAULTS 只读离散 DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD,不读 DATABASE_URL;
# 故先把 Fleet 注入的连接串 DB_URL 解析成离散 DB_* 变量,再按 CI 既有跑法 (cd packages/brain and node src/migrate.js) 执行,
# 避免连回默认库 localhost/cecelia。用 node 解析 + shell 安全单引号写入可 source 的 env 文件,规避手写正则的引号地狱。
cat > /tmp/harness-dburl-parse.mjs <<'PARSE_EOF'
import fs from 'fs';
const raw = process.env.DB_URL;
if (!raw) { console.error('DB_URL 未注入'); process.exit(1); }
const u = new URL(raw);
const sq = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
const out = [
  'export DB_HOST=' + sq(u.hostname),
  'export DB_PORT=' + sq(u.port || '5432'),
  'export DB_NAME=' + sq(decodeURIComponent(u.pathname.replace(/^\//, ''))),
  'export DB_USER=' + sq(decodeURIComponent(u.username)),
  'export DB_PASSWORD=' + sq(decodeURIComponent(u.password)),
].join('\n') + '\n';
fs.writeFileSync('/tmp/harness-dbenv.sh', out);
PARSE_EOF
node /tmp/harness-dburl-parse.mjs || { echo "FAIL: 解析 DB_URL 为离散 DB_* 变量失败"; exit 1; }
. /tmp/harness-dbenv.sh
( cd packages/brain && node src/migrate.js ) >/tmp/harness-migrate.log 2>&1 \
  || { echo "FAIL: migrate 失败"; tail -30 /tmp/harness-migrate.log; exit 1; }
psql "$DB_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='gear'" | grep -qx gear \
  || { echo "FAIL: initiative_runs.gear 列不存在（迁移 395 未生效）"; exit 1; }
echo "OK: initiative_runs.gear 列存在"

echo "== 2. derive gear 三档分叉纯函数真验（无 mock/无替身/无 DB）=="
npx vitest run packages/brain/src/orchestrator/__tests__/derive.test.js -t 'gear' --reporter=dot >/tmp/harness-derive.log 2>&1 || true
grep -qE 'Tests +[0-9]+ passed' /tmp/harness-derive.log || { echo "FAIL: derive gear 套件无通过统计"; tail -30 /tmp/harness-derive.log; exit 1; }
grep -qE '[1-9][0-9]* failed' /tmp/harness-derive.log && { echo "FAIL: derive gear 套件有失败用例"; tail -30 /tmp/harness-derive.log; exit 1; }
echo "OK: derive gear 三档分叉全过"

echo "== 3. gear 持久化 + observed 注入 + 一跳角色分布（真 PG 集成，只替身最外层 launcher）=="
npx vitest run packages/brain/src/__tests__/integration/kernel-gear-dispatch.pg.integration.test.js --reporter=dot >/tmp/harness-gearpg.log 2>&1 || true
grep -qE 'Tests +[0-9]+ passed' /tmp/harness-gearpg.log || { echo "FAIL: gear PG 集成套件无通过统计"; tail -40 /tmp/harness-gearpg.log; exit 1; }
grep -qE '[1-9][0-9]* failed' /tmp/harness-gearpg.log && { echo "FAIL: gear PG 集成套件有失败用例"; tail -40 /tmp/harness-gearpg.log; exit 1; }
echo "OK: gear PG 集成全过"

echo "== 4. psql 出口断言：hotfix run 无 planner/proposer/reviewer 且有 generator（时间窗防伪）=="
BAD=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts a JOIN initiative_runs r ON r.id=a.run_id WHERE r.gear='hotfix' AND a.role IN ('planner','proposer','reviewer') AND a.created_at > NOW() - interval '10 minutes'" | tr -d ' ')
[ "$BAD" = "0" ] || { echo "FAIL: hotfix run 出现 planner/proposer/reviewer 角色（count=$BAD）"; exit 1; }
GEN=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts a JOIN initiative_runs r ON r.id=a.run_id WHERE r.gear='hotfix' AND a.role='generator' AND a.created_at > NOW() - interval '10 minutes'" | tr -d ' ')
[ "$GEN" -ge 1 ] || { echo "FAIL: hotfix run 无 generator 角色（count=$GEN）"; exit 1; }
echo "OK: hotfix 角色分布 planner/proposer/reviewer=0 generator=$GEN"

echo "== 5. psql 零回归锚点：default run 首跳产出 planner 角色 =="
DEF=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts a JOIN initiative_runs r ON r.id=a.run_id WHERE COALESCE(r.gear,'default')='default' AND a.role='planner' AND a.created_at > NOW() - interval '10 minutes'" | tr -d ' ')
[ "$DEF" -ge 1 ] || { echo "FAIL: default run 无 planner 角色（count=$DEF，零回归破坏）"; exit 1; }
echo "OK: default run planner=$DEF（零回归保持）"

echo "✅ Golden Path 验证通过（kernel 真读 gear 三档分流）"
```

> 说明：default run 的 proposer/reviewer 三者齐全属完整 GAN 全流程，非一跳可产出，由「零回归」保证（见未覆盖真实链路清单 #4）；本脚本 default 侧只锚 planner 首角色，防止 hotfix 分叉误伤 default 的第一跳路由。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `payload.gear` 传 `"hotfix "`（带空格）/ `"HOTFIX"`（大小写）/ 数字 `1` / 空字符串 `""` —— 观察是否被 deriveGear 当合法值放行（应 throw invalid_gear，`""` 非 null 不应降级 default）
- 重复提交: 同一 task 并发建两个 run（不同 gear）—— 观察 loadActiveKernelRun 幂等是否被 gear 破坏
- 中途中断: run 建成后（gear 已持久化）改 payload.gear 再重跑 —— 观察 collectGroundTruth 读的是持久化列还是 payload（应以持久化列为准，防中途改档）
- 边界值: gear 列存量行为 NULL 时 collectGroundTruth 是否稳定降级 default（零回归边界）
发现分级: P0/P1（default 被误伤 / 非法 gear 静默放行 / 中途改档生效）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## 未覆盖真实链路清单

| 真实链路点 | 为什么未覆盖 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| default run 全程 planner+proposer+reviewer 三者 ≥ 1 | 需真 6 角色 fleet 跑到 merge，非 shell 可跑；本单 default 分支逐字节等价，风险极低 | 由零回归保证（derive.test.js default 全套 + 现网 192 条 default run 已产三角色）；如需真验，走 nightly kernel-fleet-canary-run 真跑一条 default initiative 观察 harness_attempts |
| segmented 段循环（N 段串行点绿真实执行） | PRD 假设 3 + 范围限定：kernel 主线无多段执行原语，本 sprint 仅保证 gear 读入 + 分叉判定（segmented 照跑 planner，与 default 路由等价） | 独立交付：kernel 多段执行原语落地后，proposer segmented 档 task-plan（Step 3.1）+ loop 段迭代真验；`logic-done-pending` |
| 无第三方 API / 无 force_*/stub/假数据 | 本单纯 kernel 内部逻辑 + DB 列 | （本合同无第三方真调，无 mock 豁免于被改边——被改边全真验；仅一跳集成替身最外层 launcher，属合法外层边界，已在禁 mock 边清单说明） |

---

## DevGate 提示（generator 落地前必过，改 packages/brain 强制）

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```
版本 bump：`packages/brain/package.json` semver（本改动 = feat，minor 或 patch 由 generator 定）。迁移回滚脚本放 `packages/brain/migrations/rollback/395_initiative_runs_gear.down.sql`（对齐 393 约定，不放主目录）。
