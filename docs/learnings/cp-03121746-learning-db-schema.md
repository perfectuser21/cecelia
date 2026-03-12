### [2026-03-12] Learning 系统 Task 1: DB schema 扩展 (migration 151)

**失败统计**：CI 失败 1 次（migration 号冲突），本地测试失败 0 次

**CI 失败记录**：
- 失败 #1：migration 150 与 main 合并进来的 `150_honest_kr_progress.sql` 号码冲突 → 将 migration 改为 151，同步更新 selfcheck.js / test / DEFINITION.md → 下次先 `git fetch origin main && ls migrations/15*.sql` 验证号码再写新 migration

**影响程度**: Low

**预防措施**：
- 写新 migration 前先拉 main 确认最大号码：`git fetch origin main && git show origin/main:packages/brain/migrations/ | sort | tail -5`
- 按 MEMORY.md 陷阱记录：CI 冲突会导致 PR 状态变 CONFLICTING，必须先 merge main 才能重新触发
