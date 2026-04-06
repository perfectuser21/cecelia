# Learning: 并行 PR migration 版本冲突 — topic_suggestions 表从未建立

**任务**: [选题闭环] 基于数据驱动的AI自动选题引擎  
**分支**: cp-04052343-f343fa2a-f1f6-444c-9020-03d183  
**PR**: #1946  
**日期**: 2026-04-06

---

### 根本原因

PR #1942 新增 `packages/brain/migrations/215_topic_suggestions.sql`，但同期 PR #1941 也合并了 `215_content_analytics.sql`，两者版本号均为 215。

migration runner 按文件名顺序处理，`215_content_analytics.sql` 先执行后写入 `schema_version(version='215')`，导致 `215_topic_suggestions.sql` 被 `appliedSet.has('215')` 匹配跳过。

结果：`topic_suggestions` 表从未创建，选题审核 API 静默报错。

---

### 下次预防

- [ ] 并行 PR 在各自分支确认 migration 版本号未被其他进行中 PR 占用
- [ ] facts-check 已有 `migration_conflicts` 检查（重复版本号 → FAIL），pre-push hook 会拦截
- [ ] 新建 migration 时先 `ls migrations/*.sql | sort | tail -3` 确认最高版本号
- [ ] 并行开发时通过 Brain `decisions` 表协调版本号分配

---

### 修复步骤

1. 重命名 `215_topic_suggestions.sql` → `216_topic_suggestions.sql`（版本号改为 216）
2. 直接 `psql cecelia -f migrations/216_topic_suggestions.sql` 建表
3. `selfcheck.js` EXPECTED_SCHEMA_VERSION '215' → '216'
4. DEFINITION.md schema_version 同步更新
5. 同步更新 `selfcheck.test.js` 和 `learnings-vectorize.test.js` 中的版本断言
