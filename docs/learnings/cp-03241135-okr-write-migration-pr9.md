# OKR Write Migration PR9 — Learning

**Branch**: cp-03241135-okr-write-migration-pr9
**Date**: 2026-03-24
**PR**: OKR WRITE 迁移：将所有写操作（INSERT/UPDATE）从旧 goals/projects 表迁移到新 OKR 表

---

### 根本原因

PR1-PR8 只迁移了 SELECT 读操作，所有写操作（createInitiative, createScope, createProject, createGoal, updateGoal, executePlanAdjustment 等）仍然写入旧表 goals/projects。新 OKR 表（objectives, key_results, visions, okr_projects, okr_scopes, okr_initiatives）已经存在但没有数据写入，导致双表不一致。

---

### 迁移策略

**写操作路由规则**：
- `vision`/`mission` 类型 → `visions` 表
- `area_okr`/`global_kr` 类型 → `objectives` 表
- `area_kr` 类型 → `key_results` 表
- `type='project'` → `okr_projects` 表
- `type='scope'` → `okr_scopes` 表
- `type='initiative'` → `okr_initiatives` 表（需要 `scope_id` FK → `okr_scopes`）

**列映射**：
- `name` → `title`（RETURNING 时加 `title AS name` 兼容旧调用方）
- `deadline` → `end_date`（okr_projects）
- `sequence_order`/`current_phase`/`time_budget_days`/`repo_path`/`domain` → `metadata` JSONB

**UPDATE 降级模式**：先尝试新表，检查 `rowCount === 0`，再 fallback 到旧表。这样兼容历史数据。

---

### 关键陷阱

**1. okr_initiatives.scope_id FK 约束**

`createInitiative` 参数 `parent_id` 原来指向 `projects.id`，迁移后必须指向 `okr_scopes.id`。集成测试里 `createTestProject()` 生成的是 `projects.id`，不满足 FK 约束。

**修复**：将测试 helper 改为创建 `okr_projects` + `okr_scopes` 链，返回 `scope_id` 作为 `parent_id`。

**2. dod_content 双重序列化**

`dod_content` 在 metadata 存储时先 `JSON.stringify()`（字符串），metadata 本身也是 JSON。反序列化时 `meta.dod_content` 得到字符串而非对象。

**修复**：在 `createInitiative` 返回时对 `dod_content` 做 `JSON.parse()`：
```js
if (typeof initiative.dod_content === 'string') {
  try { initiative.dod_content = JSON.parse(initiative.dod_content); } catch (_) {}
}
```

**3. UPDATE fallback rowCount 检查**

Mock 返回 `{ rows: [] }` 没有 `rowCount` 属性。`undefined === 0` 是 `false`，所以不会触发 fallback。测试断言需要改为检查新表（`UPDATE okr_projects`/`UPDATE okr_initiatives`）而非旧表。

**4. metadata unpack 模式**

新表里 `domain`/`repo_path`/`sequence_order` 等字段存入 metadata JSONB。返回时必须 unpack：
```js
const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
return { ...row, ...meta };
```

**5. planner.test.js FK 违规**

`planner.test.js` 测试 KR 创建时往 `goals` 表插数据，但 `okr_projects.kr_id` FK 指向 `key_results(id)`，用 `goals.id` 会违反约束。必须改为往 `key_results` 插数据。

---

### 下次预防

- [ ] 迁移写操作时，先列出所有 FK 约束，确认 parent_id 语义变化
- [ ] 序列化存入 JSONB 的字段，返回时需同步反序列化（尤其是嵌套 JSON string）
- [ ] UPDATE fallback mock 必须返回 `rowCount: 1`（成功）或 `rowCount: 0`（触发 fallback）
- [ ] 集成测试的 helper 函数需要与生产代码一起更新，否则 FK 报错
- [ ] 迁移后验证：`SELECT COUNT(*) FROM okr_projects` 应该有数据写入
