# Learning: MAX_SEATS 重启状态日志 + 并发天花板评估

## 任务
feat(executor): MAX_SEATS 重启状态日志 + 并发天花板评估报告

## 变更摘要
- `packages/brain/server.js`: 启动时打印 MAX_SEATS/INTERACTIVE_RESERVE 配置
- `packages/brain/server.js`: syncOrphanTasksOnStartup 日志扩展为 found/requeued/rebuilt/failed 四字段
- `packages/brain/src/routes.js`: 新增 GET /api/brain/capacity 端点
- `packages/brain/src/__tests__/capacity-endpoint.test.js`: 新增测试

### 根本原因
Brain 启动时 MAX_SEATS 天花板无可见性，orphan 恢复汇总日志字段不全，导致运维排查困难。

### 下次预防
- [ ] 新增容量配置常量时，同步在 server.js 启动日志中打印
- [ ] 函数返回多字段汇总时，日志应覆盖所有字段（不仅 > 0 时打印）
- [ ] executor.js 新增 export 后，检查 routes.js 是否需要新增对应查询端点
