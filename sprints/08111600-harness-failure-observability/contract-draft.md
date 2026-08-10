# Sprint Contract Draft (Round 2)

**Sprint**: harness 失败可观测 — terminal 必写 failure_class + 失败率计量 API
**法源**: 决策 e8f6134f-4131-4145-a893-79eb098011d9（交付物2）
**journey_type**: autonomous
**target_environment**: local_api

> 锚定父路声明：覆盖父路 e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29（工厂·F1 开发闭环·步1「接单进车间即分档」3bf6c116）— 本 sprint 为该步「加厚」，补失败观测地基，不新增业务步。

contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），走代码层 Contract Gate + skill 内置规则。
gp-anchor: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 字面 + api_registry 推导 harness/stats 命名风格）

### Endpoint: GET /api/brain/harness/failure-stats?days=N

参数：`days`（query，整数，1 ≤ N ≤ 365，默认 7）。非整数 / 越界 → 400。

**Success (HTTP 200)**:
```json
{"window_days": 7, "total_tasks": 12, "terminal_failed_count": 5, "failure_rate": 0.42, "by_class": {"watchdog_deadline": 3, "unclassified": 2}}
```
- `window_days` (number, 必填): 实际生效窗口天数（= 规范化后的 N）。来源——PRD `?days=N`。
- `total_tasks` (number, 必填): 窗口内（`created_at >= NOW() - N days`）harness 任务总数（`task_type IN ('harness_initiative','golden_path_proposal')`）。来源——PRD 假设「占该窗口 harness 任务总数之比」的分母。
- `terminal_failed_count` (number, 必填): 窗口内处于 terminal 失败态（status IN `failed`/`blocked`/`cancelled`）的 harness 任务数。来源——PRD「按 failure_class 分组计数」的总量。
- `failure_rate` (number, 必填): `terminal_failed_count / total_tasks`，`total_tasks=0` 时为 `0`；值域 `[0,1]`，保留两位小数。来源——PRD「滚动失败率」，分母口径见判定点登记表。
- `by_class` (object, 必填): `failure_class → count` 分组，键取 `COALESCE(result->>'failure_class','unclassified')`，仅统计 terminal 失败态任务；窗口内无 terminal 失败任务时为 `{}`。来源——PRD「按 failure_class 分组的计数对象（by_class）」。

**禁用字段名**（生产不得漂移成这些同义词）: `by_failure_class`、`stats`、`rate`、`classes`、`counts`、`class_counts`、`period_days`。

**Error (HTTP 400)**:
```json
{"error": "days must be an integer between 1 and 365"}
```
- `error` (string, 必填): 错误说明。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/routes/harness.js` 已有 `GET /stats`（30 天 pipeline 完成率）——failure-stats 与其并列，命名/分母口径参照它（`success_rate = done/(done+failed)`，只算终态），但本 sprint 分母按 PRD 取「窗口内 harness 任务总数」。
- [回归测试] `executor.js` 已有 `markInitiativeTerminalFailed`（当前写 `custom_props.failure_class`，非 `result`）、`runHarnessInitiativeRouter` 里的 `missing_orchestrator_flag`/`invalid_gear`/`missing_gp_anchor`/`watchdog_deadline` 分类；`dispatcher.js` 写 `payload.failure_class`（`pipeline_terminal_failure`/`missing_anchor`）与 blocked 路径 `blocked_detail`（**无 failure_class**）；`harness-relay-watchdog.js` 的 `_terminalizeRelayRun` 写 `initiative_runs.phase/failure_reason`（**不写 tasks.result**）。→ 本 sprint 统一到 `tasks.result.failure_class`。
- [累积FR] context-manifest: unavailable（本 line `e6f803f2` 暂无历史，PRD「累积 FR」段已声明「本 line 暂无历史」）。
- [Invariant 铁律] [口径三源] 指标口径类问题先查三源失真（未接线恒空 / 守卫自噬回流 / 双重计数）——failure-stats 属指标口径，DoD 用 INV-2 挡「恒空 / 双重计数」。
- [Invariant 铁律] [验证实跑] 合同验证命令必须实跑确认 exit code——本合同全部 BEHAVIOR 为真执行断言（node/curl/psql/bash），无文本自证。
- [Invariant 铁律] [证据分档] judge FAIL 先分证据不足 vs 实现缺陷——本 sprint 不触及 judge/证据链，N/A。

---

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（tasks.result 写入）+ **跨模块数据传递**（各 terminal 写入点 → 共享 helper → DB），failing test 必须真 Postgres、真相邻模块：

- 共享 helper（`markHarnessTaskTerminal`）↔ DB 表 `tasks`（本单新增/改写 result 写路径，测试必须真 Postgres 验 `result->>'failure_class'` 与 `result->>'failure_detail'` 真落库，禁 mock pool/query）。
- `executor.js` 的 `runHarnessInitiativeRouter` → `markInitiativeTerminalFailed` → helper ↔ DB 表 `tasks`（本单把该真实写入点迁到 result，测试必须真调 `runHarnessInitiativeRouter`（不 mock）驱动真实 DB 写，只许 mock 更外层无关依赖如 skill-relay spawn / okr sync）。
- failure-stats 路由 handler ↔ DB 表 `tasks`（聚合读路径，测试必须真 Postgres 查真实分组计数，禁 mock query 返回假行）。

允许 mock 的外层无关依赖：`spawnSkillRelaySession`、`syncOkrInitiativeStatus`（best-effort 副作用，与 failure_class 落库无关）。

---

## Golden Path

[任一代码路径把 harness 任务打成 terminal 失败态] → [强制经共享 helper 写 result.failure_class(枚举)+result.failure_detail] → [机械闸拦截漏写] → [GET /failure-stats 按 failure_class 计量滚动失败率]

### Step 1: 全量枚举 harness terminal 失败写入点并统一到共享 helper

**来源**: `[FROM_PRD]` — sprint-prd.md Golden Path 第1/2 步（「先枚举全量写入点再改，禁只改一两处」）。

**可观测行为**: 新增共享模块 `packages/brain/src/harness-failure-class.js`，导出受控枚举 `FAILURE_CLASSES`、规范化函数 `normalizeFailureClass(x)`、终结 helper `markHarnessTaskTerminal(dbPool, taskId, { status, failureClass, failureDetail })`。所有把 harness_initiative / golden_path_proposal 打成 terminal 失败态（`failed`/`blocked`/`cancelled`）的写入点改为经该 helper 落库，helper 把 `failure_class`（规范化枚举）+ `failure_detail`（自由文本）写入 `tasks.result`。已知写入点必须全部覆盖（不得只改一两处）：

- `packages/brain/src/executor.js` — `markInitiativeTerminalFailed`（`missing_orchestrator_flag` / `invalid_gear` / `missing_gp_anchor` / `max_fresh_starts_exceeded` / `watchdog_deadline` 等分支）。
- `packages/brain/src/orchestrator/loop.js` — `mark_failed` action 的 terminal 落库路径（含经 `attempt-store.js`/`kernel-run-store.js` 的 task 终结）。
- `packages/brain/src/dispatcher.js` — `dispatch-fail-autoblock`（status→`blocked`）、`pipeline_terminal_failure`、`missing_anchor`、`pre_flight_rejected` 终结路径。
- `packages/brain/src/harness-relay-watchdog.js` — `_terminalizeRelayRun` / `relay_deadline_exceeded` 超时/断链终结（其对应 task 终结须写 result.failure_class）。

**验证命令**:
```bash
# helper 真调真库，result.failure_class + failure_detail 真落库（用 JS 属性访问读 jsonb，避免 SQL 单引号）
node --input-type=module -e '
import { markHarnessTaskTerminal } from "./packages/brain/src/harness-failure-class.js";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DB_URL });
const id = (await pool.query("INSERT INTO tasks(task_type,title,status,payload) VALUES($1,$2,$3,$4) RETURNING id",
  ["harness_initiative","smoke-failclass-helper","in_progress","{}"])).rows[0].id;
await markHarnessTaskTerminal(pool, id, { status:"failed", failureClass:"watchdog_deadline", failureDetail:"smoke detail" });
const r = (await pool.query("SELECT status, result FROM tasks WHERE id=$1",[id])).rows[0];
await pool.query("DELETE FROM tasks WHERE id=$1",[id]); await pool.end();
if(r.status!=="failed"||r.result.failure_class!=="watchdog_deadline"||r.result.failure_detail!=="smoke detail") throw new Error("FAIL "+JSON.stringify(r));
console.log("OK helper wrote result.failure_class");'
```

**硬阈值**: `result->>'failure_class'` = 规范化枚举值、`result->>'failure_detail'` = 传入详情、status 落 terminal；exit 0。

---

### Step 2: 受控枚举 + 拒绝自由文本

**来源**: `[FROM_PRD]` — sprint-prd.md 第2步「受控枚举值，拒绝自由文本」+ 边界情况「failure_class 传入非枚举值 → 规范化到『未分类』枚举」。

**可观测行为**: `normalizeFailureClass(x)`：`x ∈ FAILURE_CLASSES` → 原值；否则（自由文本 / null / 未知）→ `'unclassified'`。`FAILURE_CLASSES` 为 `Object.freeze` 冻结数组，含现网已用分类 + 兜底 `unclassified`。helper 内部对 `failureClass` 一律先 `normalizeFailureClass`，杜绝自由文本落库当 class。

**验证命令**:
```bash
DATABASE_URL="$DB_URL" node --input-type=module -e '
import { normalizeFailureClass, FAILURE_CLASSES } from "./packages/brain/src/harness-failure-class.js";
if(!Object.isFrozen(FAILURE_CLASSES)) throw new Error("FAIL: enum not frozen");
if(normalizeFailureClass("watchdog_deadline")!=="watchdog_deadline") throw new Error("FAIL: enum member dropped");
if(normalizeFailureClass("随便一段自由文本")!=="unclassified") throw new Error("FAIL: free text not normalized");
if(normalizeFailureClass(null)!=="unclassified") throw new Error("FAIL: null not normalized");
console.log("OK enum controlled");'
```

**硬阈值**: 枚举冻结；非枚举/null → `unclassified`；exit 0。

---

### Step 3: 机械闸防回归（CI lint 扫描 terminal 写入点）

**来源**: `[FROM_PRD]` — sprint-prd.md 第2步「新增机械闸：任何『写 terminal 状态但不带 failure_class』的代码路径被拦下——CI lint 扫描写入点，纯文档约定不算数」。`[AI_ADDED]` 补充：lint 自测（故意加坏写入 → exit 1），理由：防止 lint 本身成为「永远绿」的摆设。

**可观测行为**: 新增 `packages/brain/scripts/lint/lint-terminal-failure-class.mjs`。扫描 `packages/brain/src/**/*.js` 中把 harness 任务打成 terminal 失败态的 `UPDATE tasks SET ... status = 'failed'|'blocked'|'cancelled'` 语句：语句/所在写入点未经 `markHarnessTaskTerminal` 且同语句不含 `failure_class`，同时其 WHERE/上下文命中 harness 语境（curated 写入点文件清单，或 SQL 含 `task_type` in `harness_initiative`/`golden_path_proposal` / `LIKE 'harness%'`）→ 违规 exit 1。逃生口：同段加注释 `// failure-class-lint-allow: <理由>`。

**机械闸必须进真实 gate（R1-1 修订核心）**：lint 接入**已存在且真正阻塞 merge** 的统一 `.github/workflows/ci.yml`（**不是** `brain-ci.yml`——该文件在仓库不存在，仅是 docs/CLAUDE.md 陈旧文案，新建它会得到不进 `ci-passed`/branch protection 的孤儿 workflow，退化成「跑了但不 gate」，撞 PRD『纯文档约定不算数』底线）。具体接法与既有 `registry-lint`/`lint-migration-unique-version` 并列：
1. 在 `ci.yml` 新增独立 job `lint-terminal-failure-class`，gated on `if: needs.changes.outputs.brain == 'true'`（`needs: [changes]`；mirror `brain-integration`/`brain-tests-shell` 的 brain 路径门），step 跑 `node packages/brain/scripts/lint/lint-terminal-failure-class.mjs`；并加一个 proven-to-fire 自测 step（`cat` 坏样本 fixture 注入被扫描源码 → 断言 lint exit 1 → `git checkout --` 还原），mirror `lint-migration-unique-version` 的 `Self-test (fixture cases)` step，防止 lint 变「永远绿」摆设。
2. 把 `lint-terminal-failure-class` **加进 `ci-passed` job 的 `needs:` 数组**，并在其 `Check results` step 增加 `check "lint-terminal-failure-class" "${{ needs.lint-terminal-failure-class.result }}"` 一行——`ci-passed` 是 branch protection 的 required check、也是 `auto-merge` 的前置；只有进了它的 `needs`+`check` 才真正 block merge。
3. 干净树 lint exit 0，存在裸 terminal harness 写入 exit 1。

同时生成坏样本 fixture `sprints/08111600-harness-failure-observability/fixtures/bad-terminal-write.snippet`（一段裸 terminal harness 写入），供 B-06 与 E2E 自测 `cat` 注入验 exit 1（避免 Test 行内单引号转义）。

**验证命令**:
```bash
# 干净树：lint 通过
node packages/brain/scripts/lint/lint-terminal-failure-class.mjs && echo "OK lint clean=0"
# 注入坏写入 → 必须 exit 1（下方 E2E 段有完整 setup/teardown）
```

**硬阈值**: 干净树 exit 0；存在裸 terminal harness 写入 exit 1；lint 为可执行脚本（非文档约定）。

---

### Step 4: GET /api/brain/harness/failure-stats?days=N 计量滚动失败率

**来源**: `[FROM_PRD]` — sprint-prd.md 第3步 + 边界情况「窗口内无 terminal 任务 → 200，by_class 空对象、failure_rate 0，不得 500」。

**可观测行为**: 在 `packages/brain/src/routes/harness.js` 新增路由，返回 Response Schema 定义的 200 body；`days` 非整数/越界返 400 `{error}`；窗口空 → 200 `{total_tasks:0, terminal_failed_count:0, failure_rate:0, by_class:{}}`（不 500）。

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/failure-stats?days=7")
echo "$RESP" | jq -e '.failure_rate | type == "number"' >/dev/null || { echo FAIL; exit 1; }
echo "$RESP" | jq -e '.by_class | type == "object"' >/dev/null || { echo FAIL; exit 1; }
echo "$RESP" | jq -e 'has("total_tasks") and has("terminal_failed_count") and has("window_days")' >/dev/null || { echo FAIL; exit 1; }
echo "$RESP" | jq -e 'has("period_days") | not' >/dev/null || { echo "FAIL: 禁用字段 period_days 漏网"; exit 1; }
echo OK
```

**硬阈值**: 200 + `failure_rate` number + `by_class` object；禁用字段不出现；空窗口不 500。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> Fleet 运行时资源：仅 `${DB_URL:?}`（= 当前运行 Brain 实例所用的 Postgres 连接串；本 sprint 不新增 migration，`tasks.result` 列已存在自 migration 220，无需空库 bootstrap）。E2E 打运行中的 Brain（`${BRAIN_URL:-http://localhost:5221}`）+ psql `$DB_URL`，符合 autonomous 两层验证的模式 B（curl+psql 全程真实 Brain/DB）。无业务 auth（Brain 内部端点），故不走 signup/login 自举。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL for the running Brain Postgres}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
export DATABASE_URL="$DB_URL"
CREATED_IDS=()
cleanup() {
  for tid in "${CREATED_IDS[@]:-}"; do
    [ -z "$tid" ] || psql "$DB_URL" -tAc "DELETE FROM tasks WHERE id='$tid'" >/dev/null 2>&1 || true
  done
  git checkout -- packages/brain/src/harness-failure-class.js 2>/dev/null || true
}
trap cleanup EXIT

# 0. Brain 健康
curl -sf "$BRAIN_URL/api/brain/health" | jq -e '.status == "ok" or .ok == true' >/dev/null \
  || { echo "FAIL: Brain 不健康"; exit 1; }

# 1. 制造一条 terminal failed 的 harness 任务 —— 真实驱动 executor 写入点（缺 orchestrator flag → markInitiativeTerminalFailed）
TID=$(DATABASE_URL="$DB_URL" node --input-type=module -e '
import { runHarnessInitiativeRouter } from "./packages/brain/src/executor.js";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DB_URL });
const id = (await pool.query("INSERT INTO tasks(task_type,title,status,payload) VALUES($1,$2,$3,$4) RETURNING id",
  ["harness_initiative","smoke-failclass-e2e","in_progress",JSON.stringify({})])).rows[0].id;
const task = (await pool.query("SELECT * FROM tasks WHERE id=$1",[id])).rows[0];
await runHarnessInitiativeRouter(task, { pool });   // 缺 orchestrator=skill-relay → terminal failed
await pool.end();
process.stdout.write(id);')
CREATED_IDS+=("$TID")
[ -n "$TID" ] || { echo "FAIL: 未创建 terminal 任务"; exit 1; }

# 2. psql：该任务 result.failure_class 非 null（真实写入点已迁 result）
FC=$(psql "$DB_URL" -tAc "SELECT result->>'failure_class' FROM tasks WHERE id='$TID' AND status='failed'" | tr -d ' ')
[ -n "$FC" ] && [ "$FC" != "null" ] || { echo "FAIL: result.failure_class 为空 (got=$FC)"; exit 1; }
echo "step2 OK failure_class=$FC"

# 3. curl：failure-stats?days=7 返回 200 + failure_rate 数值 + by_class 分组对象
STATS=$(curl -sf "$BRAIN_URL/api/brain/harness/failure-stats?days=7")
echo "$STATS" | jq -e '.failure_rate | type == "number"' >/dev/null || { echo "FAIL: failure_rate 非数值"; exit 1; }
echo "$STATS" | jq -e '.by_class | type == "object"' >/dev/null || { echo "FAIL: by_class 非对象"; exit 1; }
echo "$STATS" | jq -e 'has("total_tasks") and has("terminal_failed_count")' >/dev/null || { echo "FAIL: 缺计量字段"; exit 1; }
# 口径三源防线：刚造的 terminal 任务必须被计入（防「未接线恒空」）；by_class 各类求和 == terminal_failed_count（防双重计数）
echo "$STATS" | jq -e '.terminal_failed_count >= 1' >/dev/null || { echo "FAIL: 恒空 — 刚造的失败未计入"; exit 1; }
echo "$STATS" | jq -e '([.by_class[]] | add) == .terminal_failed_count' >/dev/null || { echo "FAIL: by_class 求和 != terminal_failed_count（双重计数/漏计）"; exit 1; }
echo "step3 OK stats=$STATS"

# 4. curl：days 非法 → 400 + error 字段
CODE=$(curl -s -o /tmp/fs-err.json -w "%{http_code}" "$BRAIN_URL/api/brain/harness/failure-stats?days=abc")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 days 未返 400 (got=$CODE)"; exit 1; }
jq -e '.error | type == "string"' /tmp/fs-err.json >/dev/null || { echo "FAIL: 400 body 缺 error 字段"; exit 1; }
echo "step4 OK 400 error path"

# 5. psql：本 sprint 上线后新产生（近 5 分钟）的 terminal harness 任务中 failure_class IS NULL 条数 = 0
NULLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE task_type IN ('harness_initiative','golden_path_proposal') AND status IN ('failed','blocked','cancelled') AND updated_at > NOW() - interval '5 minutes' AND result->>'failure_class' IS NULL" | tr -d ' ')
[ "$NULLS" = "0" ] || { echo "FAIL: 近 5 分钟新 terminal harness 任务有 $NULLS 条 failure_class 为 null"; exit 1; }
echo "step5 OK new-terminal null count=0"

# 6. 机械闸自测：干净树 lint exit 0；cat 坏样本 fixture 注入 → lint exit 1；git 还原
node packages/brain/scripts/lint/lint-terminal-failure-class.mjs || { echo "FAIL: 干净树 lint 非 0"; exit 1; }
cat sprints/08111600-harness-failure-observability/fixtures/bad-terminal-write.snippet >> packages/brain/src/harness-failure-class.js
if node packages/brain/scripts/lint/lint-terminal-failure-class.mjs; then
  git checkout -- packages/brain/src/harness-failure-class.js
  echo "FAIL: 注入坏 terminal 写入后 lint 仍 exit 0（机械闸失效）"; exit 1
fi
git checkout -- packages/brain/src/harness-failure-class.js
node packages/brain/scripts/lint/lint-terminal-failure-class.mjs || { echo "FAIL: 还原后 lint 非 0"; exit 1; }
echo "step6 OK mechanical gate exit1 on bad write"

echo "✅ Golden Path 验证通过"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `GET /api/brain/harness/failure-stats?days=0` / `days=-5` / `days=99999` / `days=1.5` → 必须 400，不得 500 或静默 clamp 成空口径。
- 错输入: `markHarnessTaskTerminal(pool,id,{status:'weird'})`（非 terminal status）→ helper 必须拒绝或抛错，不得把 in_progress 写成假 terminal。
- 重复提交: 同一 taskId 连续两次 `markHarnessTaskTerminal` 不同 failure_class → 幂等/后写覆盖语义须确定，不得留半写状态。
- 中途中断: failure-stats 在窗口内**只有 in_progress**（无 terminal）harness 任务时 → `failure_rate=0`、`by_class={}`、`total_tasks>0`，不得除零 500。
- 边界值: `by_class` 中出现历史 null（241 条不回填）——failure-stats 只统计窗口内，历史 null 不应污染 by_class 求和一致性。
发现分级: P0/P1（stats 恒空 / 500 / 机械闸假绿 / 自由文本落库当 class）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①所有 harness terminal 失败写入点经共享 helper 写 result.failure_class(枚举)+result.failure_detail；②机械闸 lint 拦裸写入；③GET /failure-stats 计量滚动失败率。 |
| **NFR（做得多好）** | 非功能 | version bump 三处同步（package.json + brain lock + 根 lock）；failure-stats 单查（分组聚合）响应 < 1s；lint 秒级完成。 |
| **Invariant（永不违反）** | 不变量 | terminal 失败态 harness 任务 `result.failure_class` 永不为 null（新产生）；failure_class 永远是受控枚举成员（含 unclassified），永不落自由文本；by_class 各类计数之和恒等于 terminal_failed_count（不双重计数）。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 失效 | failure_class 枚举随分类演进增补（新增成员向后兼容，删除成员需迁移）；本观测层长期有效，无 token 过期面。 |
| **死亡告警（停了谁知道）** | 告警 | failure-stats 恒空 / 机械闸失效由 CI（ci.yml 的 lint-terminal-failure-class job，纳入 ci-passed required check + 本合同回归 BEHAVIOR）在下次改动时暴露；运营侧 7 天窗口计量由后续日报消费（本 sprint 不含日报）。 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执 | 每次 terminal 写入后 `result->>'failure_class'` 可查为真实回执；helper 写库失败沿用现有 non-fatal 语义（best-effort，log warn），但**不得静默把 failure_class 丢成 null**——写 result 与写 status 在同一 UPDATE 语句原子完成。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ 滚动失败率分母口径 | A. 窗口内 harness 任务**总数**（含 in_progress）; B. 窗口内**终态**（completed+failed+blocked+cancelled）任务数 | A（窗口内 harness 任务总数） | PRD 假设明确写「占该窗口 harness 任务总数之比」；同时 body 暴露 total_tasks/terminal_failed_count 让消费者可自算 B 口径 | 分母选错 → 7 天<25% 开锁闸误判（in_progress 多时 A 偏低、B 偏高）；已标 ⚠️，PrepPRD 未拍此口径，见 notes |
| terminal 失败态集合 | A. 仅 `failed`; B. `failed`+`blocked`+`cancelled` | B | PRD 明确「terminal 状态（failed / blocked / cancelled）」三态 | 漏 blocked/cancelled → dispatch-fail-autoblock 隔离与 cancel 不计入失败率，观测漏底 |
| 非枚举 failure_class 处理 | A. 拒绝写入抛错; B. 规范化到 unclassified | B（规范化到 unclassified） | PRD 边界情况「规范化到『未分类』枚举」；抛错会让 terminal 写入失败反而留 null | 若误拒 → terminal 写入中断留 null，比 unclassified 更糟 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| helper 写库失败（DB 抖动） | 沿用现有 markInitiativeTerminalFailed non-fatal（log warn），不抛断驱动器；status 与 result 同一 UPDATE 原子，不产生「有 status 无 failure_class」半写 | 是（同 taskId 后写覆盖，UPDATE 幂等） | 下轮 tick 若任务仍非终态可重终结 |
| failure-stats 传非法 days | 返回 400 `{error}`，不查库 | 是（纯读，无副作用） | 无 |
| failure-stats 窗口空 | 返回 200 空口径（rate=0, by_class={}） | 是 | 无 |
| lint 命中裸写入 | exit 1 阻断 CI | 是（纯静态扫描） | 作者加 `failure-class-lint-allow` 留痕豁免 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 端点为 Brain 内部只读计量 API（GET /failure-stats），无对外暴露 agent、无写入型外部输入面；helper 为内部模块调用，入参来自受信 Brain 代码路径。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| helper 写 result.failure_class | `tests/harness-failure-class.test.ts` | `markHarnessTaskTerminal 写 result.failure_class 与 failure_detail`；`normalizeFailureClass 非枚举归 unclassified`；`FAILURE_CLASSES 冻结` | → 模块不存在，import 失败 N failures |
| executor 写入点迁 result | `tests/executor-terminal-result.test.ts` | `runHarnessInitiativeRouter 缺 orchestrator 写 result.failure_class` | → helper 未接入，result.failure_class 为空 |
| failure-stats 路由 | `tests/failure-stats-route.test.ts` | `failure-stats days=7 返回 failure_rate number 与 by_class object`；`failure-stats 非法 days 返回 400 error` | → 路由未注册，404 |
| 机械闸 lint | `tests/lint-terminal-failure-class.test.ts` | `lint 干净树 exit 0`；`lint 命中裸 terminal 写入 exit 1` | → lint 脚本不存在 |
