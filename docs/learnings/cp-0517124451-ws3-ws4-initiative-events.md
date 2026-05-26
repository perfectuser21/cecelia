## ws3+ws4 initiative_run_events + HarnessDetailPage（2026-05-17）

### 根本原因
GAN 自动生成 ws3 代码时产生了实现偏差：ws3 DoD 要求后端（executor 写入 initiative_run_events），但生成的 PR #2986 实现了前端页面（HarnessStreamPage），且该页面连接到不存在的 Brain 路由 `/pipeline/${id}/stream`。ws4 未生成。Sprint_dir 检测 bug（B40）导致 GAN 卡死无法继续。

### 下次预防

- [ ] GAN 生成 PR 前，harness evaluator 应验证实现类型（后端 vs 前端）是否与 DoD scope 匹配
- [ ] 新增 SSE 路由时，必须同时在 Brain routes + Frontend URL 中使用一致的参数名
- [ ] migration 文件放在 `src/db/migrations/` 不会被主迁移系统自动执行，必须放 `migrations/NNN_*.sql`
- [ ] sprint_dir 正则匹配 `sprints/<subdirectory>/` 应排除 `tests` 目录（历史 test 文件污染检测）
- [ ] 两个独立 migration schema（010 vs 279）产生冲突，表达式如 `status='done'` vs `status='completed'`，需统一规范
