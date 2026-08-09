# Sprint Contract Draft (Round 1) — harness 失败可观测：terminal 必写 failure_class + 失败率计量 API

**journey_type**: autonomous
**target_environment**: local_api
**法源**: 决策 e8f6134f-4131-4145-a893-79eb098011d9（交付物2）
**归位**: 工厂 · F1 开发闭环 · 步1「接单进车间即分档」(3bf6c116) · 动作=加厚

> **锚定父路声明**: 独立小路（无父路）— journey e6f803f2 现有 ability 均为 planned 态，本 sprint 为该 line 的观测地基，无已验收 golden-path 父路可挂。

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，代码层 Contract Gate 生效）

---

## 核心设计决策（Proposer 锁定 — Reviewer 重点审）

代码现状（本轮实枚举，见「预期受影响文件」与 Golden Path Step 2 清单）：

1. **`result` 列从未被任一 terminal 写入点写入** —— 近30天 241 条 `result IS NULL` 的根因。
2. `failure_class` 现散落三处 jsonb 列，口径不一：`custom_props`（executor `markInitiativeTerminalFailed`）、`payload`（retired / `missing_anchor`）、或**完全缺失**（dispatcher `postClaimException` line 399、`harness-death-handlers` auth、`kernel-run-store` relay 终结等）。
3. 任务验收断言查的是 `result->>'failure_class'`。

**决策**：本 sprint 把 harness terminal 失败原因**标准化写入 `result` 列**（`result.failure_class` 枚举 + `result.failure_detail` 自由文本），通过**单一 fail-closed 共享 helper** 收口，并用**作用域限定的 CI lint** 防回归。不动 `custom_props`/`payload` 里既有的镜像写法（避免 scope 蔓延），只新增 `result` 权威口径。历史 241 条 null 不回填（failure-stats 归入 `unknown` 桶）。

---

## Response Schema（推导来源: api_registry 推导 + PRD 明确）

### Endpoint: `GET /api/brain/harness/failure-stats?days=N`

**Success (HTTP 200)**:
```json
{
  "days": 7,
  "window_start": "2026-08-02T11:31:00.000Z",
  "total_terminal": 12,
  "total_failed": 8,
  "failure_rate": 0.6667,
  "by_class": { "invalid_gear": 3, "dispatch_exception": 2, "unknown": 7 }
}
```
- `days` (number, 必填): 回显请求窗口天数。来源——PRD 明确（`?days=N`）
- `window_start` (string, 必填): 窗口起点 ISO8601（`NOW() - N days`）。来源——api_registry（GET /runs 用 snake_case + ISO 时间戳）
- `total_terminal` (number, 必填): 窗口内 harness terminal 任务总数（failed+blocked+cancelled）。来源——PRD 假设2（滚动失败率分母）
- `total_failed` (number, 必填): 窗口内 status='failed' 的 harness 任务数（滚动失败率分子）。来源——PRD 假设2
- `failure_rate` (number, 必填): `total_failed / total_terminal`，`total_terminal=0` 时**定义为 0**（不报错、不 NaN、不 null）。来源——PRD 边界情况「窗口内 0 条 → 定义良好的数值」
- `by_class` (object, 必填): `{ <failure_class>: <count> }`，key 取 `COALESCE(result->>'failure_class','unknown')`（历史 null 稳定归入 `unknown` 桶）。来源——PRD 明确（按 failure_class 分组计数）

**禁用字段名**（api_registry 同义替换词，contract 正向断言绝不出现）: `rate`（用 `failure_rate`）、`count`（用 `total_terminal`/`total_failed`）、`classes`（用 `by_class`）、`window`（用 `window_start`）

**Error (HTTP 400)** — `days` 非整数 / <1 / >365:
```json
{ "error": "days must be an integer between 1 and 365" }
```
（沿用 GET /runs 的 `{ error: <string> }` 约定 + 400 校验码）

### 数据源与口径（⚠️ 判定点，见八要素登记表）

- 数据源：`tasks` 表，`task_type IN ('harness_initiative','golden_path_proposal')`
- 窗口基准列：**`completed_at`**（terminal 达成时间）。为此共享 helper 强制在 terminal 写入时同写 `completed_at = COALESCE(completed_at, NOW())`，保证窗口列可靠。
- `total_terminal`：`status IN ('failed','blocked','cancelled')` 且 `completed_at >= window_start`
- `total_failed`：上者中 `status='failed'`
- `by_class`：上者按 `COALESCE(result->>'failure_class','unknown')` 分组

---

## failure_class 枚举（Proposer 锁定 — ground truth，不接受自由文本）

共享模块 `packages/brain/src/lib/harness-failure-class.js` 导出**冻结枚举** `FAILURE_CLASSES`（取值来自真实失败样本 + 现有代码常量）：

```
max_fresh_starts_exceeded | invalid_gear | pipeline_terminal_failure | missing_anchor
dispatch_exception | dispatch_fail_autoblock | pre_flight_rejected | relay_deadline_exceeded
codex_config_error | auth_failure | contract_superseded | duplicate_merged
watchdog_deadline | infrastructure_blocked | evidence_invalid | product_failure | unknown
```

- `unknown` 是唯一「兜底/历史 null」桶；写入点**禁止**主动写 `unknown` 以外的未登记字符串（`assertFailureClass` 抛错 = fail-closed）。
- 枚举集合可由 generator 依真实样本微调（增删具体成员），但**必须冻结为白名单** + 运行时 assert 拒绝白名单外值。

---

## Golden Path

[任一 harness terminal 失败写入点] → [经共享 helper 强制写 `result.failure_class` 枚举 + `result.failure_detail`] → [CI lint 拦截任何绕过 helper 的 terminal 写] → [`GET /failure-stats` 按根因计量滚动失败率]

---

### Step 1: 定义冻结枚举 + fail-closed 共享 helper
**来源**: `[FROM_PRD]` — PRD「系统处理」第2条（枚举值不接受自由文本）+ 假设1（枚举由 Proposer 锁定）

**可观测行为**: 新增 `packages/brain/src/lib/harness-failure-class.js`，导出 `FAILURE_CLASSES`（冻结数组/Set）、`assertFailureClass(fc)`（白名单外抛 `Error`）、`markHarnessTerminal(pool, {taskId, status, failureClass, failureDetail})`。helper 校验 `status ∈ {failed,blocked,cancelled}` 与 `failureClass ∈ FAILURE_CLASSES`，然后 `UPDATE tasks SET status=$s, error_message=..., completed_at=COALESCE(completed_at,NOW()), result = COALESCE(result,'{}'::jsonb) || jsonb_build_object('failure_class',$fc,'failure_detail',$detail) WHERE id=$id`。传入非法/空 `failureClass` → 抛错，绝不落库 null。

**验证命令**:
```bash
node --input-type=module -e "import('./packages/brain/src/lib/harness-failure-class.js').then(m=>{if(!Array.isArray([...m.FAILURE_CLASSES]))process.exit(1); let threw=false; try{m.assertFailureClass('__nope__')}catch{threw=true}; if(!threw)process.exit(1); if(typeof m.markHarnessTerminal!=='function')process.exit(1); console.log('OK')}).catch(()=>process.exit(1))"
# 期望: OK
```
**硬阈值**: 模块可导入；`FAILURE_CLASSES` 非空；`assertFailureClass('__nope__')` 抛错；`markHarnessTerminal` 为函数。

---

### Step 2: 全量 harness terminal 写入点改经 helper 写 `result.failure_class`
**来源**: `[FROM_PRD]` — PRD「系统处理」第1条（先枚举全量再改，禁只改一两处）

**本轮实枚举的 in-scope harness terminal 写入点**（generator 必须逐条改为经 `markHarnessTerminal` 写 `result`，或明确判定 out-of-scope 并加 lint-allow 标记）：

| # | 文件:行 | 函数/场景 | 现状态 | failure_class 现落点 |
|---|---|---|---|---|
| 1 | executor.js:3006 | markInitiativeTerminalFailed（max_fresh_starts_exceeded / invalid_gear）| failed | custom_props（**非 result**）|
| 2 | executor.js:3480 | retired harness task_types → pipeline_terminal_failure | failed | payload（**非 result**）|
| 3 | dispatcher.js:399 | postClaimException（dispatch_exception）| failed | **无**|
| 4 | dispatcher.js:512 | retired harness task_types（dispatcher 侧）| failed | payload（**非 result**）|
| 5 | dispatcher.js:603 | missing_anchor（S2 执法闸）| failed | payload（**非 result**）|
| 6 | dispatcher.js:441-461 | pre_flight_rejected | blocked | **无**|
| 7 | dispatcher.js:839-851 | dispatch_fail_autoblock（经 blockTask）| blocked | **无**|
| 8 | orchestrator/kernel-run-store.js:248 | patchKernelRunById（relay_deadline_exceeded，被 harness-relay-watchdog 调）| failed | **无**|
| 9 | harness-death-handlers.js:39 | handleAuth（auth_failure）| blocked | **无**|
| 10 | golden-path-contracts.js:129 | invalidateGoldenPathContractVersion（contract_superseded）| cancelled | **无**|
| 11 | triage-officer-15min.js:45 | 重名归并（仅 `task_type IN ('dev','harness_initiative')` 中 harness 行，duplicate_merged）| cancelled | **无**|

> **out-of-scope（非 harness，加 `// lint-allow-terminal: <理由>` 标记，不改写）**: `credential-expiry-checker.js`（credential-alert 域）、`task-updater.js:blockTask`（通用 helper，仅当被 harness 调用方传入 failure_class 时透传）、以及共享文件里针对 content/dev 等**非 harness task_type** 的 terminal 写。generator 必须逐一判定，不得漏标。
> **注**: dispatcher `postClaimException`（#3）作用于任意 task_type；harness 派发路径命中时必须带 failure_class，非 harness 命中走 lint-allow —— 由 generator 依 `nextTask.task_type` 判定实现（运行时对 harness 类型写 `dispatch_exception`）。

**可观测行为**: 制造/驱动上述任一写入点后，对应 task 的 `result->>'failure_class'` 非 null 且 ∈ 枚举；`custom_props`/`payload` 既有镜像不删（零回归）。

**验证命令**（真机通道见 E2E 验收；此处为 lint 侧静态核查）:
```bash
node packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs ; echo "gate exit=$?"
# 期望: 实现完成后扫真实树 exit 0（无绕过 helper 的 harness terminal 裸写）
```
**硬阈值**: 实现完成后 lint 扫真实树 exit 0。

---

### Step 3: 机械闸 CI lint — 防回归
**来源**: `[FROM_PRD]` — PRD「系统处理」第2条（机械闸拦下，纯文档约定不算数）+ 边界情况（未来新增写入点必须能扫到）

**可观测行为**: 新增 `packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs`（ESM，风格对齐 island-gate.mjs：shebang + `--fixture-files=` + 退出码 0/1）。规则：扫描 curated harness 写入点文件集，任一 `UPDATE tasks SET ... status ... ('failed'|'blocked'|'cancelled')` 语句若**同语句不含 `failure_class`** 且**无 `// lint-allow-terminal:` 标记** → 命中 → exit 1；否则 exit 0。支持 `--fixture-files=<path>` 扫任意 fixture（供自测）。

**验证命令**:
```bash
# 脏 fixture（terminal 裸写无 failure_class）→ 必 exit 1
printf '%s\n' "await pool.query(\`UPDATE tasks SET status='failed' WHERE id=\$1\`,[id]);" > /tmp/gate-dirty.js
node packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs --fixture-files=/tmp/gate-dirty.js; DIRTY=$?
[ "$DIRTY" -eq 1 ] || { echo "FAIL: 脏 fixture 未被拦（exit=$DIRTY，期望1）"; exit 1; }
# 干净 fixture（带 failure_class）→ 必 exit 0
printf '%s\n' "await pool.query(\`UPDATE tasks SET status='failed', result=result||jsonb_build_object('failure_class','invalid_gear') WHERE id=\$1\`,[id]);" > /tmp/gate-clean.js
node packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs --fixture-files=/tmp/gate-clean.js; CLEAN=$?
[ "$CLEAN" -eq 0 ] || { echo "FAIL: 干净 fixture 被误拦（exit=$CLEAN，期望0）"; exit 1; }
echo OK
```
**硬阈值**: 脏 fixture exit 1；干净 fixture exit 0。

---

### Step 4: GET /api/brain/harness/failure-stats?days=N
**来源**: `[FROM_PRD]` — PRD「可观测结果」第3条

**可观测行为**: `routes/harness.js` 新增 `router.get('/failure-stats', ...)`（挂载后为 `/api/brain/harness/failure-stats`），风格对齐现有 GET /runs（`pool.query` + snake_case + `{error}`）。按上「Response Schema」返回；`days` 校验失败 400。

**验证命令**:
```bash
RESP=$(curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/failure-stats?days=7") || { echo "FAIL: 端点不可达/非200"; exit 1; }
echo "$RESP" | jq -e '.failure_rate | type == "number"' || { echo "FAIL: failure_rate 非 number"; exit 1; }
echo "$RESP" | jq -e '.by_class | type == "object"' || { echo "FAIL: by_class 非 object"; exit 1; }
echo "$RESP" | jq -e 'has("total_terminal") and has("total_failed") and has("window_start") and has("days")' || { echo "FAIL: 缺字段"; exit 1; }
echo OK
```
**硬阈值**: HTTP 200；`failure_rate` 为 number；`by_class` 为 object；含 days/window_start/total_terminal/total_failed。

---

### Step 5: 边界 — 空窗口 & 非法 days
**来源**: `[AI_ADDED]` — 理由：PRD 边界情况（0 条 terminal → failure_rate 定义良好；非枚举/非法输入拒绝），防 generator 用 NaN/null/500 兜过

**可观测行为**: `days` 极小窗口（如 `days=0` 非法 → 400；合法但窗口内 0 条 → `failure_rate==0` 且 `by_class=={}`，HTTP 200 不报错）。

**验证命令**:
```bash
# 非法 days=0 → 400 + error 字段
CODE=$(curl -s -o /tmp/fs-err.json -w "%{http_code}" "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/failure-stats?days=0")
[ "$CODE" = "400" ] || { echo "FAIL: days=0 未返 400（got $CODE）"; exit 1; }
jq -e '.error | type == "string"' /tmp/fs-err.json || { echo "FAIL: 400 无 error 字段"; exit 1; }
echo OK
```
**硬阈值**: `days=0` → 400 且 body 含 `error` 字符串。

---

## 已知约束（来自回归测试 + 累积 FR）

- [routes/harness.js 现有测试] → GET /runs 用 `pool.query` + snake_case + 400 校验（新 /failure-stats 跟进同风格，不破坏现有路由）
- [累积FR] context-manifest: 本 line（journey e6f803f2）暂无已验收 golden-path 历史，无累积 FR 约束；端点若不可达记 `context-manifest: unavailable`，不静默跳过
- [铁律 INV-1 合同实跑] → 本合同「机械闸自测 exit 1」已在 Step 3 给出可实跑命令，evaluator 原样跑（对应 DoD B-06）
- [铁律 INV-2 judge分流] → N/A：本 sprint 不改 judge 证据链路，无 evidence_insufficient 相关改动

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①全量 harness terminal 写入点强制写 `result.failure_class`(枚举)+`result.failure_detail`；②CI lint 防回归；③GET /failure-stats 计量 |
| **NFR（做得多好）** | 性能/并发 | failure-stats 单次聚合查询（无 N+1）；窗口列 `completed_at` 有索引即可（PrepPRD 未指定阈值，沿用现有 tasks 查询延迟） |
| **Invariant（永不违反）** | 不变量 | terminal harness 任务 `result->>'failure_class'` 永不为 null（fail-closed helper 保证）；枚举白名单外值一律拒绝落库 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | 枚举集合随失败模式演化增补；failure-stats 口径长期有效，无 token/过期语义 |
| **死亡告警（停了谁知道）** | 告警 | lint 是 CI 硬闸，回归即红 PR；failure-stats 若 500 由现有 Brain 500 日志暴露（本 sprint 不新增独立告警） |
| **失败语义（挂了怎么办）** | 故障 | helper 传非法枚举=抛错拦截（fail-closed，宁拦不放）；failure-stats DB 异常=500+{error}（读路径，降级为报错不静默） |
| **效果确认（已发≠已生效）** | 回执 | terminal 写后立即 `SELECT result->>'failure_class'` 非 null 回执；lint 自测 exit 码即回执 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ failure-stats 窗口基准列 | A. created_at; B. completed_at | B. completed_at | 「连续7天失败率」量的是 terminal 达成时间，created_at 会把老任务本轮完成算错窗；helper 同写 completed_at 保证列可靠 | 窗口口径错→失败率算错→开锁闸误判（面客决策错误） |
| ⚠️ 滚动失败率分母 | A. 全部 terminal(failed+blocked+cancelled); B. 仅 failed+completed | A. failed+blocked+cancelled | PRD 假设2「窗口内 terminal failed / 窗口内 terminal 总数」 | 分母定义错→失败率系统性偏高/偏低→7天<25%闸误开/误关 |
| ⚠️ 历史 null failure_class 归类 | A. 计入 unknown 桶; B. 排除 | A. 计入 unknown | PRD 边界「历史 null 需稳定归类口径」；排除会低估失败面 | 静默漏计→失败率虚低→过早开锁 |
| lint 作用域（哪些 terminal 写算 harness） | A. 全库所有 terminal 写; B. curated harness 文件+task_type判定+lint-allow 标记 | B | 全库会误拦 credential/content 等非 harness 写（假红）；A 超出 PRD scope | 错扫→CI 假红阻塞无关 PR；漏扫→回归 null |

> ⚠️ 判定点均属「误判后果严重（面客决策/开锁闸误判）」级，PrepPRD/对齐会未显式拍板窗口列与分母口径 → 见下 notes。

**judgment-pending-user**: failure-stats 窗口基准列(completed_at)、滚动失败率分母(failed/所有terminal)、历史null归类(unknown) —— 三项口径由 Proposer 依 PRD 假设锁定，若主理人对「7天<25%」开锁闸的精确口径有更严定义需回填确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| helper 传非法/空 failureClass | 抛 Error，不 UPDATE（不落 null） | 是（同 taskId 重放同结果） | 调用方须传合法枚举；fail-closed 宁拦不放 |
| failure-stats DB 查询异常 | 500 + `{error}` | 是（纯读） | 报错不静默，由 Brain 日志暴露 |
| failure-stats 窗口内 0 条 | 200，failure_rate=0，by_class={} | 是 | 定义良好数值，不报错 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | — | — | 本 sprint 无对外暴露 agent；failure-stats 为内部只读计量端点，`days` 参数经整数校验（1..365），无自由文本入 SQL（参数化查询） |

---

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（terminal 写入点 → `tasks.result`）与**跨模块数据传递**（各写入点 ↔ 共享 helper），故 failing test 必须真 Postgres、真 helper，不 mock 被改的边：

- **代码（markHarnessTerminal）↔ tasks 表 result 列**：本单新增该写路径，写点测试必须真 Postgres 验 `result->>'failure_class'` 真落库（E2E B-01/B-05 走 `${DB_URL:?}` 真库；vitest 集成测试走 CI postgres service，命名 `*.integration.test.js`）。禁 `vi.mock('../db.js')` 顶替此写路径的写点验证。
- **各 harness terminal 写入点 ↔ markHarnessTerminal**：调用接力测试至少一条真调（如 `markInitiativeTerminalFailed` invalid_gear 路径经 helper 真写库），不 mock helper。

**允许 mock 的更外层无关依赖**：failure-stats **读**路由的 shape 单测可 `vi.mock('../../db.js')` 返回构造 rows（db 是该只读 API 的外层边界，非本单被改的写边）；lint 逻辑测试用 fixture 文件（纯静态，无 DB）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `GET /failure-stats?days=abc` / `days=-1` / `days=999`（>365）→ 必 400，禁 500/NaN
- 错输入: `markHarnessTerminal` 传 `failureClass=''` / `null` / `'FreeText'` → 必抛错，`SELECT` 确认未落库 null
- 重复提交: 同一 task 连续两次 `markHarnessTerminal` → 幂等，result.failure_class 不叠加为数组
- 中途中断: terminal 写 UPDATE 命中 0 行（task 已是 completed）→ 不静默成功也不崩，行为定义清晰
- 边界值: failure-stats 窗口内恰好 0 条 → failure_rate=0（非 NaN/null）；恰好全 blocked 无 failed → failure_rate=0 且 total_terminal>0
- lint 边界: curated 文件里非 harness task_type 的 terminal 写漏标 lint-allow → 应被拦（提醒 generator 标记），而非放行
发现分级: P0/P1（口径错/落 null/lint 假绿）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## E2E 验收（target_environment = local_api — evaluator 模式B final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

> 数据库由 Fleet 注入 attempt 级 `${DB_URL:?}`；Brain 由 evaluator 环境提供于 `${BRAIN_URL:-http://localhost:5221}`（连同一 `$DB_URL`）。psql 断言全部带时间窗防历史冒充；curl 全部 `-sf` + `jq -e` 值校验。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SCRIPT_START=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

# 0. 确保 schema（空库兜底：真实 cecelia 库已存在 tasks 表则幂等无害）
DB_HOST="" node packages/brain/src/migrate.js >/tmp/harness-migrate.log 2>&1 || true
psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL" | grep -qx t || { echo "FAIL: tasks 表不存在"; exit 1; }

# 1. Step1 — 共享 helper 可导入 + fail-closed
node --input-type=module -e "import('./packages/brain/src/lib/harness-failure-class.js').then(m=>{const arr=[...m.FAILURE_CLASSES]; if(arr.length===0)process.exit(1); let t=false; try{m.assertFailureClass('__nope__')}catch{t=true}; if(!t)process.exit(1); if(typeof m.markHarnessTerminal!=='function')process.exit(1); console.log('OK helper')}).catch(e=>{console.error(e);process.exit(1)})"

# 2. 制造一条 harness_initiative 任务并经真 helper 打成 terminal failed（真库真写路径，不 mock）
TID=$(psql "$DB_URL" -tAc "INSERT INTO tasks (id, task_type, status, title, created_at) VALUES (gen_random_uuid(),'harness_initiative','in_progress','e2e-failclass', NOW()) RETURNING id" | tr -d ' ')
[ -n "$TID" ] || { echo "FAIL: 无法插入测试任务"; exit 1; }
DB_URL="$DB_URL" TID="$TID" node --input-type=module -e "import('pg').then(async({default:pg})=>{const pool=new pg.Pool({connectionString:process.env.DB_URL});const m=await import('./packages/brain/src/lib/harness-failure-class.js');await m.markHarnessTerminal(pool,{taskId:process.env.TID,status:'failed',failureClass:'invalid_gear',failureDetail:'e2e injected terminal'});await pool.end();console.log('OK marked')}).catch(e=>{console.error(e);process.exit(1)})"

# 3. B-01 断言：result.failure_class 真落库、非 null、∈ 枚举
FC=$(psql "$DB_URL" -tAc "SELECT result->>'failure_class' FROM tasks WHERE id='$TID'" | tr -d ' ')
[ "$FC" = "invalid_gear" ] || { echo "FAIL: result.failure_class=$FC ≠ invalid_gear"; exit 1; }
psql "$DB_URL" -tAc "SELECT result->>'failure_detail' FROM tasks WHERE id='$TID'" | grep -q . || { echo "FAIL: failure_detail 未写"; exit 1; }

# 4. B-05 断言：本轮（时间窗内）新产生的 terminal harness 任务无一 result.failure_class IS NULL
NULLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE task_type IN ('harness_initiative','golden_path_proposal') AND status IN ('failed','blocked','cancelled') AND completed_at > NOW() - interval '5 minutes' AND result->>'failure_class' IS NULL" | tr -d ' ')
[ "$NULLS" = "0" ] || { echo "FAIL: 本轮新 terminal harness 任务中 result.failure_class IS NULL 有 $NULLS 条"; exit 1; }

# 5. B-08 fail-closed：非法枚举必抛错，且不落库为 null
TID2=$(psql "$DB_URL" -tAc "INSERT INTO tasks (id, task_type, status, title, created_at) VALUES (gen_random_uuid(),'harness_initiative','in_progress','e2e-failclosed', NOW()) RETURNING id" | tr -d ' ')
DB_URL="$DB_URL" TID2="$TID2" node --input-type=module -e "import('pg').then(async({default:pg})=>{const pool=new pg.Pool({connectionString:process.env.DB_URL});const m=await import('./packages/brain/src/lib/harness-failure-class.js');let threw=false;try{await m.markHarnessTerminal(pool,{taskId:process.env.TID2,status:'failed',failureClass:'__free_text__',failureDetail:'x'})}catch{threw=true};await pool.end();if(!threw){console.error('did not throw');process.exit(1)};console.log('OK fail-closed')}).catch(e=>{console.error(e);process.exit(1)})"
STILL=$(psql "$DB_URL" -tAc "SELECT status FROM tasks WHERE id='$TID2'" | tr -d ' ')
[ "$STILL" != "failed" ] || { echo "FAIL: 非法枚举竟落成 failed"; exit 1; }

# 6. B-06 机械闸自测：脏 fixture exit 1 / 干净 fixture exit 0
printf '%s\n' "await pool.query(\`UPDATE tasks SET status='failed' WHERE id=\$1\`,[id]);" > /tmp/gate-dirty.js
set +e; node packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs --fixture-files=/tmp/gate-dirty.js; DIRTY=$?; set -e
[ "$DIRTY" -eq 1 ] || { echo "FAIL: 脏 fixture 未被拦（exit=$DIRTY）"; exit 1; }
printf '%s\n' "await pool.query(\`UPDATE tasks SET status='failed', result=result||jsonb_build_object('failure_class','invalid_gear') WHERE id=\$1\`,[id]);" > /tmp/gate-clean.js
set +e; node packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs --fixture-files=/tmp/gate-clean.js; CLEAN=$?; set -e
[ "$CLEAN" -eq 0 ] || { echo "FAIL: 干净 fixture 被误拦（exit=$CLEAN）"; exit 1; }
# 6b. lint 扫真实树 → 无绕过 exit 0
set +e; node packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs; REAL=$?; set -e
[ "$REAL" -eq 0 ] || { echo "FAIL: 真实树仍有绕过 helper 的 harness terminal 裸写（exit=$REAL）"; exit 1; }

# 7. B-02/B-03 failure-stats 200 + schema
RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/failure-stats?days=7") || { echo "FAIL: /failure-stats 不可达/非200"; exit 1; }
echo "$RESP" | jq -e '.failure_rate | type == "number"' || { echo "FAIL: failure_rate 非 number"; exit 1; }
echo "$RESP" | jq -e '.by_class | type == "object"' || { echo "FAIL: by_class 非 object"; exit 1; }
echo "$RESP" | jq -e 'has("days") and has("window_start") and has("total_terminal") and has("total_failed")' || { echo "FAIL: 缺字段"; exit 1; }
echo "$RESP" | jq -e '(.total_terminal|type=="number") and (.total_failed|type=="number")' || { echo "FAIL: 计数非 number"; exit 1; }
# 禁用字段名反向：正向 schema 不得出现 rate/count/classes/window 顶层键
echo "$RESP" | jq -e 'has("rate") or has("count") or has("classes") or has("window") | not' || { echo "FAIL: 出现禁用字段名"; exit 1; }

# 8. B-04 error path：非法 days=0 → 400 + error
CODE=$(curl -s -o /tmp/fs-err.json -w "%{http_code}" "$BRAIN_URL/api/brain/harness/failure-stats?days=0")
[ "$CODE" = "400" ] || { echo "FAIL: days=0 未返 400（got $CODE）"; exit 1; }
jq -e '.error | type == "string"' /tmp/fs-err.json || { echo "FAIL: 400 无 error 字段"; exit 1; }

# 9. 清理本轮测试任务
psql "$DB_URL" -tAc "DELETE FROM tasks WHERE id IN ('$TID','$TID2')" >/dev/null

echo "✅ Golden Path 全程验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 枚举 + fail-closed helper | `tests/harness-failure-class.test.js` | `assertFailureClass 拒绝白名单外值` / `FAILURE_CLASSES 冻结非空` | 模块不存在 → import 失败 → N failures |
| terminal 写真落 result（真 PG）| `tests/harness-terminal-write.integration.test.js` | `markHarnessTerminal 写入 result.failure_class 真落库` | 模块/写路径不存在 → fail |
| failure-stats 路由 shape | `tests/failure-stats-route.test.js` | `GET failure-stats 返回 failure_rate 与 by_class` / `days=0 返回 400` | 路由未注册 → 404/fail |
| 机械闸 lint 逻辑 | `tests/failure-class-gate.test.js` | `脏 fixture 命中 exit 1` / `干净 fixture exit 0` | lint 脚本不存在 → spawn 失败 → fail |

> Test Contract「BEHAVIOR 覆盖」列每个名均为对应 `it()` 名字面子串。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## CI Workflow 对齐

新增 lint 须接入 `.github/workflows/brain-ci-deploy.yml`：新增一个 `harness-terminal-failure-class-gate` job（或在既有 PR gate job 追加 step），命令 `node packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs`，退出非 0 即红 PR（对齐 island-gate job 写法）。真 PG 集成测试（`*.integration.test.js`）由带 postgres service + `node src/migrate.js` 的既有 brain-integration/island-gate job 形态承载。
