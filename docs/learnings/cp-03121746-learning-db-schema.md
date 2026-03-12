### [2026-03-12] Learning 系统 Task 1: DB schema 扩展 (migration 151)

**失败统计**：CI 失败 2 次，本地测试失败 0 次

**CI 失败记录**：

- 失败 #1：migration 号冲突
  - **根本原因**：没有先 fetch main 确认最大 migration 号，直接写了 150，而 main 上已有 `150_honest_kr_progress.sql`
  - **修复方式**：将文件重命名为 `151_learnings_type.sql`，同步更新 selfcheck.js / test / DEFINITION.md
  - **下次预防**：写新 migration 前先执行 `git fetch origin main && git show origin/main:packages/brain/migrations/ | sort | tail -3`

- 失败 #2：Learning/DoD 格式不对
  - **根本原因**：DoD 里引用了旧文件名（`150_learnings_type.sql`），且 Learning 文件缺少 CI 要求的格式章节
  - **修复方式**：更新 DoD 引用为 151，Learning 补充标准格式
  - **下次预防**：改文件名后必须同时更新 DoD 中所有引用该文件名的 Test 命令

**影响程度**: Low

**下次预防**（总结）：

- [ ] 写新 migration 前先 fetch main 确认最大号
- [ ] 改文件名后检查 DoD 里是否有硬编码的旧文件名引用
- [ ] Learning 格式要包含：根本原因 + 修复方式 + 下次预防 + checklist
