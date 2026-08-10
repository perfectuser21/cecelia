# Sprint Contract Draft (Round 1)

**Sprint**: harness 失败可观测 — terminal 必写 failure_class + 失败率计量 API
**journey_type**: autonomous
**target_environment**: local_api
**法源**: 决策 e8f6134f-4131-4145-a893-79eb098011d9（交付物2）
**归位**: 工厂 · F1 开发闭环（journey e6f803f2）· 步1「接单进车间即分档」(3bf6c116) · 动作=加厚

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在）→ 走代码层 Contract Gate + 本 skill 内置规则

## 锚定父路声明

覆盖父路 F1 开发闭环（journey e6f803f2）步1「接单进车间即分档」(3bf6c116) —— 动作=加厚（为该步补失败可观测地基，不改分档逻辑本身）。

---

## Response Schema（推导来源: PRD 字面 [failure_rate/by_class] + api_registry 命名风格推导）

api_registry 现有 harness 端点（`GET /harness/runs` 等）均返回 snake_case 字段、错误走 `{ "error": <string> }`、成功走 `res.json(...)`。据此推导：

### Endpoint: GET /api/brain/harness/failure-stats?days=N
**Success (HTTP 200)**:
```json
{
  "days": 7,
  "window_start": "2026-08-03T18:30:00.000Z",
  "total": 42,
  "failed": 9,
  "failure_rate": 0.2143,
  "by_class": { "timeout": 4, "no_progress": 3, "unknown": 2 }
}
```
- `days` (number, 必填): 窗口天数，回显入参。来源——PRD 明确（`?days=N`）
- `window_start` (string ISO, 必填): 窗口起点 = NOW() - days。来源——api_registry 时间字段惯例（snake_case ISO）
- `total` (number, 必填): 窗口内 **完结**（terminal: failed+blocked+cancelled+completed）harness 任务数 = failure_rate 分母。来源——PRD 假设「分母 = 窗口内 harness_initiative 完结总数」
- `failed` (number, 必填): 窗口内 failed（含 blocked/cancelled 非成功 terminal）harness 任务数 = failure_rate 分子。来源——PRD Golden Path 4
- `failure_rate` (number, 必填): `failed / total`，`total==0` 时为 `0`（不报错）。来源——**PRD 字面**（禁改名）
- `by_class` (object, 必填): 按 `result->>'failure_class'` 分组计数，key=枚举成员，value=计数；空窗口返回 `{}`。来源——**PRD 字面**（禁改名）

**禁用字段名**（drift guard，jq -e 正向断言中不得出现）: `failureRate`、`byClass`、`rate`、`classes`、`stats`、`counts`、`failure_stats`

**Error (HTTP 400)** — `days` 非法（非整数 / <1 / >365）:
```json
{ "error": "days must be an integer between 1 and 365" }
```
- `error` (string, 必填): 来源——api_registry `GET /harness/runs` 400 惯例

> 空窗口（无任何完结 harness 任务）**不是错误**：返回 200 + `total:0, failed:0, failure_rate:0, by_class:{}`（PRD 边界情况「by_class 对空窗口返回空对象而非报错」）。

---

## result.failure_class 落点与枚举 SSOT

**核心统一（PRD 边界情况「写入位置口径统一」）**：现存写入点口径三分裂——
- `executor.js:3006` 写 `custom_props.failure_class`
- `dispatcher.js:352/512/603` 写 `payload.failure_class`
- `harness-relay-watchdog.js`（经 `kernel-run-store.js:248`）只写 `tasks.error_message` + `initiative_runs.failure_reason`，**根本不写 failure_class**

而验收断言查的是 `result->>'failure_class'`。本 sprint **必须把全部 terminal harness 写入点的 failure_class 落点统一到 `tasks.result`**，否则断言恒空。

**枚举 SSOT**：新增 `packages/brain/src/harness-failure-class.js`，导出闭集 + 分类 + 结果构造 helper。所有 terminal 写入点 import 此模块，禁各自内联字符串。推荐闭集（覆盖现存全部 raw reason 语料，generator 可微调但必须满足下方硬约束）：

```
FAILURE_CLASSES = [
  'pipeline_terminal_failure',  // 退役 harness task_type 被 subsume
  'missing_anchor',             // dispatcher S2 anchor gate（含 missing_gp_anchor）
  'missing_orchestrator_flag',  // executor 缺 orchestrator flag
  'invalid_gear',               // executor 非法 gear
  'timeout',                    // relay_deadline_exceeded / generator_done_timeout / automation_deadline_exceeded / watchdog_deadline
  'no_progress',                // no_progress_same_sha / max_fresh_starts_exceeded / orphan_guard_exhausted
  'infra',                      // remote_bridge_prepare_* / network / runner_failure / infrastructure_blocked / bridge_restart_orphaned
  'process_crash',              // runtime_crash / kernel_process_fatal / code_error / pid_gone / liveness_dead
  'contract_invalid',           // 合同非法
  'evidence_insufficient',      // evidence_insufficient/invalid / product_failure / semantic_refusal / test_failure
  'dispatch_exception',         // dispatcher post-claim 异常
  'pre_flight_rejected',        // dispatcher 3+ strikes blocked
  'gate_violation',             // merged_without_evaluator_gate
  'needs_context',              // needs_context / env_skill_missing
  'cancelled',                  // 人工/系统取消
  'unknown',                    // 兜底——保证 IS NULL 归零
]
```

**枚举硬约束（Reviewer 审 + 机械闸执法）**：
1. `FAILURE_CLASSES` 是**冻结闭集**（`Object.freeze`），含 `unknown` 兜底成员。
2. `failure_class` 只接受闭集成员（枚举）；`failure_detail` 承载自由文本（原始 reason 全文）。
3. 未识别 raw reason → `classifyFailure()` 归 `unknown`（**不得原样落自由文本进 failure_class**，PRD 边界「枚举兜底」）。
4. `buildTerminalFailureResult()` 对非法 class **降级为 unknown**，原始描述保进 `failure_detail`，保证 `result->>'failure_class'` 永不为 null。

---

## 全量 terminal 写入点清单（先枚举再改，禁只改一两处）

由 Explore 全仓枚举，本 sprint 必须逐点改为经 SSOT helper 写 `result.failure_class` + `result.failure_detail`：

| # | 文件:行 | 现状态 | 现落点 | 改后 |
|---|---|---|---|---|
| 1 | `executor.js:3003-3021` `markInitiativeTerminalFailed` | failed | `custom_props.failure_class` | `result.failure_class`(枚举)+`result.failure_detail` |
| 2 | `executor.js:3480-3482` 退役 harness task | failed | `payload.failure_class='pipeline_terminal_failure'` | `result.*` |
| 3 | `dispatcher.js:352-354` drain 退役(pre-dispatch) | failed | `payload.failure_class='pipeline_terminal_failure'` | `result.*` |
| 4 | `dispatcher.js:394-401` dispatch 异常(post-claim) | failed | 仅 `error_message`（**无 failure_class**）| `result.failure_class='dispatch_exception'`+detail |
| 5 | `dispatcher.js:448-461` pre-flight 3+strikes | blocked | `blocked_reason`（**无 failure_class**）| `result.failure_class='pre_flight_rejected'`+detail |
| 6 | `dispatcher.js:510-517` dispatch loop 退役 | failed | `payload.failure_class='pipeline_terminal_failure'` | `result.*` |
| 7 | `dispatcher.js:601-608` S2 anchor gate | failed | `payload.failure_class='missing_anchor'` | `result.*` |
| 8 | `harness-relay-watchdog.js` → `kernel-run-store.js:248-258` `patchKernelRunById` tasks UPDATE | failed | 仅 `error_message`（**无 failure_class**）| `result.failure_class`(由 `classifyFailure(failure_reason)`)+detail |
| 9 | `orchestrator/loop.js:293-301` `markRunFailed`→finalizeKernelRun | failed | 经 #8 kernel-run-store 落 tasks | 随 #8 统一 |

> `harness_attempts` 表的 `recovery_without_session`（watchdog:936）是 **attempt 级**、非 tasks 表 harness_initiative/golden_path_proposal terminal，**不在本 sprint 落点范围**（记入未覆盖清单说明）。

---

## 机械闸（CI lint — 防回归，纯文档约定不算数）

新增 `scripts/check-harness-terminal-failure-class.mjs`（或 `.sh`），扫描上表白名单文件（executor.js / dispatcher.js / orchestrator/loop.js / harness-relay-watchdog.js / orchestrator/kernel-run-store.js）：
- 命中「对 `tasks` 表的 terminal 写入」（`UPDATE tasks SET ... status = 'failed'|'blocked'|'cancelled'`）而该语句/所在 helper **不写 `result` 的 `failure_class`**（推荐：非经 SSOT helper `buildTerminalFailureResult`/`markInitiativeTerminalFailed` 的裸写）→ 打印 offending `file:line`，`exit 1`。
- 真树扫描必须 `exit 0`。
- 接入 `.github/workflows/ci.yml` lint job（参照 `scripts/check-consciousness-guard.sh` / `registry-lint.mjs` 的接法）。
- **自测**（`scripts/__tests__/check-harness-terminal-failure-class.test.sh`）：往临时 fixture 注入一处裸 terminal 写入 → 断言 lint `exit 1`；真树 → 断言 `exit 0`。参照现有 `scripts/__tests__/*.test.sh` 自测范式。

---

## 版本三处同步（NFR 硬约束 — 前轮 PR #4746 漏根 lock 致 smoke 挂）

bump `packages/brain/package.json` version（1.270.13 → 1.270.14）时必须同步：
1. `packages/brain/package.json` `.version`
2. `packages/brain/package-lock.json`（`.version` 与 `.packages[""].version`）
3. 仓库根 `package-lock.json` 的 `.packages["packages/brain"].version`

push 前自查：`node -e "const l=require('./package-lock.json'),p=require('./packages/brain/package.json'); if(l.packages['packages/brain'].version!==p.version) throw new Error('root lock 版本不同步')"`（已实跑：当前 1.270.13 同步，exit 0）。

---

## Golden Path

[任一 terminal 收尾路径触发] → [经 SSOT helper 写 result.failure_class(枚举)+failure_detail] → [failure-stats API 按根因计量] → [机械闸拦截裸写回归]

### Step 1: terminal 写入点强制写 result.failure_class（枚举）
**来源**: `[FROM_PRD]` — PRD 必须实现①、Golden Path 1-3、边界「写入位置口径统一」

**可观测行为**: 把 harness_initiative/golden_path_proposal 打成 terminal（failed/blocked/cancelled）后，`tasks.result->>'failure_class'` 为闭集枚举成员（非 null、非自由文本），`result->>'failure_detail'` 为自由文本。

**验证命令**（真 dispatcher 边 + 真 PG；插入退役 task_type=harness_task，tick 自动 drain 成 failed）:
```bash
: "${DB_URL:?evaluator 须注入与 Brain 同库的 DB_URL}"
TID=$(psql "$DB_URL" -tAc "INSERT INTO tasks (task_type,status,title,priority) VALUES ('harness_task','queued','[e2e] failure_class probe',3) RETURNING id" | tr -d ' ')
DEADLINE=$((SECONDS+60))
until [ "$(psql "$DB_URL" -tAc "SELECT status FROM tasks WHERE id='$TID'" | tr -d ' ')" = "failed" ]; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s 未被 drain 成 failed"; exit 1; }
  sleep 2
done
FC=$(psql "$DB_URL" -tAc "SELECT result->>'failure_class' FROM tasks WHERE id='$TID'" | tr -d ' ')
[ -n "$FC" ] && [ "$FC" != "" ] || { echo "FAIL: result.failure_class 为空"; exit 1; }
echo "OK failure_class=$FC"
```

**硬阈值**: `result->>'failure_class'` 非 null 且 ∈ FAILURE_CLASSES；60s 内落库。

---

### Step 2: 新端点按根因计量失败率
**来源**: `[FROM_PRD]` — PRD 必须实现③、Golden Path 4

**可观测行为**: `GET /api/brain/harness/failure-stats?days=7` 返回 200，body 含数值 `failure_rate` + `by_class` 分组对象；`days` 非法返 400；空窗口返 200 + 空 by_class。

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/failure-stats?days=7") || { echo "FAIL: 非 200"; exit 1; }
echo "$RESP" | jq -e '(.failure_rate|type=="number") and (.by_class|type=="object") and (.total|type=="number")' || { echo "FAIL: schema 不符"; exit 1; }
# drift guard：禁用字段名不得出现在正向 schema
echo "$RESP" | jq -e 'has("failureRate")|not' || { echo "FAIL: 出现禁用字段 failureRate"; exit 1; }
# 400 error path
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/failure-stats?days=abc")
[ "$CODE" = "400" ] || { echo "FAIL: days=abc 未返 400（got $CODE）"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200 + `failure_rate` number + `by_class` object；`days=abc` → 400。

---

### Step 3: 上线后新 terminal harness 任务 failure_class IS NULL 归零（防回归观测口径）
**来源**: `[FROM_PRD]` — PRD 必须实现①收尾、Golden Path 5、验收断言③

**可观测行为**: 本 sprint 上线后新产生的 terminal（failed/blocked/cancelled）harness 任务中 `result->>'failure_class' IS NULL` 条数 = 0（历史 241 条不回填，故用时间窗划界）。

**验证命令**:
```bash
: "${DB_URL:?}"
# 以 E2E 脚本启动时刻为界，只看本轮之后新产生的 terminal harness 任务
NULLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks
  WHERE task_type IN ('harness_initiative','golden_path_proposal')
    AND status IN ('failed','blocked','cancelled')
    AND completed_at > '${SPRINT_START:?}'
    AND (result->>'failure_class') IS NULL" | tr -d ' ')
[ "$NULLS" = "0" ] || { echo "FAIL: 新 terminal harness 任务有 $NULLS 条 failure_class 为 null"; exit 1; }
echo "OK 新 terminal harness failure_class IS NULL = 0"
```

**硬阈值**: count = 0（`completed_at > SPRINT_START` 时间窗，防历史数据/回填干扰）。

---

### Step 4: 机械闸拦截裸 terminal 写入
**来源**: `[FROM_PRD]` — PRD 必须实现②、Golden Path 6、验收断言④

**可观测行为**: 真树跑 lint `exit 0`；故意注入一处不写 failure_class 的 terminal 写入 → lint `exit 1`。

**验证命令**:
```bash
# 真树：无裸写 → exit 0
node scripts/check-harness-terminal-failure-class.mjs || { echo "FAIL: 真树 lint 应 exit 0"; exit 1; }
# 自测：注入违规 fixture → lint 必 exit 1
bash scripts/__tests__/check-harness-terminal-failure-class.test.sh || { echo "FAIL: 机械闸自测未证明 exit 1 拦截"; exit 1; }
echo OK
```

**硬阈值**: 真树 exit 0；违规 fixture 触发 exit 1（自测脚本内断言）。

---

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（tasks.result）+ **状态机**（terminal 迁移）+ **跨模块数据传递**（各写入点 → failure-class SSOT 模块），故：

- 代码 ↔ `tasks` 表 `result` 列（本单改写全部 terminal 写入路径，[BEHAVIOR] 必须真 Postgres 验 `result->>'failure_class'` 落库，禁 mock pool/`pool.query`）
- 各 terminal 写入点（executor.js/dispatcher.js/harness-relay-watchdog.js/kernel-run-store.js）↔ `harness-failure-class.js` SSOT 模块（测试真 import，禁 stub `classifyFailure`/`FAILURE_CLASSES`/`buildTerminalFailureResult`）
- dispatcher/executor/watchdog ↔ 真 `tasks` 表终态迁移（[BEHAVIOR] Step 1 走真 dispatcher drain + 真 PG，不 mock 相邻状态机）

> 纯枚举/分类单测（`tests/harness-failure-class.test.js`）无 DB 边，真 import 被测模块即可，不涉本清单。需真 PG 的验证放 contract-dod.md [BEHAVIOR]（真 Brain 5221 + 真 psql），CI 由 brain-integration/Sprint Tests job 起真 Postgres 跑。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | ①全量 terminal harness 写入点强制写 `result.failure_class`(枚举)+`failure_detail`；②CI lint 机械闸拦裸写；③`GET /harness/failure-stats?days=N` 返 by_class+failure_rate |
| **NFR（做得多好）** | | 版本三处同步（硬约束）；端点单次 DB 聚合查询、只读；lint 秒级 |
| **Invariant（永不违反）** | | terminal harness 写入后 `result->>'failure_class'` 永非 null（unknown 兜底）；failure_class ∈ 冻结闭集；failure_detail 才装自由文本 |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | 枚举 SSOT 随 harness 演进增补成员（加成员不破坏兜底）；无 token/资源保质期 |
| **死亡告警（停了谁知道）** | | 机械闸失效 → CI lint job 红（required check）即刻可见；端点挂 → 依赖它的 7 天窗口日报断流可见 |
| **失败语义（挂了怎么办）** | | 见失败语义声明 |
| **效果确认（已发≠已生效）** | | Step 1 psql 查 `result->>'failure_class'` 非 null 回执；Step 2 curl 200+jq 断言；Step 4 lint exit code |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| 未识别 raw reason 归哪个 failure_class | A. throw 报错; B. 归 unknown 兜底 | B. 归 unknown | PRD 边界「枚举兜底」要求 IS NULL 归零；throw 会让 terminal 写入本身失败，比归错桶更糟 | 该失败暂归 unknown 桶，根因收敛精度下降（可后续细化映射，非静默丢数据/不可逆） |
| failure_rate 分母口径 | A. 全量 harness; B. 窗口内完结(failed+blocked+cancelled+completed) | B. 窗口内完结总数 | PRD 假设明确「分母=窗口内 harness_initiative 完结总数」 | 分母选错致失败率虚高/虚低，误导「7 天<25%」开锁闸判断 |

> 本任务无真机/RPA 接缝判定点（纯 Brain 后端/DB）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| SSOT `classifyFailure` 收到未知 reason | 归 `unknown`（不 throw） | 是（纯函数） | unknown 兜底，failure_detail 存原文 |
| terminal 写入时 result 合并失败（DB 异常） | 沿用现有 non-fatal 语义（executor 当前 markErr 非致命）+ 至少 error_message 落库 | 是（幂等 UPDATE by id） | 不阻断 terminal 状态落库；failure_class 缺失会被机械闸/口径②后续发现 |
| failure-stats 空窗口 | 返 200 + `by_class:{}`, `failure_rate:0` | 是（只读） | 不报错 |
| failure-stats DB 异常 | 返 500 + `{error}` | 是（只读） | 依 api_registry 500 惯例 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| `days` query param（内部只读端点） | 半可信 | N/A（非 LLM 输入） | 整数 1-365 校验，越界 400 |

> 本 sprint 无对外暴露 agent（内部 autonomous 后端），Prompt Injection 面 N/A。

---

## 真实链路四硬规则自查

- 规则 A（真实调用方 shape）: **N/A** — 无设备/agent 调服务端；端点是内部只读，触发 terminal 的是 Brain 内部代码路径（dispatcher/executor/watchdog），非外部调用方 shape。
- 规则 B（第三方真调一次）: **N/A** — 不依赖任何第三方 API。
- 规则 C（mock 豁免登记）: 见下「未覆盖真实链路清单」。
- 规则 D（target_environment 路由）: local_api 与 ability（纯 Brain 后端/DB）匹配，无微信/Android 真机段。

## 未覆盖真实链路清单

| 真实链路点 | 为什么 | 真验证补位计划 |
|---|---|---|
| `harness_attempts` 表 `recovery_without_session`（watchdog:936）attempt 级 terminal | 非 tasks 表 harness_initiative/golden_path_proposal terminal，超本 sprint 落点范围（PRD 只要求 tasks.result） | 若后续需 attempt 级失败可观测，另立交付物；本 sprint 机械闸白名单不含 harness_attempts 写入 |
| 历史 241 条 null | PRD 明确「历史 241 条 null 不回填」 | 不补位（口径②用 completed_at 时间窗划界，只保新数据归零） |

> 除上述登记项外，本合同 [BEHAVIOR] 均真 curl/真 psql/真 lint exec，无 mock 豁免。

---

## 已知约束（来自回归测试 + 累积 FR）

- context-manifest: unavailable（journey e6f803f2 两条 golden-path 均非 terminal，本 line 暂无累积 FR）[累积FR]
- 回归约束（PRD Invariant 逐条映射见 contract-dod.md INV 段）：
  - [local_api 验证形态] 合同已声明验证真相形态 = psql（DB 落库）+ curl（端点）→ 对 judge 闸⑤（meta_verification_gap，无 UI smoke）预先放行
  - [合同命令实跑] 已实跑：endpoint 现 404（红）、version-sync node -e exit 0、SSOT 模块 import ERR_MODULE_NOT_FOUND（红）
  - [台账不入库] 本 PR 仅提交 sprint 合同产物，不带 `.harness/progress.md`
  - [Deploy Preview 既有故障] 非 required，本 PR 不追修
  - [证据窗口排序] evaluator 侧义务，proposer 记录于此供 evaluator 遵循

---

## E2E 验收（final-e2e — target_environment=local_api，autonomous curl+psql）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?evaluator 须注入与 Brain(5221) 同库的 attempt DB_URL}"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
SPRINT_START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

# ── Step 2: 端点 schema + error path（先验，不依赖造数据）──
RESP=$(curl -sf "$BRAIN/api/brain/harness/failure-stats?days=7") || { echo "FAIL: failure-stats 非 200"; exit 1; }
echo "$RESP" | jq -e '(.failure_rate|type=="number") and (.by_class|type=="object") and (.total|type=="number")' \
  || { echo "FAIL: schema 不符 body=$RESP"; exit 1; }
echo "$RESP" | jq -e 'has("failureRate")|not' || { echo "FAIL: 禁用字段 failureRate 出现"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/harness/failure-stats?days=abc")
[ "$CODE" = "400" ] || { echo "FAIL: days=abc 应 400，got $CODE"; exit 1; }
echo "✅ Step2 端点 OK"

# ── Step 1: 真 dispatcher 边 + 真 PG 写 result.failure_class ──
TID=$(psql "$DB_URL" -tAc "INSERT INTO tasks (task_type,status,title,priority) VALUES ('harness_task','queued','[e2e] failure_class probe',3) RETURNING id" | tr -d ' ')
[ -n "$TID" ] || { echo "FAIL: 未能插入探针任务"; exit 1; }
DEADLINE=$((SECONDS+60))
until [ "$(psql "$DB_URL" -tAc "SELECT status FROM tasks WHERE id='$TID'" | tr -d ' ')" = "failed" ]; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s 探针未被 drain 成 failed"; exit 1; }
  sleep 2
done
FC=$(psql "$DB_URL" -tAc "SELECT result->>'failure_class' FROM tasks WHERE id='$TID'" | tr -d ' ')
[ -n "$FC" ] || { echo "FAIL: result.failure_class 为空"; exit 1; }
echo "✅ Step1 result.failure_class=$FC"

# ── Step 3: 上线后新 terminal harness 任务 failure_class IS NULL = 0 ──
NULLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks
  WHERE task_type IN ('harness_initiative','golden_path_proposal')
    AND status IN ('failed','blocked','cancelled')
    AND completed_at > '${SPRINT_START}'
    AND (result->>'failure_class') IS NULL" | tr -d ' ')
[ "$NULLS" = "0" ] || { echo "FAIL: 新 terminal harness 有 $NULLS 条 failure_class null"; exit 1; }
echo "✅ Step3 新 terminal harness failure_class IS NULL = 0"

# ── Step 4: 机械闸真树 exit 0 + 自测证明 exit 1 ──
node scripts/check-harness-terminal-failure-class.mjs || { echo "FAIL: 真树 lint 应 exit 0"; exit 1; }
bash scripts/__tests__/check-harness-terminal-failure-class.test.sh || { echo "FAIL: 机械闸自测未证明 exit 1"; exit 1; }
echo "✅ Step4 机械闸 OK"

# ── 版本三处同步 ──
node -e "const l=require('./package-lock.json'),p=require('./packages/brain/package.json'); if(l.packages['packages/brain'].version!==p.version) throw new Error('root lock 版本不同步'); console.log('✅ 版本同步 '+p.version)"

echo "✅ Golden Path 全程验证通过"
```

> `## E2E 验收` 段为 evaluator 模式 B（final-e2e）载体；harness_task 探针属退役 task_type，dispatcher tick drain 会稳定打成 failed（deterministic 真机边）。若目标库 `tasks` 有额外 NOT NULL 无默认列，evaluator 按实库补 INSERT 列（本脚本已含 task_type/status/title/priority）。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `GET /harness/failure-stats?days=0` / `days=-5` / `days=99999` / `days=7.5` → 期望 400，不得 500 或返脏数据
- 重复提交: 连续插入多条 harness_task 探针 → 每条都应独立写 failure_class，by_class 计数随之增长（幂等/无串扰）
- 中途中断: 探针 task 在 queued→failed 迁移窗口内被并发 tick 处理 → 不得出现 failure_class 半写（result 有 detail 无 class 或反之）
- 边界值: 空窗口（`days=1` 且窗口内无完结 harness）→ 200 + `by_class:{}`, `failure_rate:0`（非 500、非 null）；`failure_rate` 分母为 0 时不得 NaN/除零
发现分级: P0/P1（failure_class 落 null / 端点 500 / 除零 NaN / 机械闸可被绕过）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

> 测试棋盘登记表（Harness v5 — 测试金字塔守卫 A1 消费）：声明本 sprint 冻结测试文件与其
> BEHAVIOR 覆盖，供 `scripts/test-pyramid-guard.mjs` 认定为「已登记过渡测试」而非孤儿。
> 登记指向的是 commit 1 已冻结的契约测试文件本身，不改动其断言（CONTRACT IS LAW 不变）。

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ws1 | `tests/harness-failure-class.test.js` | FAILURE_CLASSES 冻结闭集含 unknown / isValidFailureClass 枚举校验 / classifyFailure 已知→枚举 & 未知→unknown / buildTerminalFailureResult 合并保留既有字段 & 非法 class 降级 unknown | → 全红（被测 SSOT 模块 `packages/brain/src/harness-failure-class.js` 尚未创建，import 失败无法加载） |
