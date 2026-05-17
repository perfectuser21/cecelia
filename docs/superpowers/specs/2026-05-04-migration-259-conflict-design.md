# Brain Migration 259 冲突修复 设计文档

**日期**：2026-05-04
**分支**：cp-0504093222-brain-migration-259-conflict
**Task ID**：c8638840-0989-41c0-a502-ecea32c4e49b

---

## 问题根因

`migrate.js` 按文件名排序，取 `file.split('_')[0]` 作为版本号，写入 `schema_version` 表并作为幂等去重 key。

两个文件同号 `259`：
- `259_account_usage_auth_fail_count.sql`（字母序靠前）→ 先跑，版本 `259` 写入 DB
- `259_license_system.sql`（字母序靠后）→ 版本 `259` 已存在，被跳过

结果：`licenses` 表和 `license_machines` 表从未创建。

---

## 修复方案

重命名 + 更新所有版本号引用：

| 操作 | 文件 | 变更 |
|------|------|------|
| git mv | `migrations/259_license_system.sql` → `migrations/260_license_system.sql` | |
| 更新注释 | `migrations/260_license_system.sql` 第 1 行 | `Migration 248` → `Migration 260` |
| 更新常量 | `src/selfcheck.js` 第 23 行 | `'259'` → `'260'` |
| 更新文档 | `DEFINITION.md` 第 444 行 | `Schema 版本: 259` → `Schema 版本: 260` |
| 更新测试 | `src/__tests__/selfcheck.test.js` | `'259'` → `'260'`（2 处）|
| 更新测试 | `src/__tests__/learnings-vectorize.test.js` | `'259'` → `'260'`（1 处）|

---

## 安全性分析

- `259_license_system.sql` 所有语句均为 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`，**幂等**
- 以 `260` 身份重新执行不会破坏已有数据
- `259_account_usage_auth_fail_count.sql` 保持不变，生产数据库已有版本号 `259` 记录，不会被重复执行

---

## 测试策略

**类型**：fix PR（非 feat），不需要 smoke.sh。

- **Unit tests**（已有）：`selfcheck.test.js` + `learnings-vectorize.test.js` — 更新期望值即可
- **Integration test**（CI 验证）：`brain-integration` job 起真 postgres + 跑 migrate.js，migration 260 会被真实执行，`licenses` 表创建成功

DoD `[BEHAVIOR]` 验证：
```bash
# selfcheck.js 已更新
node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8'); if(!c.includes(\"'260'\")) process.exit(1)"

# 260 文件存在，259_license 不存在
node -e "require('fs').accessSync('packages/brain/migrations/260_license_system.sql')"
node -e "try{require('fs').accessSync('packages/brain/migrations/259_license_system.sql');process.exit(1)}catch(e){}"
```

---

## 成功标准

- `schema_version` 表最高版本从 `259` 变为 `260`（下次 migrate.js 执行后）
- `licenses` 和 `license_machines` 表被创建
- CI brain-unit + brain-integration 全绿
