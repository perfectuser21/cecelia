# Learning: 夜间自驱引擎 v1 实现

## 根本原因

Brain 现有的 self-drive.js 专注于"基于健康分析创建任务"，但缺乏"调度现有待办任务"的机制，导致任务队列堆积、人工编排周期长。

## 解决方案

新建 `nightly-orchestrator.js` 与 self-drive 互补：
- self-drive: 创建任务（基于 LLM 健康分析）
- nightly-orchestrator: 调度执行（基于启发式评分，无 LLM 成本）

## 设计决策

- [ ] isNightWindow() 使用跨午夜判断（20:00-08:00 UTC），逻辑：`hour >= START || hour < END`
- [ ] 评分启发式：priority（0-100） + 任务龄（+0.5/h，max 24） + 任务类型（dev/review +10）
- [ ] 派发标记：在 tasks.payload 中写 `dispatched_by_orchestrator + 日期`（幂等）
- [ ] 容量感知：从 getMaxStreams() 读取，减去当前 in_progress 数量
- [ ] 早报：07:00 UTC 写入 daily_logs，type=nightly_orchestration

## 下次预防

- [ ] 新调度模块测试 isNightWindow 时注意模块有 db.js 依赖，不能直接 import 测试 — 改用文件内容检查
- [ ] 新增调度器在 server.js 初始化时要用 try/catch + non-fatal，防止启动阻塞
