# Sprint Contract Draft (Round 1) — Crystal 第4件:结晶判官

**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 独立小路（无父路）— 本 line（journey e6f803f2）首个 ability，PRD「累积 FR」标注本 line 暂无历史，无父 Golden Path。

> 上下文加载说明（Step 1.0 / 1.3）：
> - Unified Map：task.payload.map_scope=["F1"] 但 map_repo=null → 半径未配置，标 `[MAP_NOT_CONFIGURED]`，不回退领域硬编码。
> - context-manifest：`GET /api/brain/line/e6f803f2-.../context-manifest` 不可达 → `context-manifest: unavailable`。
> - contract-gate：`packages/brain/src/lib/contract-gate.js` 存在（cecelia worktree）→ 代码层 Contract Gate 生效，本合同断言按「合规惯用法速查表」书写。
> - gp-anchor: skipped (product-map.json not found)。
> - PRD 正文来源：bundle 无 thin_prd/prep_prd_body → 以 sprints/09052209-kernel-6b8ad6ed/sprint-prd.md 为准。

---

## Response Schema（推导来源: [NEW_PATTERN] — api_registry 无同名端点，全新 crystal 端点；沿用 Brain `{ok:true,...}` / `{error:string}` 惯例）

### Endpoint: POST /api/brain/crystal/run
触发结晶判官：对 OpenClaw leadgen 八格逐格聚合六项指标 → 落结晶台账 → 出三态判决 → 生成每日报告。同步执行，幂等（同日重跑按 (report_date,grid_key) upsert 并刷新 created_at）。
**Success (HTTP 200)**:
```json
{"ok": true, "report_date": "2026-09-05", "grid_count": 8, "verdicts": [{"grid_key": "og1", "verdict": "keep_llm"}]}
```
- `ok` (bool, 必填): 固定 true — [NEW_PATTERN]
- `report_date` (string YYYY-MM-DD, 必填): 本次判官运行归属日期 — [NEW_PATTERN]
- `grid_count` (int, 必填): 本次落台账/判决的格数，固定 8（OpenClaw 八格）— [NEW_PATTERN]
- `verdicts` (array, 必填): 每格 {grid_key, verdict}，verdict ∈ {keep_llm,promote,demote} — [NEW_PATTERN]
**禁用字段名**: `success`（本组端点统一用 `ok`，禁 `success` 混用）、`grids`（用 `verdicts`）、`status`（顶层禁用，避免与 task status 混淆）
**Error (HTTP 4xx/5xx)**:
```json
{"error": "<string>"}
```

### Endpoint: GET /api/brain/crystal/report （可选 ?date=YYYY-MM-DD，缺省=最近一日）
**Success (HTTP 200)**:
```json
{"ok": true, "report_date": "2026-09-05", "grid_count": 8,
 "suggestions": [{"grid_key": "og1", "verdict": "keep_llm", "basis": {"rule": "data_insufficient"},
   "metrics": {"n_runs": 0, "success_rate": null, "token_cost": 0, "latency_ms": null, "new_branch_rate": 0, "broken_count": 0}}],
 "data_gaps": ["og1"]}
```
- `ok` (bool, 必填): true — [NEW_PATTERN]
- `report_date` (string, 必填) — [NEW_PATTERN]
- `grid_count` (int, 必填): 8 — [NEW_PATTERN]
- `suggestions` (array 长度=8, 必填): 每格 {grid_key, verdict, basis, metrics(六项指标)} — [NEW_PATTERN]
- `metrics` 六项字段（必填 keys）: `n_runs`,`success_rate`,`token_cost`,`latency_ms`,`new_branch_rate`,`broken_count`
- `data_gaps` (array, 必填): 数据缺口格号清单（可空数组）— [NEW_PATTERN]
**Error (HTTP 404)**: 当日无报告 → `{"error": "no_report_for_date"}`

### Endpoint: POST /api/brain/crystal/locator （registry 回写）
Body: `{"model":"claude","app_version":"4.1.8","density":"1.0","locator":{...}}`
**Success (HTTP 200)**: `{"ok": true, "key": "claude|4.1.8|1.0"}`
- `key` (string, 必填): `model|app_version|density` 复合键回显 — [NEW_PATTERN]
**Error (HTTP 400)**: 缺 model/app_version/density 任一 → `{"error": "missing_registry_key_component"}`

### Endpoint: POST /api/brain/crystal/evidence/validate （证据留存规范校验）
Body: `{"filename":"og1__trial3__20260905T221000Z.png"}` 或 `{"filename":"...","existing":["...已存在名..."]}`
**Success (HTTP 200)**: `{"ok": true, "trial": 3, "timestamp": "20260905T221000Z"}`
**Error (HTTP 400)**: 文件名缺 trial 或 timestamp → `{"error": "evidence_filename_missing_trial_or_timestamp"}`
**Error (HTTP 409)**: filename 命中 existing（复用覆盖）→ `{"error": "evidence_filename_overwrite_forbidden"}`

---

## 已知约束（来自回归测试 + 累积 FR）

- 回归测试：本 sprint 关键词（结晶/判官/台账/晋升/降级）在 `packages/brain/src` 无既有测试文件（新能力）；`sequencer_ledger`(第81批) 是回家序列器监工裁定台账（run_id/stage_id/verdict），与本 sprint 的技能蒸馏结晶指标无表重叠，**不复用**，另建 `crystal_*` 表。
- 累积 FR：`context-manifest: unavailable`；PRD 累积 FR 段声明本 line 暂无历史 → 无需防回退既有行为。
- must_run_assertions: `[MAP_NOT_CONFIGURED]`（map_repo 未配置，无地图强制断言注入）。

## 假设澄清（补齐 PRD 四条 ASSUMPTION）

- 数据源（n8n execution_entity / HK 裁决流水采集器 / postcondition 结果）本地库未落表（外部/尚未接入）→ 判官**只读、best-effort 拉取**，取不到即该格 `data_gap=true / n_runs=0`，**报告标注数据缺口，不误判**（PRD 边界情况③）。判官对源只读，本 sprint 只写 `crystal_*` 表（NFR 数据完整性）。
- 与第81批无台账重复：`sequencer_ledger` 语义不同（harness 阶段裁定），本 sprint 另建 `crystal_ledger`。
- **固化成本基线**（ASSUMPTION 补齐）：`crystallizeCostBaseline = 200000`（token 当量占位常量，写进 `CRYSTAL_THRESHOLDS`）。judgment-pending-user: 固化成本基线常量值待主理人/决策确认（见 notes）。
- **降级阈值**（ASSUMPTION 补齐，取 PRD 建议保守默认）：`demoteWindowDays = 7`，`demoteBreaks = 3`（7 天碎 3 次 → 降级）。

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（新建 crystal_ledger / crystal_verdict / crystal_report / crystal_locator_registry 四表并写入）与 **跨模块数据传递**（判官 crystal-judge.js ↔ pool，聚合结果 → 判决引擎 → 报告），据 v9.12 硬规则，failing 验证不得 mock 被改的边：

- `crystal-judge.js` ↔ Postgres（本单新增写路径）：DB 写落库由 contract-dod.md 的 [BEHAVIOR] 在**真实 Brain(localhost:5221) + 真 Postgres(`$DATABASE_URL`)** 上验（B-01/B-04/B-05），禁 mock pool。
- 判决引擎 `verdict-engine.js` 为**纯函数**（不碰 DB，环境无关逻辑断言）→ 冻结 vitest 覆盖其分支，不涉接缝边，无需真 PG。
- 生成侧若另写 DB 单测：必须走真 Postgres（integration 命名/位置），禁用 `vi.mock('../db.js')` / stub pool 顶替 crystal_* 写路径。

（判决引擎的纯逻辑测试属逻辑断言；DB 落库属接缝断言，二者分层，接缝层在真目标验。）

## 接缝清单（接缝 vs 逻辑）

| # | 接缝点 | 真目标验证方式 | done 判定 |
|---|---|---|---|
| 1 | 判官写 crystal_ledger/verdict/report 四表 | 真 Brain 触发 + 真 Postgres 计数（时间窗防伪） | B-01/B-04 真验通过才 done |
| 2 | registry 回写复合键落 crystal_locator_registry | 真 Brain POST + 真 Postgres 读回（时间窗） | B-05 真验通过才 done |
| 3 | 数据源 best-effort 只读（外部源未落本地表） | 逻辑降级为 data_gap（源不可得=数据缺口，非成功/失败） | logic-done（源接入前无真目标，data_gap 路径真验） |

> 说明：本 sprint 全部落在 packages/brain 后端 + 本地 Postgres，无真机 RPA / 生产 env 接缝；接缝 3 的外部源接入不在本 sprint 范围（PRD 假设①源只读、未落本地表）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR** | 系统承诺 | 触发判官→八格聚合六项指标落结晶台账→每格出三态判决(带依据)→生成每日结晶报告(可 curl 查询) |
| **NFR** | 做得多好 | 数据完整性：源只读不改；可入库门槛：无 postcondition 不许入库晋升；可观测：数据缺口/判决写库并可 curl 见；超时/频控：PrepPRD 未指定，判官同步执行 + scheduler 每日窗口去重 |
| **Invariant** | 永不违反 | 见 contract-dod.md INV-1..6（判定层不蒸馏 / 探针强制 / registry是数据 / 证据留痕 / 固化优先级 / DIRTY路由 N/A） |
| **判定点** | 怎么知道 | 见下方登记表 |
| **保质期** | 何时过期 | 每日报告按 report_date 分日；台账/判决保留（供降级 7 天窗口回看）；locator registry 值由运行时探针守护、可覆盖更新 |
| **死亡告警** | 停了谁知道 | 判官 scheduler 未跑 → 当日无 crystal_report 行；数据缺口/判决失败写 Brain log（PRD NFR 可观测）；nightly seven-ring-audit 巡检可扩展读该表（本 sprint 不改巡检） |
| **失败语义** | 挂了怎么办 | 见下方声明 |
| **效果确认** | 已发≠已生效 | 触发后以「真 Postgres 计数(时间窗) + report 端点 8 格建议」为回执，非「HTTP 200 即成功」 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳 | 静默丢消息 |
| ⚠️ 某格是否「数据缺口」vs 真实零活动 | A. 源拉取异常/超时=缺口; B. 拉到空集=真零 | 拉取失败/源不可达=data_gap；拉到空且源可达=n_runs=0（真零，仍 keep_llm） | PRD 边界③：源空不得误判为成功/失败 | 误判缺口为真零→漏判/漏晋升；误判真零为缺口→掩盖低活跃 |
| 某格是否已固化（is_hardened，决定是否走降级分支） | A. 查 skill_registry.status; B. 判官入参显式标注 | best-effort 读固化状态，未知按未固化（不触发降级） | 未固化件无「碎」语义 | 误判未固化为固化→误降级（但本 sprint 不自动执行，人拍板兜底） |
| 证据文件名重名 | A. 静默覆盖; B. 视为异常计 broken | B. 计 broken/异常，禁覆盖 | PRD 边界④ + INV-4 | 静默覆盖→证据丢失不可追溯 |

> ⚠️ 行属「升拍板点主动请教用户」级别；judgment-pending-user 见 notes。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 数据源不可达/超时 | 该格 data_gap=true, n_runs=0, 判 keep_llm；写 Brain log | 是（幂等键 (report_date,grid_key) upsert） | 报告标注 data_gaps，不误判成功/失败 |
| 判决引擎异常（单格） | 记该格失败进 log，不阻断其余格；该格不入判决表 | 是（重跑覆盖） | 报告 grid_count 反映实际入库格数 |
| 无 postcondition 的技能 | 不入库晋升（INV-2），判 keep_llm basis=no_postcondition | 是 | 保持纯 LLM |
| 证据文件名缺 trial/timestamp 或重名 | evidence 端点 400/409；判官内部计 broken | 是 | 禁覆盖，异常计入 broken_count |

### 输入对抗面

> N/A：本 sprint 端点为 Brain 内部管理 API（判官触发/报告查询/registry 回写/证据校验），非对外暴露的用户/agent 可写入口，无 Prompt Injection 面。

---

## Golden Path

[每日定时触发判官] → [聚合台账（八格六指标）] → [出三态判决（带依据）] → [生成每日结晶报告落库] → [人 curl 当日报告对建议拍板]

### Step 1: 触发结晶判官（定时 or 手动 POST /crystal/run）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步「Brain 定时任务触发结晶判官，对 OpenClaw leadgen 八格逐格/逐技能拉取数据源」。
**可观测行为**: `POST /api/brain/crystal/run` 返回 `{ok:true, report_date, grid_count:8, verdicts:[8]}`；scheduler-jobs.js 注册 `crystal-judge`（北京窗口 + working_memory 当日去重）走同一 `runCrystalJudge()`。
**验证命令**:
```bash
curl -sfS -X POST localhost:5221/api/brain/crystal/run -H 'content-type: application/json' -d '{}' | jq -e '.ok==true and .grid_count==8 and (.verdicts|length==8)'
```
**硬阈值**: HTTP 200 且 grid_count==8 且 verdicts 长度 8。

---

### Step 2: 聚合结晶台账（八格 × 六项指标落库）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步「六项指标写入结晶台账：N 次 / 成功率 / token 成本 / 时延 / 新分支率 / broken_count」。
**可观测行为**: 触发后 `crystal_ledger` 当日八格各一行，含六项指标列；源空的格 data_gap=true / n_runs=0（不误判）。
**验证命令**:
```bash
psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -tAc "SELECT count(*) FROM crystal_ledger WHERE created_at > NOW() - interval '5 minutes'"
# 期望：8
```
**硬阈值**: 本轮（5 分钟时间窗内）新建/刷新台账行数 == 8。

---

### Step 3: 出三态判决（每格有且仅有 1 条，带触发依据）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步「判决引擎对每格套三态规则出具判决并记录触发依据」。
**来源**: `[AI_ADDED]` — 判决落 `crystal_verdict` 独立表 + UNIQUE(report_date,grid_key)，理由：保证「每格有且仅有 1 条判决」可机检、防重复判决绕过。
**可观测行为**: `crystal_verdict` 当日八格各一行，verdict ∈ {keep_llm,promote,demote}，basis 非空 JSON；N<20 的格必为 keep_llm。
**验证命令**:
```bash
psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -tAc "SELECT count(*) FROM crystal_verdict WHERE created_at > NOW() - interval '5 minutes' AND verdict IN ('keep_llm','promote','demote') AND basis <> '{}'::jsonb"
# 期望：8
```
**硬阈值**: 三态合规且带依据的判决行 == 8。

---

### Step 4: 生成每日结晶报告并落库（可经 Brain API 查询）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步「生成每日结晶报告（建议晋升/降级/保持 + 依据指标）落库，可经 Brain API 查询」。
**可观测行为**: `GET /api/brain/crystal/report` 返回 `{ok:true, grid_count:8, suggestions:[8], data_gaps:[]}`，每条 suggestion 含 grid_key/verdict/basis/metrics(六项)。
**验证命令**:
```bash
curl -sfS localhost:5221/api/brain/crystal/report | jq -e '.ok==true and (.suggestions|length==8) and (.report_date!=null) and all(.suggestions[]; .grid_key and (.verdict|test("^(keep_llm|promote|demote)$")) and .basis and (.metrics|has("n_runs") and has("success_rate") and has("token_cost") and has("latency_ms") and has("new_branch_rate") and has("broken_count")))'
```
**硬阈值**: 报告 8 格建议，每格三态 + 依据 + 六项指标齐全。

---

### Step 5: 配套 — registry 回写 + 证据留存规范
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步「证据留存规范（trial+timestamp 文件名、禁覆盖）；registry 回写（视觉定位成功 → 自动写回 registry，key=model|app_version|density）」。
**可观测行为**:
- `POST /api/brain/crystal/locator` 以 (model,app_version,density) 复合键 upsert 落 `crystal_locator_registry`；缺任一键 → 400。
- `POST /api/brain/crystal/evidence/validate` 校验文件名带 trial+timestamp（缺 → 400），命中 existing（复用覆盖）→ 409。
**验证命令**:
```bash
curl -sfS -X POST localhost:5221/api/brain/crystal/locator -H 'content-type: application/json' -d '{"model":"claude","app_version":"4.1.8","density":"1.0","locator":{"x":1}}' | jq -e '.ok==true'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:5221/api/brain/crystal/evidence/validate -H 'content-type: application/json' -d '{"filename":"nogood.png"}'); [ "$CODE" = "400" ]
```
**硬阈值**: locator 写回 ok==true；缺 trial/timestamp 的文件名返 400。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api，本地 curl + psql）

**journey_type**: autonomous
**target_environment**: local_api

> 单 bash 块。打真实 Brain（localhost:5221，候选代码已带 433 migration + crystal 路由/判官）+ 真 Postgres（`$DATABASE_URL`，缺省 cecelia 库）。
> 全部 psql 计数带 `created_at/updated_at > NOW() - interval '5 minutes'` 时间窗（防历史数据冒充；contract-gate db-time-window 合规）。
> Kernel identity late-bound：本脚本无固定 attempt/capability UUID，触发身份由 Runner 注入的 HARNESS_* 决定（此处无需引用）。

```bash
#!/bin/bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PSQL_DB="${DATABASE_URL:-postgresql://localhost/cecelia}"

# 1. 触发结晶判官（同步：聚合→判决→报告）
RUN=$(curl -sfS -X POST "$BRAIN/api/brain/crystal/run" -H 'content-type: application/json' -d '{}')
echo "$RUN" | jq -e '.ok==true and .grid_count==8 and (.verdicts|length==8)' >/dev/null || { echo "FAIL: /crystal/run 未返回八格"; exit 1; }

# 2. 结晶台账八格落库（六项指标非空 + 时间窗防伪）
LC=$(psql "$PSQL_DB" -tAc "SELECT count(*) FROM crystal_ledger WHERE created_at > NOW() - interval '5 minutes'")
[ "$LC" = "8" ] || { echo "FAIL: 台账行数=$LC 期望 8"; exit 1; }
BADCOL=$(psql "$PSQL_DB" -tAc "SELECT count(*) FROM crystal_ledger WHERE created_at > NOW() - interval '5 minutes' AND (n_runs IS NULL OR broken_count IS NULL)")
[ "$BADCOL" = "0" ] || { echo "FAIL: 台账六项指标缺列 n_runs/broken_count"; exit 1; }

# 3. 三态判决：八格各 1 条、三态合规、带依据（时间窗）
VC=$(psql "$PSQL_DB" -tAc "SELECT count(*) FROM crystal_verdict WHERE created_at > NOW() - interval '5 minutes' AND verdict IN ('keep_llm','promote','demote') AND basis <> '{}'::jsonb")
[ "$VC" = "8" ] || { echo "FAIL: 合规判决行=$VC 期望 8"; exit 1; }
DUP=$(psql "$PSQL_DB" -tAc "SELECT count(*) FROM (SELECT grid_key FROM crystal_verdict WHERE created_at > NOW() - interval '5 minutes' GROUP BY grid_key HAVING count(*) > 1) d")
[ "$DUP" = "0" ] || { echo "FAIL: 存在重复判决格"; exit 1; }

# 4. N<20 的格判决必为 keep_llm（数据不足不晋升；时间窗 join）
BADN=$(psql "$PSQL_DB" -tAc "SELECT count(*) FROM crystal_verdict v JOIN crystal_ledger l ON l.report_date=v.report_date AND l.grid_key=v.grid_key WHERE v.created_at > NOW() - interval '5 minutes' AND l.n_runs < 20 AND v.verdict <> 'keep_llm'")
[ "$BADN" = "0" ] || { echo "FAIL: 存在 N<20 却非 keep_llm 的判决"; exit 1; }

# 5. 每日结晶报告端点：八格建议 + 三态 + 依据 + 六项指标
REP=$(curl -sfS "$BRAIN/api/brain/crystal/report")
echo "$REP" | jq -e '.ok==true and (.suggestions|length==8) and (.report_date!=null) and all(.suggestions[]; .grid_key and (.verdict|test("^(keep_llm|promote|demote)$")) and .basis and (.metrics|has("n_runs") and has("success_rate") and has("token_cost") and has("latency_ms") and has("new_branch_rate") and has("broken_count")))' >/dev/null || { echo "FAIL: 报告 schema 不合规"; exit 1; }

# 6. registry 回写（复合键 model|app_version|density）+ 真 Postgres 读回（时间窗）
curl -sfS -X POST "$BRAIN/api/brain/crystal/locator" -H 'content-type: application/json' -d '{"model":"claude","app_version":"4.1.8","density":"1.0","locator":{"x":1,"y":2}}' | jq -e '.ok==true' >/dev/null || { echo "FAIL: locator 写回未 ok"; exit 1; }
RC=$(psql "$PSQL_DB" -tAc "SELECT count(*) FROM crystal_locator_registry WHERE model='claude' AND app_version='4.1.8' AND density='1.0' AND updated_at > NOW() - interval '5 minutes'")
[ "$RC" = "1" ] || { echo "FAIL: registry 无本轮记录（复合键落库失败）"; exit 1; }

# 7. 证据留存规范：缺 trial+timestamp → 400；合规名 → 200
C400=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/crystal/evidence/validate" -H 'content-type: application/json' -d '{"filename":"screenshot.png"}')
[ "$C400" = "400" ] || { echo "FAIL: 缺 trial+timestamp 未返 400（got $C400）"; exit 1; }
curl -sfS -X POST "$BRAIN/api/brain/crystal/evidence/validate" -H 'content-type: application/json' -d '{"filename":"og1__trial3__20260905T221000Z.png"}' | jq -e '.ok==true and .trial==3' >/dev/null || { echo "FAIL: 合规证据文件名未通过"; exit 1; }
C409=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/crystal/evidence/validate" -H 'content-type: application/json' -d '{"filename":"og1__trial3__20260905T221000Z.png","existing":["og1__trial3__20260905T221000Z.png"]}')
[ "$C409" = "409" ] || { echo "FAIL: 复用覆盖未返 409（got $C409）"; exit 1; }

echo "✅ Crystal 结晶判官 Golden Path 验证通过（台账8 + 判决8三态 + 报告 + registry + 证据规范）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `POST /api/brain/crystal/locator` 传 `{"model":"claude"}`（缺 app_version/density）→ 应 400，不得静默写半键；`POST /crystal/evidence/validate` 传 `{"filename":123}`（非字符串）→ 400 不崩。
- 重复提交: 同日连点两次 `POST /crystal/run` → crystal_ledger/verdict 仍各 8 行（upsert 幂等，不翻倍），crystal_report 当日仍 1 行。
- 中途中断: `/crystal/run` 执行中再次触发 → 不产生重复格或半写状态（幂等键保护）。
- 边界值: grid n_runs 恰=20 / success_rate 恰=0.90 / broken_count 恰=3 的判决边界；token_cost=0 时不误晋升。
发现分级: P0/P1（误晋升固化 / 漏判降级 / 台账丢格 / 源被判官写坏）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 三态判决 + 证据规范 + 八格常量（纯逻辑，冻结） | `sprints/09052209-kernel-6b8ad6ed/tests/crystal-verdict.test.ts` | promote when N over 20 success over 90 zero new branch postcondition cost over baseline / keep_llm when N under 20 data insufficient / keep_llm when new branch rate over zero variant unconverged / keep_llm no postcondition even if metrics qualify probe mandatory / judgment layer never harden keep_llm / demote when hardened and broken count reaches threshold within window / crystallize priority equals frequency times failure rate / build evidence filename contains trial and timestamp / assert no overwrite throws on duplicate filename / openclaw leadgen grids has exactly eight grids | 模块 `packages/brain/src/crystal/{verdict-engine,evidence,grids}.js` 不存在 → import 失败 → 全部 FAIL |

## GP-Anchor

gp-anchor: skipped (product-map.json not found)
