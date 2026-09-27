# 设计：验证层探针/判定回执/格子颜色投影到 Notion 驾驶舱（链 bf5088a3 棒4-2）

任务 bf8d6ffb · 决策 10a68212（主理人 09-27 拍板）· 实施决策 2bf970ff

## 问题

验证层三样证据只在 Brain Postgres，Notion 驾驶舱看不到：

| 真身 | 现状 | 缺口 |
|---|---|---|
| `step_probes`（5 行） | 无记账列，无血管 | 无 Notion 库 |
| `journey_assertion_receipts`（business_probe_runner 4 行） | 无记账列；表 append-only 触发器挡一切 UPDATE | 无 Notion 库；记账列回写会被触发器拒 |
| `journey_step_links.cell_status`（283 格子行） | `pushJourneyStepLinks` 过滤 `cell_kind IS NULL`，格子行从未推过；表无 `updated_at`；推的 `Journey`/`Step` 列在库里不存在 | Backbone-Step Map 库 0 行，翻色不同步 |

## 方案（选定）

沿用三面模型的统一引擎 `pushRegisteredRows`（指纹去重 / PATCH 或 POST / 回写记账列），不自造推送。

### 1. 迁移 478 `notion_projection_probe_receipts`

- `step_probes` / `journey_assertion_receipts` 各加 `notion_id text` / `notion_synced_at timestamptz` / `notion_digest text`（IF NOT EXISTS）。
- 回执表 append-only 触发器函数 `prevent_journey_assertion_receipt_mutation` 改写：`TG_OP='UPDATE'` 且 `to_jsonb(NEW) - 'notion_id' - 'notion_synced_at' - 'notion_digest'` 等于 `to_jsonb(OLD)` 同样去列 → `RETURN NEW`；否则照旧 RAISE。业务语义（证据不可改）不变，只放行投影记账。
- `journey_step_links` 加 `updated_at timestamptz NOT NULL DEFAULT now()`；新触发器 `trg_touch_journey_step_links_updated_at`（BEFORE UPDATE）：非记账列（去 notion_* 与 updated_at 后的 jsonb）有变化才 `NEW.updated_at := now()`。引擎回写 `notion_synced_at` 不会抬 updated_at，避免自激重推。
- `notion_projection_map` 登记两行（direction push / status active / vessel `notion-probe-projection.pushStepProbes|pushProbeReceipts`），id 由建库脚本产出后写入迁移；回滚脚本删列、还原触发器、删登记。

### 2. 建库脚本 `scripts/ops/create-probe-notion-dbs.js`

幂等：`POST /search` 按 title 找「探针」「判定回执」，有则复用并 `ensureProps` 补列；无则在「数据落脚总台账」页（`3dbc40c2-ba63-810e-b96f-f7523838b411`）下 `POST /databases`。列定义集中在 `ops-notion-schema.js`（`PROBE_DB_PROPS.step_probes` / `.probe_receipts` / `.step_links`），推送时 `ensureOpsDbProps` 缺列即补（Notion 缺列 400 的血训）。

| 库 | 列（类型） |
|---|---|
| 探针 | 探针键(title) / 工作流(select) / 步骤(select) / 查什么(rich_text) / 期望(rich_text) / 严重级(select) / 启用(checkbox) / 哈希前缀(rich_text) / 关联格子(rich_text) / 说明(rich_text) |
| 判定回执 | 名称(title) / 时间(date) / 批次(rich_text) / 路径名(rich_text) / 步骤名(rich_text) / 探针(rich_text) / 读回(rich_text) / 期望(rich_text) / 判定(select PASS|FAIL) / 严重级(select) / 原因(rich_text) |
| Backbone-Step Map（既有） | 补 CellKind(select) / CellKey(rich_text) / CellStatus(select) / AssertionRef(rich_text) / Journey(relation→AI Journey) |

### 3. 新模块 `packages/brain/src/notion-probe-projection.js`

- `buildStepProbeProps(row)`、`buildProbeReceiptProps(row)`、`stripCrontabPrefix(runId)` 纯函数。
- `pushStepProbes(pool, token)`：`resolveDbId(pool,'step_probes')` 无则跳过；补列；SELECT `step_probes ⋈ journey_step_links(cell_key) ⋈ journeys(name)`，`WHERE notion_synced_at IS NULL OR updated_at > notion_synced_at` LIMIT 50。
- `pushProbeReceipts(pool, token)`：只 `executor_kind='business_probe_runner'`；行不可变 → `notion_synced_at IS NULL` 增量，`ORDER BY completed_at DESC LIMIT 50`；批次 = run_id 去 `<workflow>-crontab-` 前缀；路径名 = journeys.name；步骤名 = cell_key；探针 = assertion_ref_snapshot 去 `probe:`；读回/期望/严重级/原因取 `scenario_evidence`。
- `runProbeProjection(pool, {token})` 两根血管各自 try/catch，不连坐；`runNotionPushSync` 末尾以动态 import 挂接（同 relay projection 写法）。

### 4. `pushJourneyStepLinks` 改造（notion-push-sync.js 原地）

- SELECT：`(l.notion_synced_at IS NULL OR l.updated_at > l.notion_synced_at) AND j.notion_id IS NOT NULL`，不再排除格子行、不再要求 step notion_id；`ORDER BY l.updated_at LIMIT 50`（283 行约 30 分钟排空，之后每轮只有变化行）。
- props：Name = `journey — cell_key|step_name`、Status、Order（有列才发）、CellKind/CellKey/CellStatus/AssertionRef（格子行）、Journey relation；先 `ensureOpsDbProps` 补列。
- 指纹不变的行只抬 synced（引擎已有），cell_status 翻色 → 触发器抬 updated_at → 指纹变 → PATCH。

### 5. 守夜与对账

- A7：两表已登记，不报红。A9：无新常量。A10：回执只给业务行写 notion_id，Brain 计数 = Notion 页数。

### 6. 测试

- 单测 `notion-probe-projection.test.js`：探针行/回执行渲染列齐；非 business 行不出现在 SELECT；指纹相同不打 Notion；库未登记整段跳过；批次前缀剥离。
- 单测 `notion-push-sync.test.js` 更新：格子行进入 SELECT、带 `updated_at > notion_synced_at`、LIMIT 50。
- 迁移 478 结构断言（up/down）。
- smoke `notion-probe-projection-smoke.sh`（node 假池 + 假 notionReq，登记 allowlist）：三根血管端到端走一遍 + 接线钉子。

### 不做

- harness 代码断言回执（brain_assertion_runner）不投影。
- 不改 Backbone-Step Map 既有 Phase/Legacy Step/Step 1 列。
- 不动版本五件套，条目走 `changes/cp-0927093533-notion-probe-proj.md`。
