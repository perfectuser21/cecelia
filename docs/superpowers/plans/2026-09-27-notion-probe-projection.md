# 验证层探针/回执/格子颜色投影到 Notion 实施计划（链 bf5088a3 棒4-2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `step_probes` 全行、`journey_assertion_receipts` 业务探针行、`journey_step_links` 格子颜色三样验证层证据经既有投影引擎推到 Notion 驾驶舱，且格子翻色可更新。

**Architecture:** 迁移 478 给三表补记账列/`updated_at`/触发器放行；新模块 `notion-probe-projection.js` 用 `pushRegisteredRows` 推两库；`pushJourneyStepLinks` 改为格子行增量可更新；两库由脚本在「数据落脚总台账」页下机器建，id 种进迁移的 `notion_projection_map`。

**Tech Stack:** Node ESM、pg、vitest、Notion API 2022-06-28。

## Global Constraints

- 禁碰版本五件套；条目写 `changes/cp-0927093533-notion-probe-proj.md`（`## Brain {VERSION} — 标题`）。
- TDD：每个 task 先红后绿；commit-1 test / commit-2 impl；Conventional Commits。
- 只投 `executor_kind='business_probe_runner'` 回执；不改 Backbone-Step Map 既有列。
- 新增 smoke 必须登记 `packages/quality/smoke-allowlist.txt`。
- 凭据：`source ~/.credentials/notion.env`（NOTION_API_KEY），禁猜禁回显。

---

### Task 1: 列定义 + 建库脚本（机器路径）

**Files:**
- Modify: `packages/brain/src/ops-notion-schema.js`（追加 `PROBE_DB_PROPS`、`buildStepLinkDbProps`）
- Create: `scripts/ops/create-probe-notion-dbs.js`

**Interfaces:**
- Produces: `PROBE_DB_PROPS.step_probes`、`PROBE_DB_PROPS.probe_receipts`（Notion properties 定义）、`buildStepLinkDbProps(journeyDbId)`；脚本输出 `{ probes_db, receipts_db }` id。

- [ ] **Step 1:** 在 `ops-notion-schema.js` 末尾加：

```js
/** 验证层两库（链 bf5088a3 棒4-2）：列名按主理人口径中文；推送时缺列即补。 */
export const PROBE_DB_PROPS = {
  step_probes: {
    '探针键': { title: {} }, '工作流': { select: {} }, '步骤': { select: {} },
    '查什么': { rich_text: {} }, '期望': { rich_text: {} }, '严重级': { select: {} },
    '启用': { checkbox: {} }, '哈希前缀': { rich_text: {} }, '关联格子': { rich_text: {} },
    '说明': { rich_text: {} },
  },
  probe_receipts: {
    '名称': { title: {} }, '时间': { date: {} }, '批次': { rich_text: {} },
    '路径名': { rich_text: {} }, '步骤名': { rich_text: {} }, '探针': { rich_text: {} },
    '读回': { rich_text: {} }, '期望': { rich_text: {} }, '判定': { select: {} },
    '严重级': { select: {} }, '原因': { rich_text: {} },
  },
};
/** Backbone-Step Map 库（journey_step_links 镜子）格子列 + Journey relation；既有列不动。 */
export function buildStepLinkDbProps(journeyDbId) {
  return {
    CellKind: { select: {} }, CellKey: { rich_text: {} }, CellStatus: { select: {} },
    AssertionRef: { rich_text: {} },
    Journey: { relation: { database_id: journeyDbId, single_property: {} } },
  };
}
```

- [ ] **Step 2:** 写 `scripts/ops/create-probe-notion-dbs.js`（照 `create-ops-notion-dbs.js`：search by title 复用 → 否则 POST /databases，parent = 总台账页 `3dbc40c2-ba63-810e-b96f-f7523838b411`；复用时 ensureProps 补列；末尾打印两库 id）。
- [ ] **Step 3:** 运行 `bash -c 'source ~/.credentials/notion.env; node scripts/ops/create-probe-notion-dbs.js'`，记下 id。
- [ ] **Step 4:** Commit `feat(brain): 验证层两库列定义 + 建库脚本`。

### Task 2: 迁移 478 + 回滚 + 结构测试

**Files:**
- Create: `packages/brain/migrations/478_notion_projection_probe_receipts.sql`
- Create: `packages/brain/migrations/rollback/478_notion_projection_probe_receipts.down.sql`
- Test: `packages/brain/src/__tests__/migration-478-notion-projection-probe-receipts.test.js`

- [ ] **Step 1:** 测试断言：三表 ADD COLUMN IF NOT EXISTS notion_id/notion_synced_at/notion_digest（step_probes、journey_assertion_receipts）；journey_step_links updated_at + `trg_touch_journey_step_links_updated_at`；`prevent_journey_assertion_receipt_mutation` 含 `TG_OP = 'UPDATE'` 与 `- 'notion_id' - 'notion_synced_at' - 'notion_digest'`；INSERT INTO notion_projection_map 两行 brain_table step_probes / journey_assertion_receipts；schema_version '478'；down 脚本 DROP COLUMN + DROP TRIGGER + DELETE 登记 + DELETE schema_version。
- [ ] **Step 2:** `cd packages/brain && npx vitest run src/__tests__/migration-478-*.test.js` → 红。
- [ ] **Step 3:** 写迁移（触发器函数用 `to_jsonb(NEW) - 'notion_id' - 'notion_synced_at' - 'notion_digest'` 比对）与回滚。
- [ ] **Step 4:** 测试绿；本地 `DB_NAME=cecelia_scratch` 跑 up/down/up 验证 SQL 可执行。
- [ ] **Step 5:** Commit。

### Task 3: 新模块 notion-probe-projection.js

**Files:**
- Create: `packages/brain/src/notion-probe-projection.js`
- Test: `packages/brain/src/__tests__/notion-probe-projection.test.js`

**Interfaces:**
- Produces: `buildStepProbeProps(row)`, `buildProbeReceiptProps(row)`, `buildStepLinkNotionProperties(row, schemaProps)`, `stripCrontabPrefix(runId)`, `pushStepProbes(pool, token, deps)`, `pushProbeReceipts(pool, token, deps)`, `runProbeProjection(pool, {token, logSyncError})`。

- [ ] **Step 1:** 测试（mock `../recurring-notion-sync.js`）：
  - 探针行渲染：探针键/工作流/步骤/查什么含 `sql@pg_zenithjoy`/期望 `>= metrics.videos_processed`/严重级/启用/哈希前缀 8 位/关联格子含 cell_key。
  - 回执行渲染：批次 `auto09262230__a1.delivery`（去 `social-keyword-leadgen-crontab-`）/ 探针 `videos_readback` / 读回 `6` / 期望 `7` / 判定 FAIL / 原因 value_mismatch / 时间。
  - 业务行过滤：`pushProbeReceipts` 的 SELECT 含 `executor_kind = 'business_probe_runner'`。
  - 库未登记 → 不查表不打 Notion。
  - 指纹去重：已有 notion_id 且 digest 相同 → 不 PATCH，只抬 synced。
  - 格子行 props：CellStatus=pending、CellKey、AssertionRef、Journey relation；非格子行无 Cell* 键。
- [ ] **Step 2:** 红。
- [ ] **Step 3:** 实现模块。
- [ ] **Step 4:** 绿；Commit。

### Task 4: pushJourneyStepLinks 增量可更新 + 主链接线

**Files:**
- Modify: `packages/brain/src/notion-push-sync.js:1101-1137`、`runNotionPushSync` 末尾
- Test: `packages/brain/src/__tests__/notion-push-sync.test.js:147`（改合同）+ 新增接线断言

- [ ] **Step 1:** 改测试：格子行不再排除；SELECT 含 `l.updated_at > l.notion_synced_at` 与 `LIMIT 50`；源码含 `runProbeProjection`。红。
- [ ] **Step 2:** 实现：SELECT 改增量、`ensureOpsDbProps(token, dbId, buildStepLinkDbProps(JOURNEY_DB))`、buildProps 走 `buildStepLinkNotionProperties`；主链末尾动态 import `runProbeProjection`。
- [ ] **Step 3:** 全量 `npx vitest run src/__tests__/notion-push-sync.test.js src/__tests__/task-run-notion-projection.test.js src/__tests__/notion-probe-projection.test.js` 绿；Commit。

### Task 5: smoke + allowlist + changes 碎片 + DoD + DevGate

**Files:**
- Create: `packages/brain/scripts/smoke/notion-probe-projection-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`、`.dod.md`
- Create: `changes/cp-0927093533-notion-probe-proj.md`

- [ ] **Step 1:** smoke（node 假池+假 notionReq）：探针 POST→回写→二次跳过；回执 SELECT 业务过滤+渲染；格子行 digest 变→PATCH；接线钉子（notion-push-sync 含 `runProbeProjection`、`l.updated_at > l.notion_synced_at`；迁移 478 存在）。`bash packages/brain/scripts/smoke/notion-probe-projection-smoke.sh` PASS。
- [ ] **Step 2:** allowlist 登记；changes 碎片；`.dod.md` 重写（≥1 [BEHAVIOR]，manual: 命令 CI 兼容）。
- [ ] **Step 3:** DevGate：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs` 全绿。
- [ ] **Step 4:** Commit；push；PR；前台等 CI；merge。

### Task 6: 上产验证 + 回写

- [ ] Brain 自动部署后查 `notion_projection_map`/三表 notion_id 回填；Notion「探针」5 行、「判定回执」≥4 行、Backbone-Step Map 有 `stage:delivery` CellStatus=pending。
- [ ] PATCH 任务 completed（pr_url / merged / 两库 id）。
