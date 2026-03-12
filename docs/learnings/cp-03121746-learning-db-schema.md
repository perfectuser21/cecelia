### [2026-03-12] Learning 系统 Task 1: DB schema 扩展 (migration 151)

**失败统计**：CI 失败 3 次，本地测试失败 0 次

#### 根本原因

1. **migration 号冲突**：写 migration 150 之前没有先 fetch main 确认最大号，导致与同期合入的 `150_honest_kr_progress.sql` 冲突
2. **DoD 硬编码文件名**：DoD Test 命令引用了 `150_learnings_type.sql`，文件改名后 DoD 自动失败
3. **Learning 章节格式**：使用了粗体而非 Markdown 标题，CI 的 `grep -qE "^#{1,4}..."` 无法匹配

#### 修复方式

- 将 migration 重命名为 `151_learnings_type.sql`，同步更新 selfcheck.js / selfcheck.test.js / DEFINITION.md
- 更新 DoD 所有 Test 命令中的文件名引用
- Learning 使用 `####` 标题而非粗体

#### 下次预防

- [ ] 写新 migration 前先：`git fetch origin main && git show origin/main:packages/brain/migrations/ | sort | tail -3`
- [ ] 改文件名后立即全局搜索 DoD 里的旧文件名引用
- [ ] Learning 格式：根本原因/下次预防/预防措施必须用 Markdown 标题（`####`），不能用粗体
