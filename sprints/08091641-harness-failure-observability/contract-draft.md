# Sprint Contract Draft (Round 1)

**Sprint**: harness 失败可观测 — terminal 必写 failure_class + 失败率计量 API
**journey_type**: autonomous
**target_environment**: local_api
**法源**: 决策 e8f6134f-4131-4145-a893-79eb098011d9（交付物2）

gp-anchor: skipped (product-map.json not found)
contract-gate: applies (packages/brain/src/lib/contract-gate.js present, cecelia worktree)

## 锚定父路声明

独立小路（无父路） — journey e6f803f2 现有 ability 均为 planned 态，本 sprint 是「F1 开发闭环 · 步1 接单进车间即分档」下的观测地基新增路径，无已验收父路可挂。

---

## Response Schema（推导来源: PRD字面 + api_registry 推导，参照既有 GET /harness/stats）

### Endpoint: GET /api/brain/harness/failure-stats?days=N

**Success (HTTP 200)**:
```json
{
  "period_days": 7,
  "by_class": {"timeout": 3, "runtime_crash": 5, "unknown": 1},
  "total_terminal_failed": 9,
  "total_terminal_done": 40,
  "failure_rate": 0.18
}
```
- `period_days` (number, 必填): 实际生效窗口天数。来源——PRD「days=N 窗口」；`days` 缺省/非数字/越界 → 回落默认 **7**（本 sprint 目标窗口），合法范围 clamp 到 1..365（对齐 `/harness/stats` 既有 `if (!Number.isInteger(days) || days<1 || days>365)` 惯例，默认值由 30 改为 7 因本端点专供「连续 7 天失败率」计量）。
- `by_class` (object, 必填): key=failure_class 枚举值，value=该类窗口内 terminal failed 计数。**必须真实接线**（非恒空对象）；窗口内无失败时为 `{}`。来源——PRD「按 failure_class 分组计数」。
- `total_terminal_failed` (number, 必填): 窗口内 terminal failed（status='failed'/'blocked'/'cancelled'）的 harness 任务数（分子）。
- `total_terminal_done` (number, 必填): 窗口内 terminal done（status='completed'/'done'）的 harness 任务数。
- `failure_rate` (number, 必填): 滚动失败率 = `total_terminal_failed / (total_terminal_failed + total_terminal_done)`，两位小数；分母为 0 时返回 `0`。来源——PRD「滚动失败率」口径一句锁死。

**禁用字段名**（api_registry 同义替换，contract 正向断言里绝不出现）: `fail_rate`、`failureRate`、`classes`、`counts`、`stats`、`error_class`。

**Error / 边界**:
- `days` 非数字（如 `days=abc`）或越界 → **不报错**，回落默认 7，仍返回 HTTP 200（口径边界，proposer 定契约：计量端点对脏参数容错，避免日报消费方因脏参崩）。
- 数据源口径锁死: `task_type IN ('harness_initiative','golden_path_proposal')`，窗口 `created_at >= NOW() - make_interval(days => $1)`。

---

## 受控枚举单一来源（本 sprint 核心收敛物）

新增单一枚举源模块 `packages/brain/src/orchestrator/failure-class.js`，导出：

- `FAILURE_CLASSES`（`Object.freeze` 的字符串数组）—— 收敛现有散落字面量，**受控清单**（generator 可按写入点实际需要增补成员，但必须全部来自本模块这一个 frozen 源，禁各文件再写裸字面量）。本轮定稿清单（覆盖已枚举写入点）：
  ```
  timeout, runtime_crash, network, infrastructure_blocked, product_failure,
  evidence_invalid, contract_invalid, max_fresh_starts_exceeded, watchdog_deadline,
  liveness_dead, pipeline_terminal_failure, missing_anchor, dispatch_fail_autoblock,
  pre_flight_rejected, recovery_without_session, invalid_gear, unknown
  ```
- `isValidFailureClass(x): boolean` —— 成员判定
- `assertFailureClass(x): void` —— 非枚举值 `throw new Error('invalid failure_class: ' + x)`（满足边界「非法值即 assert 失败」）
- `buildFailureResultPatch(failureClass, failureDetail): {failure_class, failure_detail}` —— 纯函数，先 `assertFailureClass`，返回落库用 patch 对象（`failure_detail` 允许 `null`/空串，但 `failure_class` 必填且合法）
- `computeFailureStats(rows): {by_class, total_terminal_failed, total_terminal_done, failure_rate}` —— 纯聚合函数（输入 `[{failure_class, is_terminal_failed:boolean}]`），供 endpoint 复用、可脱库单测（口径接线的可测锚点）

新增共享落库助手（收敛「代码 ↔ tasks.result」写路径单一入口）：
- `persistTerminalFailure(dbPool, taskId, failureClass, failureDetail)` —— 位于 `failure-class.js`（或 `orchestrator/failure-persistence.js` 扩展），内部 `assertFailureClass` 后执行
  `UPDATE tasks SET result = COALESCE(result,'{}'::jsonb) || $2::jsonb WHERE id=$1`（`$2` = `buildFailureResultPatch` 输出），与既有 `handoff.js`/`routes/execution.js`/`routes/tasks.js` 的 `result = COALESCE(result,'{}'::jsonb) || $::jsonb` 惯用法逐字一致。

**全量 terminal 写入点收敛清单（先枚举后改，禁只改一两处）**：
| 写入点 | 文件 | 收敛后写 result.failure_class |
|---|---|---|
| `markInitiativeTerminalFailed` | executor.js | 经 `persistTerminalFailure`（现只写 custom_props → 补写 result） |
| `mark_failed` action / infrastructure_blocked / evidence_invalid / product_failure 终结 | orchestrator/loop.js | 经 `persistTerminalFailure` |
| dispatch-fail-autoblock（status='blocked'）| dispatcher.js | 经 `persistTerminalFailure`（pipeline_terminal_failure / missing_anchor / pre_flight_rejected / dispatch_fail_autoblock）|
| relay 超时/断链终结（relay_deadline_exceeded / recovery_without_session）| harness-relay-watchdog.js | 经 `persistTerminalFailure` |
| 死亡终结（status='blocked'）| harness-death-handlers.js | 经 `persistTerminalFailure` |

---

## 已知约束（来自回归测试 + 累积 FR）

- [failure-persistence.test.js] → redacts secret assignment / never echoes prefixed secret values（诊断脱敏不得回退——本 sprint 复用同模块须保留脱敏）
- [dispatch-fail-autoblock.test.js] → 连续派发失败达阈值置 blocked（本 sprint 在此路径补 failure_class，不得破坏既有 autoblock 行为）
- [累积FR] context-manifest: 本 line 暂无已验收行为（journey e6f803f2 ability 均为 planned），无累积 FR 约束

## 历史约束三源加载

**铁律清单 → INV 映射**（见 contract-dod.md INV 条目）:
- INV-1 [口径三源失真]：failure_rate 分子/分母必须真实接线，`by_class` 非恒空子指标；测「制造真实 terminal 记录后 by_class 计数 > 0 且 failure_rate 与分母一致」。
- INV-2 [验证实跑]：所有 BEHAVIOR/E2E 命令以真实 exit code 驱动断言，绿态由真跑证明（禁 `|| true` 吞错、禁 `echo PASS`）。

**累积 FR（T3 context-manifest）**: 本 line 无累积 FR（planned 态），记 `context-manifest: no accumulated FR (all abilities planned)`。

---

## Golden Path

[任一 harness terminal 失败发生] → [统一受控枚举落库 result.failure_class + failure_detail] → [机械闸拦截漏写] → [failure-stats 端点计量失败率]

### Step 1: terminal 失败经单一枚举源落库 result.failure_class
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步「每个 terminal 写入点强制写 result.failure_class（受控枚举）+ result.failure_detail」

**可观测行为**: 任一 harness 任务经收敛后的 terminal 写入点（`persistTerminalFailure`）打成 failed/blocked/cancelled 后，`tasks.result->>'failure_class'` 非 null 且值 ∈ `FAILURE_CLASSES`。

**验证命令**:
```bash
# 经真实写路径制造一条 terminal failed，再 psql 验落库
node -e 'import("./packages/brain/src/orchestrator/failure-class.js").then(async m=>{const {default:pool}=await import("./packages/brain/src/db.js");const {rows}=await pool.query("INSERT INTO tasks(id,task_type,status,title,created_at) VALUES (gen_random_uuid(),'"'"'harness_initiative'"'"','"'"'in_progress'"'"','"'"'e2e-failclass'"'"',NOW()) RETURNING id");await m.persistTerminalFailure(pool,rows[0].id,"timeout","e2e synthetic");process.stdout.write(rows[0].id)})' > /tmp/tid
psql "$DB_URL" -tAc "SELECT result->>'failure_class' FROM tasks WHERE id='$(cat /tmp/tid)'" | grep -qx timeout
```
**硬阈值**: `result->>'failure_class'` = 'timeout'（非 null 且合法枚举），写入 5s 内完成

---

### Step 2: 非法枚举值即 assert 失败
**来源**: `[FROM_PRD]` — PRD 边界「受控枚举，非法值即 lint/assert 失败」

**可观测行为**: `assertFailureClass('free text 乱写')` 抛错，`persistTerminalFailure` 拒绝落库自由文本。

**验证命令**:
```bash
node -e 'import("./packages/brain/src/orchestrator/failure-class.js").then(m=>{try{m.assertFailureClass("free_text_bogus");process.exit(1)}catch(e){process.exit(0)}})'
# 期望 exit 0（抛错 = 拒绝）
```
**硬阈值**: 非枚举值 exit 0（抛错）；合法枚举不抛错

---

### Step 3: 机械闸拦截「terminal 写入不带 failure_class」
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 范围③「机械闸（CI lint）防回归」

**可观测行为**: 新增 CI lint `scripts/lint-failure-class-writes.mjs` 扫描枚举写入点文件；干净树 exit 0，注入一处不写 failure_class 的 terminal 写入 → exit 1。

**验证命令**:
```bash
node scripts/lint-failure-class-writes.mjs; [ $? -eq 0 ] || { echo "FAIL: 干净树 lint 应 exit 0"; exit 1; }
# 注入违规 fixture 后应 exit 1（见 E2E 脚本 self-test 段）
```
**硬阈值**: 干净树 exit 0；含违规写入 exit 1

---

### Step 4: failure-stats 端点返回失败率 + 分组
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步「GET /harness/failure-stats?days=N 返回 failure_rate + by_class」

**可观测行为**: `GET localhost:5221/api/brain/harness/failure-stats?days=7` 返回 200，body 含 `failure_rate`（数值）+ `by_class`（对象）+ `period_days`。

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/failure-stats?days=7")
echo "$RESP" | jq -e '.failure_rate | type == "number"'
echo "$RESP" | jq -e '.by_class | type == "object"'
echo "$RESP" | jq -e '.period_days == 7'
```
**硬阈值**: HTTP 200；`failure_rate` 是 number；`by_class` 是 object；`period_days` == 7

---

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（terminal status → `tasks.result`）与 **状态机**（terminal 终态落库），按 v9.12 禁 mock 被改的边：

- 代码 ↔ DB 表 `tasks`（本单新增 `result.failure_class`/`result.failure_detail` 写路径）—— integration test（`*.pg.integration.test.js`）必须真 Postgres 验 `persistTerminalFailure` 后 `result->>'failure_class'` 真落库，禁 stub dbPool。
- `persistTerminalFailure` ↔ `computeFailureStats`/endpoint 聚合 ↔ 同一 `tasks` 表（口径接线）—— failure-stats 的口径校验（INV-1）走真 Postgres 读同一批真写记录，禁 mock 掉写或读。

纯逻辑边（`assertFailureClass`/`buildFailureResultPatch`/`computeFailureStats` 入参→出参）允许脱库单测（不碰被改的 DB 边，属逻辑断言）。

## 真实调用方请求 shape

N/A —— 本 sprint 无「设备/外部 agent 调服务端」入口。terminal 写入点全部是 Brain **内部代码路径**（executor/loop/dispatcher/watchdog/death-handlers 互调），failure-stats 是内部只读计量端点，调用方为 Brain 自身/日报消费者（同进程），无跨设备认证 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— DoD 无 `force_*`/stub/假数据；被改的 DB 边由 integration test 真 Postgres 覆盖，第三方 API 不涉及。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺做什么 | ①全量 terminal 写入点经单一枚举源写 result.failure_class+failure_detail；②机械闸拦漏写；③GET /harness/failure-stats?days=N 计量端点 |
| **NFR（做得多好）** | 性能/可靠性/口径 | failure_class 受控枚举（非自由文本）；滚动失败率真实接线（禁恒空子指标）；缺失率新增=0；端点对脏 days 参数容错不崩 |
| **Invariant（永不违反）** | 不变量 | 任一 harness terminal 写入落库后 result.failure_class 非 null 且 ∈ FAILURE_CLASSES（见 INV-1/INV-2） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 枚举清单随写入点演进增补；failure-stats 供决策 e8f6134f 交付物4 开锁前计量，锁开后仍作日报常驻指标 |
| **死亡告警（停了谁知道）** | 停摆谁知道 | 机械闸挂在 CI（brain-ci.yml），漏写路径合并即 red；failure-stats 恒空/500 由后续日报消费方观察（本 sprint 不建告警，登记为后续） |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | 每个 terminal 写入以 psql `result->>'failure_class'` 非 null 为回执；端点以 curl 200 + jq 字段存在为回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| 某 terminal 写入点是否「已带 failure_class」 | A. 静态扫描写入点文件同块内含 failure_class/persistTerminalFailure; B. 运行时 assert 落库前拦截 | A+B（lint 静态扫 + assertFailureClass 运行时） | 静态扫覆盖新增路径防回归，运行时 assert 兜非法值 | 漏判→失败原因缺失率回升，交付物4 锁永不开 |
| ⚠️ 分母口径（滚动失败率的 (failed+done) 范围） | A. 仅 harness_initiative; B. harness_initiative+golden_path_proposal 两类 terminal | B（两类 terminal failed/done 计数） | PRD 明确两类都算 terminal；口径一句锁死避免「未接线恒空子指标」失真 | 分母错→失败率失真→误判 7 天开锁闸 |

> ⚠️ 分母口径为误判后果严重项（直接决定交付物4 开锁判断）；PrepPRD 已在 PRD「边界情况」锁定「terminal failed/(terminal failed+terminal done)」，合同据此定稿，无需再升拍板。judgment-pending-user: 无。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `persistTerminalFailure` 落库失败（DB 抖动） | 记 warn，不阻塞终结主流程（对齐现有 markInitiativeTerminalFailed 的 non-fatal 惯例） | 是（幂等键=task_id，`result = COALESCE||patch` 覆盖幂等） | best-effort，下次同任务终结覆写 |
| `assertFailureClass` 收到非法枚举 | throw，拒绝落库（fail-closed，不允许自由文本进 result） | N/A（未落库） | 调用方须传合法枚举，非法即代码 bug 暴露 |
| failure-stats 收到脏 days 参数 | 回落默认 7，返回 200 | 是（只读幂等） | 容错，不 500 |
| failure-stats DB 查询异常 | 返回 500 + `{error}` | 是（只读幂等） | 客户端重试 |

### 输入对抗面（对外暴露 agent 必填）

N/A —— failure-stats 是内部只读计量端点，无外部 agent 写入、无 prompt injection 面；`days` 为整型 query 参数，经 `parseInt`+clamp 消毒。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
SCRIPT_START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CREATED_IDS=$(mktemp)
cleanup() { rm -f "$CREATED_IDS" /tmp/failclass-tid /tmp/lint-fixture.mjs; }
trap cleanup EXIT

# 0. 目标列/端点前置：result 列存在（migration 220）
psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL" | grep -qx t || { echo "FAIL: tasks 表缺失"; exit 1; }

# 1. Step1 — 经真实收敛写路径 persistTerminalFailure 制造 terminal failed，psql 验 result.failure_class 非 null
TID=$(node -e 'import("./packages/brain/src/orchestrator/failure-class.js").then(async m=>{const {default:pool}=await import("./packages/brain/src/db.js");const {rows}=await pool.query("INSERT INTO tasks(id,task_type,status,title,created_at) VALUES (gen_random_uuid(),'"'"'harness_initiative'"'"','"'"'in_progress'"'"','"'"'e2e-failclass'"'"',NOW()) RETURNING id");await m.persistTerminalFailure(pool,rows[0].id,"timeout","e2e synthetic detail");await pool.query("UPDATE tasks SET status='"'"'failed'"'"' WHERE id=$1",[rows[0].id]);process.stdout.write(rows[0].id)})')
echo "$TID" >> "$CREATED_IDS"
FC=$(psql "$DB_URL" -tAc "SELECT result->>'failure_class' FROM tasks WHERE id='$TID'" | tr -d ' ')
[ "$FC" = "timeout" ] || { echo "FAIL: result.failure_class=$FC 期望 timeout"; exit 1; }
echo "✅ Step1 result.failure_class 落库 = $FC"

# 2. Step2 — 非法枚举 assert 失败（自由文本被拒）
node -e 'import("./packages/brain/src/orchestrator/failure-class.js").then(m=>{try{m.assertFailureClass("free_text_bogus");process.exit(1)}catch(e){process.exit(0)}})' || { echo "FAIL: 非法枚举未被 assert 拒绝"; exit 1; }
echo "✅ Step2 非法枚举被 assert 拒绝"

# 3. Step3 — 机械闸：干净树 exit 0
node scripts/lint-failure-class-writes.mjs || { echo "FAIL: 干净树 lint 未 exit 0"; exit 1; }
echo "✅ Step3a 干净树 lint exit 0"
# 机械闸 self-test：注入一处「terminal 写入不带 failure_class」的 fixture → lint 必 exit 1
cat > /tmp/lint-fixture.mjs <<'FIX'
// synthetic violation: UPDATE tasks SET status='failed' 却不写 failure_class
export async function badTerminalWrite(pool, id){ await pool.query("UPDATE tasks SET status='failed' WHERE id=$1",[id]); }
FIX
if node scripts/lint-failure-class-writes.mjs --extra-scan /tmp/lint-fixture.mjs; then echo "FAIL: 违规写入未被 lint 拦下（应 exit 1）"; exit 1; fi
echo "✅ Step3b 违规写入被 lint 拦下 exit 1"

# 4. Step4 — failure-stats 端点 200 + failure_rate 数值 + by_class object
RESP=$(curl -sf "$BRAIN/api/brain/harness/failure-stats?days=7") || { echo "FAIL: 端点非 200"; exit 1; }
echo "$RESP" | jq -e '.failure_rate | type == "number"' || { echo "FAIL: failure_rate 非数值"; exit 1; }
echo "$RESP" | jq -e '.by_class | type == "object"' || { echo "FAIL: by_class 非对象"; exit 1; }
echo "$RESP" | jq -e '.period_days == 7' || { echo "FAIL: period_days 非 7"; exit 1; }
# 脏参数容错：days=abc 回落默认 7，仍 200
curl -sf "$BRAIN/api/brain/harness/failure-stats?days=abc" | jq -e '.period_days == 7' || { echo "FAIL: 脏 days 未回落 7"; exit 1; }
echo "✅ Step4 failure-stats 端点口径正确"

# 5. INV-1 口径接线：本轮真写记录后 by_class 计数 > 0 且 failure_rate 与分母一致（非恒空）
TID2=$(node -e 'import("./packages/brain/src/orchestrator/failure-class.js").then(async m=>{const {default:pool}=await import("./packages/brain/src/db.js");const {rows}=await pool.query("INSERT INTO tasks(id,task_type,status,title,created_at) VALUES (gen_random_uuid(),'"'"'golden_path_proposal'"'"','"'"'in_progress'"'"','"'"'e2e-failclass-2'"'"',NOW()) RETURNING id");await m.persistTerminalFailure(pool,rows[0].id,"runtime_crash","e2e inv detail");await pool.query("UPDATE tasks SET status='"'"'failed'"'"' WHERE id=$1",[rows[0].id]);process.stdout.write(rows[0].id)})')
echo "$TID2" >> "$CREATED_IDS"
RESP2=$(curl -sf "$BRAIN/api/brain/harness/failure-stats?days=7")
echo "$RESP2" | jq -e '(.by_class | to_entries | map(.value) | add) >= 1' || { echo "FAIL: by_class 计数恒空（口径未接线）"; exit 1; }
echo "$RESP2" | jq -e '.failure_rate >= 0 and .failure_rate <= 1' || { echo "FAIL: failure_rate 越界"; exit 1; }
echo "✅ INV-1 口径真实接线（by_class 非恒空）"

# 6. 缺失率新增=0：本 E2E 期间新造的 terminal harness 任务 result.failure_class IS NULL 计数 = 0（时间窗防历史冒充）
NULLCNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE task_type IN ('harness_initiative','golden_path_proposal') AND status IN ('failed','blocked','cancelled') AND created_at > '$SCRIPT_START_ISO'::timestamptz AND (result->>'failure_class') IS NULL" | tr -d ' ')
[ "$NULLCNT" = "0" ] || { echo "FAIL: 本轮新产生 terminal harness 任务有 $NULLCNT 条 failure_class IS NULL"; exit 1; }
echo "✅ 缺失率新增=0（NULL count=$NULLCNT）"

echo "✅ Golden Path 全程验证通过"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `GET /harness/failure-stats?days=-5` / `days=999999` / `days=0` / `days=` 空值 —— 应 clamp 到 1..365 或回落 7，不得 500、不得负分母
- 重复提交: 同一 taskId 连续两次 `persistTerminalFailure`（不同 failure_class）—— result.failure_class 应幂等覆写为最后一次，不得报错、不得双计
- 中途中断: `persistTerminalFailure` 落库进行中 DB 断连 —— 应 non-fatal warn 不阻塞终结主流程，不得把任务卡在非终态
- 边界值: failure_detail 传超长文本（>2000 字）/ 含 secret 样式字符串 —— 落库不崩，secret 复用 redactSecrets 脱敏（回归 failure-persistence.test.js）
发现分级: P0/P1（口径失真/漏写路径/500）→ 阻塞 merge；P2/P3（脏参提示体验）→ 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 受控枚举源 | `tests/failure-class.test.ts` | `assertFailureClass rejects free text`、`buildFailureResultPatch returns failure_class and failure_detail`、`FAILURE_CLASSES is frozen` | → module 不存在，import 失败 → N failures |
| 口径聚合纯函数 | `tests/failure-class.test.ts` | `computeFailureStats returns failure_rate and by_class` | → computeFailureStats 未导出 → FAIL |
| 机械闸扫描 | `tests/lint-failure-class-writes.test.ts` | `scanTerminalWrites flags terminal write missing failure_class` | → scanner 未实现 → FAIL |
| DB 写边（真 PG） | `tests/persist-terminal-failure.pg.integration.test.ts` | `persistTerminalFailure writes result failure_class`（brain-integration job 真 Postgres）| → persistTerminalFailure 未实现 → FAIL |
