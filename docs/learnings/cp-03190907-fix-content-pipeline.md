# Learning: 修复 content-pipeline API failed_at 字段错误

## 根本原因

`routes/content-pipeline.js` GET 查询 SELECT 了 `failed_at` 字段，但 tasks 表从未定义该列。orchestrator 在 pipeline 失败时写 `status='failed', completed_at=NOW()`，用 `completed_at` 表示结束时间，无需单独的 `failed_at`。

## 下次预防

- [ ] 写 SQL SELECT 时先确认列名存在于 schema（`psql -c "\d tasks"` 检查）
- [ ] BEHAVIOR 类 DoD test 不能用 `curl localhost` — CI 环境没有运行的 Brain，应改为引用已有单元测试文件（`Test: tests/...`）
- [ ] 添加前台展示 `failed_at` 字段时，同步检查后端 SQL 是否实际返回该字段
