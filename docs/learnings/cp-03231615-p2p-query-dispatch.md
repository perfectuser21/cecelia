# Learning - Cecelia P2P 查询能力：信息性问题派 explore 任务+回调回飞书

**Branch**: cp-03231615-p2p-query-dispatch
**PR**: #1445

### 根本原因

`thalamus.js` 提示词规则过于保守：信息性查询（"zenithjoy dashboard 现在有什么"）被分类为 `handle_chat`，`mouth` 生成假回复"我去查一下"但实际没有派出任何任务。同时 ops.js P2P handler 在创建 `explore` 任务后没有注册 `task_interest` 订阅，导致任务完成时无法触发飞书回调。execution.js 的 task_interest 回调即使触发，也因未传递 `findings` 导致通知内容为空。

### 解决方案

三层修复形成完整链路：
1. **thalamus.js 规则 7**：信息性查询 → `create_task(task_type='explore')`，而非 `handle_chat`
2. **ops.js task_interest 注册**：explore 任务派出后写入 `working_memory.task_interest:<task_id>`，利用已有订阅机制触发回调
3. **execution.js findings 透传**：task_interest 回调时从 `payload.findings` 读取探查结果，传入 `notifyTaskCompletion`

### 下次预防

- [ ] 扩展 thalamus 分类规则时，需同时考虑"信息性查询"和"任务指令"两类用户意图
- [ ] P2P 流程中任何"派任务后需要回调"的场景，应统一使用 `task_interest` 订阅模式
- [ ] execution.js task_interest 回调中，`notifyTaskCompletion` 调用需包含 `result: findings` 字段

### 架构收获

`task_interest` 订阅模式是 Brain 中已有的轻量异步回调机制（`working_memory` + execution callback），适合"用户问 → 任务跑 → 结果发回"的场景，无需新建 webhook 或轮询机制。
