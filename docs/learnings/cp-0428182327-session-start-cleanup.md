## session-start.sh 删除 queued 任务注入（2026-04-28）

### 根本原因

session-start.sh 在每次 session 开始时向 context 注入"排队中 dev 任务"列表，导致 Claude 每次对话都预加载一份 to-do list。这不是 session hook 的职责——session context 应只包含**当前状态**（in_progress 任务 + 系统健康），不应包含任务调度队列。

### 下次预防

- [ ] session-start.sh 只注入**当前运行时状态**，不注入调度队列
- [ ] 需要 queued 任务列表时，通过 `curl localhost:5221/api/brain/tasks?status=queued` 按需查询
- [ ] contract 测试（brain-api-integration.test.ts）应与 session-start.sh 实际调用的端点严格对应，避免死契约积累
- [ ] 删除功能时同步删除配套测试 case，防止空壳测试遗留
