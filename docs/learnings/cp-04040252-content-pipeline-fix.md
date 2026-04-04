# Learning: Brain content executor 阻塞事件循环 + Scanner 能力误判

**任务**: fix(brain): 修复 Scanner success_rate 误报 + content executor 阻塞 Brain 事件循环  
**PR**: #1871  
**日期**: 2026-04-04

### 根本原因

**问题 1: Scanner ability 误判（false positive）**

`capability-scanner.js` 中 `collectSkillActivity` 遍历 `related_skills` 时，每次循环都直接赋值 `health.success_rate`（last-wins 语义）。当一个能力有多个关联 skill 时，最后一个 skill 的 success_rate 会覆盖之前所有 skill 的值。

具体案例："OKR 执行流程 - 端到端" 有两个 skill：
- `/dev`: total=51, completed=27 → success_rate=52%
- `/review`: total=1, completed=0 → success_rate=0%（覆盖了前者）

最终 success_rate=0 < 30 → 误判为 `failing` → 触发无限 SelfDrive 自修复循环（每轮创建多个诊断任务）。

**问题 2: Content executor 阻塞 Brain 事件循环**

`tick.js` 中 `await executeQueuedContentTasks()` 同步等待，而 `executeQueuedContentTasks` 内部调用 `executeResearch()` 等函数，这些函数使用 `execSync` 执行外部命令：
- `execSync('notebooklm research wait --timeout 300', 330000)` → 最长 330 秒
- `callLLM(...)` → 最长 120 秒

`execSync` 冻结整个 Node.js 事件循环。Brain HTTP server 在执行期间完全不响应，导致外部 trigger-cecelia 调用超时，进而触发 OOM kill（exit 137）→ 所有 in_progress 任务变孤儿。

### 下次预防

- [ ] **任何 Brain tick 中调用的函数，若内部含 `execSync` 或长时 blocking 操作，必须以 fire-and-forget 方式调用（不 await）**
- [ ] **Scanner 类似计算时用 accumulator 模式（汇总后一次计算），不用覆盖赋值**
- [ ] `brain-unit` CI 测试累积了多个预存在失败（suggestion-triage, learnings-vectorize），需要在下一个专项任务中统一修复

### 相关文件

- `packages/brain/src/capability-scanner.js` — `collectSkillActivity` 改为汇总计算
- `packages/brain/src/content-pipeline-orchestrator.js` — 添加 `_contentExecutorBusy` 并发守卫
- `packages/brain/src/tick.js` — content executor 改为 fire-and-forget
- `packages/brain/src/__tests__/task-router-core.test.js` — 添加 `cn` 到允许 location 列表
