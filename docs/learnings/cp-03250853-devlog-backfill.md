# Learning: DevLog 数据接通 — dev_records 历史回填 + PR merge fallback

**Branch**: cp-03250853-devlog-backfill
**Date**: 2026-03-25

## 完成内容

1. 新建 `packages/brain/src/scripts/backfill-dev-records.js` — 从 GitHub `gh pr list` 批量写入 dev_records（50条/次）
2. 修改 `packages/brain/src/pr-callback-handler.js` — 无任务匹配时写 dev_records（task_id=null，no-task fallback）
3. 执行回填：dev_records 从 0 → 50 条，DevLog API 恢复有数据

### 根本原因

Brain DB 是新部署的最小化实例，只有 16 条测试任务，无 pr_url 字段数据。pr-callback 虽已有 dev_records 写入逻辑，但依赖 task 匹配，匹配失败则直接返回，导致 dev_records 永远为空。

GitHub 有 1528 条合并 PR 历史，是唯一可用的回填数据源。通过 `gh pr list --json` 直接获取 PR 元数据，绕过 task 匹配依赖，是正确解法。

无 task 匹配的 fallback 路径（task_id=null 写入）确保未来所有 PR merge 都会被记录，不再依赖 task 数据完整性。

### 下次预防

- [ ] 新部署 Brain 后，立刻运行 backfill-dev-records.js 填充历史数据
- [ ] dev_records 表应在 pr_url 上加 UNIQUE 约束，避免回填重复插入（当前用 SELECT 检查）
- [ ] pr-callback 的 fallback 路径需要集成测试覆盖
