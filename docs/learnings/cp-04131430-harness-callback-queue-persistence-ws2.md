### 根本原因

WS2 实现了 callback queue 持久化的核心逻辑：
- 将原 routes/execution.js 中约 2800 行的 execution-callback 处理逻辑提取为共享函数 `processExecutionCallback`（callback-processor.js）
- 新建 callback-worker.js 轮询 callback_queue，2 秒一次，每批 10 条
- HTTP 端点改造为 INSERT callback_queue + 立即返回 200（响应 <500ms）
- DB INSERT 失败时降级为直接调用 processExecutionCallback（兼容边缘情况）
- task result 使用 `CASE WHEN result IS NULL` 条件写入，配合 `WHERE status='in_progress'` 保证幂等

### 下次预防

- [ ] 大文件提取时用 python/sed 删除旧 handler body，避免遗留 if(false) 语法死代码
- [ ] worker 行数据中无 _meta 的情况（直接 INSERT 测试行）需 graceful 处理
- [ ] callback_queue 表依赖 WS1 migration，WS2 PR 要在 WS1 合并后才能完整验证
