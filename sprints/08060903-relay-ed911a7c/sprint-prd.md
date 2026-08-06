# Sprint PRD — [F6加厚] WS2 Notion事件采集器MVP: 个人Inbox→capture_atoms（双token幂等）

**Task ID**: ed911a7c-d975-4986-bfe5-24d8318838a2  
**Sprint Dir**: sprints/08060903-relay-ed911a7c  
**Date**: 2026-08-06  
**Base Repo**: perfectuser21/cecelia  
**Target Environment**: local_api  
**Review Required**: true  

---

## 背景

PR #4661 已合并（F6 inbox homing golden path），`notion-capture-ingest.js` + migration 388 已落库。但代码审查发现遗留 blocker：

**核心 Bug**：`capture-inbox.js` 第60-67行 `pushCapture` 函数中：
- `captures` 表：有 `ON CONFLICT (dedupe_key) DO UPDATE` → 幂等 ✅  
- `capture_atoms` 表：无条件 INSERT，无冲突处理 → 每次调用都插入新 atom ❌

当同一 Notion 页面被编辑后再次采集：
1. `captures` ON CONFLICT → 返回同一 `captureId`（幂等）
2. `capture_atoms` 无冲突处理 → 又插入一条新 atom（**重复**）

---

## 功能需求（FR）

| # | 需求 | 验收标准 |
|---|------|----------|
| FR-1 | `capture_atoms` INSERT 增加幂等处理 | `ON CONFLICT (capture_id, target_type) DO NOTHING`；同一 `(capture_id, target_type)` 组合已存在时跳过，不产生新行 |
| FR-2 | 新增 migration 为 `capture_atoms(capture_id, target_type)` 添加 UNIQUE 约束 | migration 文件编号 390（或下一可用编号），`UNIQUE(capture_id, target_type)`，配合 `schema_version` 记录 |
| FR-3 | 补 `capture-inbox.test.js` 幂等回归测试 | mock pool 断言：同一 `dedupeKey` 二次调用 `pushCapture` 不触发第二次 `capture_atoms` INSERT（仅触发一次）；测试 commit 进 repo 永久保留 |
| FR-4 | DEFINITION.md 凭据来源修正 | 将"凭据来源 CCAPI2026（AI Hub workspace）"改为"凭据来源 Notion-juke（bot=cc20260728, workspace=Zenithjoy-July）" |
| FR-5 | Brain 容器 env 配置生产凭据（L2）| `docker-compose.yml` 的 `environment` 段添加 `NOTION_INBOX_TOKEN=${NOTION_INBOX_TOKEN:-}` 和 `NOTION_INBOX_DB_ID=${NOTION_INBOX_DB_ID:-b45ca2cb-9c90-83f1-bc41-81ad0b86c1b1}` |
| FR-6 | L3 smoke 验证（真实 Notion Inbox）| 写测试页 → 10分钟内 `psql` 查到对应 atom → 重复触发采集 → 不产生第二条 atom |

---

## 铁律不变式（Invariants）

| # | 不变式 |
|---|--------|
| INV-1 | `capture_atoms` 幂等：同 `(capture_id, target_type)` 不得产生第二条记录 |
| INV-2 | 幂等回归测试必须 commit 进 repo 永久保留（regression），不允许删除 |
| INV-3 | DEFINITION.md 凭据来源必须与实际 1Password 条目名称一致（Notion-juke） |
| INV-4 | 不得修改已有 Golden Path 断言（仅修复 bug，不改合同基线） |
| INV-5 | `notion-capture-ingest.js` 的凭据注释须同步更新，从 `~/.credentials/notion-ccapi2026.env` 改为 `Notion-juke` |

---

## 实现计划（按顺序）

### Step 1 — Migration（新建文件）

**文件**：`packages/brain/migrations/390_capture_atoms_dedup_constraint.sql`（取最新可用编号，当前最高为389）

```sql
-- Migration 390: capture_atoms (capture_id, target_type) UNIQUE 约束
-- 修复 F6加厚 遗留 bug：pushCapture 对 capture_atoms 无幂等处理
-- 同一 (capture_id, target_type) 组合只允许存在一条 atom

ALTER TABLE capture_atoms
  ADD CONSTRAINT uq_capture_atoms_capture_target
  UNIQUE (capture_id, target_type);

INSERT INTO schema_version (version, description)
VALUES ('390', 'capture_atoms unique(capture_id,target_type) — F6加厚幂等修复')
ON CONFLICT (version) DO NOTHING;
```

> 注：若当前生产库已有重复数据，migration 前需先去重（留一条最旧的）。去重 SQL 见 Step 1b（由执行体负责检查是否需要）。

### Step 2 — 代码修复

**文件**：`packages/brain/src/capture-inbox.js`，第63-66行

将：
```js
const { rows } = await pool.query(
  `INSERT INTO capture_atoms (capture_id, content, target_type, target_subtype, routed_to_table, routed_to_id, lane)
   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
  [captureId, truncated, targetType, targetSubtype, routedToTable, routedToId, lane]
);
```

改为：
```js
const { rows } = await pool.query(
  `INSERT INTO capture_atoms (capture_id, content, target_type, target_subtype, routed_to_table, routed_to_id, lane)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT (capture_id, target_type) DO NOTHING
   RETURNING id`,
  [captureId, truncated, targetType, targetSubtype, routedToTable, routedToId, lane]
);
```

注意：`ON CONFLICT DO NOTHING` 时 `RETURNING id` 返回空数组，需确保调用方容忍 `atomId = null`（现有逻辑 `rows[0]?.id ?? null` 已处理）。

### Step 3 — 回归测试

**文件**：`packages/brain/src/__tests__/capture-inbox.test.js`，追加新测试用例：

```js
describe('pushCapture 幂等（F6加厚回归）', () => {
  it('同一 dedupeKey 二次调用 pushCapture 只触发一次 capture_atoms INSERT', async () => {
    // 首次调用：captures INSERT 返回 captureId，capture_atoms INSERT 成功
    // 二次调用：captures ON CONFLICT 返回同一 captureId，capture_atoms ON CONFLICT DO NOTHING 跳过
    let captureAtomInsertCount = 0;
    const pool = {
      query: vi.fn().mockImplementation((sql) => {
        if (/INSERT INTO capture_atoms/.test(sql)) {
          captureAtomInsertCount++;
          // 首次成功，二次 DO NOTHING（返回空 rows）
          return Promise.resolve({ rows: captureAtomInsertCount === 1 ? [{ id: 'atom-1' }] : [] });
        }
        // captures INSERT
        return Promise.resolve({ rows: [{ id: 'cap-1' }] });
      }),
    };
    const args = {
      content: '测试页面标题',
      source: 'notion',
      dedupeKey: 'notion:inbox:test-page-id',
      notionPageId: 'test-page-id',
      targetType: 'notes',
      targetSubtype: 'notion_inbox',
    };
    // 首次采集
    const r1 = await pushCapture(pool, args);
    expect(r1?.captureId).toBe('cap-1');
    expect(r1?.atomId).toBe('atom-1');
    const atomInsertCountAfterFirst = captureAtomInsertCount;

    // 二次采集（同一页面）
    const r2 = await pushCapture(pool, args);
    expect(r2?.captureId).toBe('cap-1'); // 同一 capture
    // capture_atoms INSERT 只被调用了一次（第二次 DO NOTHING）
    expect(captureAtomInsertCount).toBe(atomInsertCountAfterFirst); // 不增加
  });
});
```

### Step 4 — DEFINITION.md 修正

**文件**：`DEFINITION.md`，第25行

将：
```
凭据来源 CCAPI2026（AI Hub workspace）
```
改为：
```
凭据来源 Notion-juke（bot=cc20260728, workspace=Zenithjoy-July）
```

### Step 5 — notion-capture-ingest.js 注释同步

**文件**：`packages/brain/src/notion-capture-ingest.js`，第7-8行注释

将：
```
 * 凭据（均从 process.env 读取，来源 ~/.credentials/notion-ccapi2026.env）：
```
改为：
```
 * 凭据（均从 process.env 读取，来源 1Password CS "Notion-juke"，bot=cc20260728）：
```

### Step 6 — docker-compose.yml 生产配置（L2）

**文件**：`docker-compose.yml`，Brain 容器 `environment` 段，在 `BARK_TOKEN` 行附近追加：

```yaml
      # Notion Inbox 采集凭据（来源 1Password CS "Notion-juke"）
      - NOTION_INBOX_TOKEN=${NOTION_INBOX_TOKEN:-}
      - NOTION_INBOX_DB_ID=${NOTION_INBOX_DB_ID:-b45ca2cb-9c90-83f1-bc41-81ad0b86c1b1}
```

### Step 7 — L3 Smoke 验证（真实 Notion）

**前置**：在宿主机 `~/.credentials/notion-juke.env`（或等效位置）配置 `NOTION_INBOX_TOKEN`，并通过 `docker-compose.yml` 注入。

**验证步骤**：
1. 在 Notion Inbox 数据库（`b45ca2cb-9c90-83f1-bc41-81ad0b86c1b1`）新建测试页面，标题：`F6加厚-smoke-test-{timestamp}`
2. 等待最多10分钟（或手动调用 `runNotionCaptureIngest`）
3. 验证：
   ```sql
   SELECT ca.id, c.notion_page_id, ca.target_type, ca.created_at
   FROM capture_atoms ca
   JOIN captures c ON c.id = ca.capture_id
   WHERE c.dedupe_key LIKE 'notion:inbox:%'
   ORDER BY ca.created_at DESC LIMIT 5;
   ```
   预期：看到新增一条 `target_type='notes'` 的 atom
4. 再次触发采集（编辑页面标题后等5分钟，或再次手动调用）
5. 验证：上述 SQL 对同一 `notion_page_id` 不出现第二条 atom

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/brain/migrations/390_capture_atoms_dedup_constraint.sql` | 新建 | UNIQUE 约束 migration |
| `packages/brain/src/capture-inbox.js` | 修改 | capture_atoms INSERT 加 ON CONFLICT DO NOTHING |
| `packages/brain/src/__tests__/capture-inbox.test.js` | 修改 | 追加幂等回归测试 |
| `DEFINITION.md` | 修改 | 凭据来源 CCAPI2026 → Notion-juke |
| `packages/brain/src/notion-capture-ingest.js` | 修改 | 注释同步凭据来源 |
| `docker-compose.yml` | 修改 | 添加 NOTION_INBOX_TOKEN / NOTION_INBOX_DB_ID env |

---

## DevGate 检查点

改动包含 `packages/brain` 代码，执行前必须通过：
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```

---

## 验收门（DoD）

- [ ] INV-1：`psql` 对同一 Notion 页面二次采集后，`capture_atoms` 记录数不增加
- [ ] INV-2：`capture-inbox.test.js` 幂等测试用例存在于 repo 且 CI 绿色
- [ ] INV-3：`DEFINITION.md` 中"Notion-juke"字样出现，"CCAPI2026"不再出现（notion 相关段落）
- [ ] INV-4：已有 Golden Path 测试（captures 幂等、pushCaptureAtom 两次 query 断言）全部通过
- [ ] INV-5：`notion-capture-ingest.js` 注释不再引用 `notion-ccapi2026.env`
- [ ] FR-5（L2）：`docker-compose.yml` 包含 NOTION_INBOX_TOKEN / NOTION_INBOX_DB_ID
- [ ] FR-6（L3 smoke）：真实 Notion Inbox 页面在 10 分钟内写入 atom，重复采集不产生第二条

---

## 版本号

本次修复对应 Brain 版本 bump（patch），目标版本由 DevGate `check-version-sync.sh` 校验。

---

## NFR

- 非功能需求：幂等修复不得引入性能回归（ON CONFLICT 无额外往返，符合）
- 凭据不得提交 git；docker-compose.yml 使用 `${VAR:-}` 占位符形式
- L3 smoke 脚本由 evaluator 在 local_api 环境执行（NOTION_INBOX_TOKEN 已在宿主配置）

---

## 参考

- PR #4661（F6 inbox homing golden path，已合并）
- Migration 388：`packages/brain/migrations/388_captures_notion_page_id.sql`
- Migration 199：`packages/brain/migrations/199_capture_atoms_events.sql`（capture_atoms 表定义）
- `packages/brain/src/capture-inbox.js`（bug 位置：第60-73行）
- `packages/brain/src/notion-capture-ingest.js`（注释需同步）
- 1Password CS item "Notion-juke"（bot=cc20260728, workspace=Zenithjoy-July）

---

journey_type: feature_fix
target_environment: local_api
