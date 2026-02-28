---
repo: cecelia
plan_date: 2026-02-26
level: L3
total_items: 28
---

# Cecelia Monorepo - 代码审查修复计划

## P0 — 立即修复（阻塞发布）

- [ ] **[L1-001]** watchdog.js 无界 Map 内存泄漏
  - 文件: `packages/brain/src/watchdog.js:44`
  - 影响: 生产环境长期运行必然 OOM
  - 修复: 添加 `cleanupStaleMetrics()` 每 tick 清理超过 30 分钟的陈旧条目
  - 预计时间: 30 分钟

- [ ] **[L1-002]** rumination.js 浮动 Promise
  - 文件: `packages/brain/src/rumination.js:161-162`
  - 影响: 反刍任务创建失败被静默忽略
  - 修复: 将 `.catch()` 改为 `try-await-catch` 并记录到 cecelia_events
  - 预计时间: 20 分钟

- [ ] **[L1-003]** tick.js catch 块内未捕获异常
  - 文件: `packages/brain/src/tick.js:1845`
  - 影响: 任务状态同步失败，可能重复派发
  - 修复: 在 `updateTaskStatus` 外包一层 `try-catch`
  - 预计时间: 15 分钟

- [ ] **[L2-011]** 数据库死锁风险
  - 文件: `packages/brain/src/tick.js:785, 631-634`
  - 影响: 高并发下可能死锁导致 tick 超时
  - 修复: 使用 `FOR UPDATE NOWAIT` 或增加事务超时
  - 预计时间: 1 小时

---

## P1 — 本周修复（影响稳定性）

- [ ] **[L2-002]** 缺少 timeout 保护 - cortex.js
  - 文件: `packages/brain/src/cortex.js:176`
  - 修复: 在 tick 层加全局 120s 超时 `Promise.race()`
  - 预计时间: 30 分钟

- [ ] **[L2-003]** 并发限制不足 - executor.js
  - 文件: `packages/brain/src/executor.js:182-183`
  - 修复: 在 tick 中维护实时 `currentInProgress` 计数
  - 预计时间: 45 分钟

- [ ] **[L2-007]** 状态转换原子性 - quarantine.js
  - 文件: `packages/brain/src/quarantine.js:208-213`
  - 修复: 先 emit 事件再 UPDATE，或使用 saga 模式
  - 预计时间: 1 小时

- [ ] **[SEC-001]** Shell 注入风险 - executor.js
  - 文件: `packages/brain/src/executor.js:1703-1710`
  - 修复: 用 `execSync('ps aux')` 然后 filter，不用 shell 拼接
  - 预计时间: 30 分钟

- [ ] **[SEC-003]** 凭据管理改进 - llm-caller.js
  - 文件: `packages/brain/src/llm-caller.js:32-42`
  - 修复: 不缓存 API Key，每次读取或改用环境变量
  - 预计时间: 20 分钟

- [ ] **[L2-008]** 日志缺少 context - tick.js
  - 文件: `packages/brain/src/tick.js` 多处
  - 修复: 添加 `tickId = uuid.v4()` 到所有 tick 日志
  - 预计时间: 45 分钟

---

## P2 — 本月改进（提升可维护性）

### 架构重构

- [ ] **[ARCH-001]** 拆分 routes.js（7679 行）
  - 拆分为: tasks.js, okr.js, protection.js, tick.js, index.js
  - 预计时间: 2 天

- [ ] **[ARCH-002]** 拆分 tick.js（2040 行）
  - 拆分为: loop.js, dispatch.js, checks.js, cleanup.js, index.js
  - 预计时间: 2 天

- [ ] **[ARCH-003]** 拆分 executor.js（2025 行）
  - 拆分为: process-manager.js, resource-checker.js, command-builder.js, session.js, index.js
  - 预计时间: 2 天

- [ ] **[ARCH-004]** 统一配置管理
  - 提取所有 Magic Number 到 `config/constants.js`
  - 预计时间: 1 天

### 代码质量改进

- [ ] **[L2-001]** 竞态条件 - tick.js selectNextDispatchableTask()
  - 使用 `SELECT FOR UPDATE SKIP LOCKED`
  - 预计时间: 30 分钟

- [ ] **[L2-004]** 错误传播不完整 - quarantine.js
  - 返回对象中添加 `stack` 和 `code` 字段
  - 预计时间: 15 分钟

- [ ] **[L2-005]** 隐式类型转换 - planner.js
  - 使用 `COALESCE(metadata->>'task_type', 'unknown')`
  - 预计时间: 10 分钟

- [ ] **[L2-006]** SQL 注入风险（低风险）- llm-caller.js
  - 添加 prompt 长度和类型验证
  - 预计时间: 10 分钟

- [ ] **[L2-009]** 未处理的 Promise 拒绝 - executor.js
  - `recordSessionEnd` 改为 `recordSessionEndSafe` 带重试
  - 预计时间: 30 分钟

- [ ] **[L2-010]** 环境变量解析无验证 - executor.js
  - 启动时检查 `CECELIA_RUN_PATH` 等路径是否存在
  - 预计时间: 15 分钟

### 测试覆盖

- [ ] **[TEST-001]** tick.js executeTick() 单元测试
  - 创建独立的 `tick.test.js`，mock DB 和外部调用
  - 预计时间: 2 小时

- [ ] **[TEST-002]** executor.js triggerCeceliaRun() mock 测试
  - Mock cecelia-bridge，测试命令生成逻辑
  - 预计时间: 1.5 小时

### 可观测性

- [ ] **[OBS-001]** 引入结构化日志
  - 所有日志改为 JSON format，包含 `tickId`, `timestamp`, `level`, `message`
  - 预计时间: 1 天

- [ ] **[OBS-002]** 添加 Prometheus metrics 端点
  - 导出: `tick_duration_seconds`, `tasks_dispatched_total`, `alertness_level`
  - 预计时间: 1 天

---

## L3 改进（技术债）

- [ ] **[L3-001]** 循环中的异步操作优化 - tick.js
  - `dispatchNextTask` 循环改为并行（如果独立）
  - 预计时间: 1 小时

- [ ] **[L3-002]** 过度的中文注释
  - 关键业务逻辑改用英文注释
  - 预计时间: 持续改进

- [ ] **[L3-003]** 清理未使用的导入
  - cortex.js: 移除 `validatePolicyJson`
  - 预计时间: 5 分钟

- [ ] **[L3-004]** 统一错误处理风格
  - 建立《错误处理指南》文档
  - 预计时间: 1 天

- [ ] **[L3-005]** 添加速率限制
  - LLM 调用加 rate limiter（每分钟最多 N 次）
  - 预计时间: 2 小时

- [ ] **[L3-006]** 添加健康检查端点
  - 创建 `/health` 和 `/metrics` 端点
  - 预计时间: 1 小时

- [ ] **[L3-007]** Event Bus 改进
  - 添加事件顺序保证和死信队列
  - 预计时间: 2 天

- [ ] **[L3-008]** 关键状态持久化
  - `_loopTimer`, `_tickRunning`, `_billingPause` 写入 working_memory
  - 预计时间: 1 天

- [ ] **[L3-009]** Feature Flag 系统
  - 创建 `brain_config.feature_flags` JSON 字段
  - 预计时间: 1 天

---

## Brain 可派发 Task 列表

以下任务可通过 Brain API 创建并派发给 Caramel（/dev agent）：

```json
[
  {
    "title": "[P0] 修复 watchdog.js 无界 Map 内存泄漏",
    "priority": "P0",
    "task_type": "dev",
    "prd_content": "在 watchdog.js 中添加 cleanupStaleMetrics() 函数，每个 tick 清理超过 30 分钟的陈旧 _taskMetrics 条目。DoD: 1) 函数实现并在 monitorTick() 开始时调用，2) 添加单元测试验证清理逻辑，3) 验证长期运行不再内存泄漏。",
    "estimated_minutes": 30
  },
  {
    "title": "[P0] 修复 rumination.js 浮动 Promise",
    "priority": "P0",
    "task_type": "dev",
    "prd_content": "将 rumination.js:161-162 的 createTask(...).catch() 改为 try-await-catch，失败时记录到 cecelia_events 表。DoD: 1) 改为 await 并包裹 try-catch，2) 失败时插入 cecelia_events 记录，3) 添加单元测试验证错误处理。",
    "estimated_minutes": 20
  },
  {
    "title": "[P0] 修复 tick.js catch 块内未捕获异常",
    "priority": "P0",
    "task_type": "dev",
    "prd_content": "在 tick.js:1845 的 updateTaskStatus 外包一层 try-catch，失败时记录到 working_memory 表标记待重试。DoD: 1) 添加内层 try-catch，2) 失败时写入 working_memory，3) 验证状态同步失败不影响 tick 继续。",
    "estimated_minutes": 15
  },
  {
    "title": "[P0] 消除数据库死锁风险",
    "priority": "P0",
    "task_type": "dev",
    "prd_content": "在 tick.js 的 selectNextDispatchableTask 和 quarantine 操作中使用 FOR UPDATE NOWAIT 或增加事务超时。DoD: 1) 所有多步 UPDATE 操作包裹事务，2) 使用 FOR UPDATE SKIP LOCKED 或 NOWAIT，3) 压力测试验证不再死锁。",
    "estimated_minutes": 60
  },
  {
    "title": "[P1] 同时修复 6 个 L2 问题",
    "priority": "P1",
    "task_type": "dev",
    "prd_content": "批量修复: 1) cortex.js 添加 120s timeout，2) executor.js 并发限制改进，3) quarantine.js 原子性保证，4) executor.js Shell 注入防护，5) llm-caller.js 凭据管理改进，6) tick.js 添加 tickId context。DoD: 每个修复对应一个测试用例验证。",
    "estimated_minutes": 240
  },
  {
    "title": "[P2] 重构 routes.js 为多文件模块",
    "priority": "P2",
    "task_type": "dev",
    "prd_content": "将 routes.js (7679行) 拆分为 routes/tasks.js, routes/okr.js, routes/protection.js, routes/tick.js, routes/index.js。保持 API 端点不变，确保向后兼容。DoD: 1) 所有端点迁移到新文件，2) 原 routes.js 只保留 require 和注册，3) 所有 API 测试通过。",
    "estimated_minutes": 960
  },
  {
    "title": "[P2] 重构 tick.js 为多文件模块",
    "priority": "P2",
    "task_type": "dev",
    "prd_content": "将 tick.js (2040行) 拆分为 tick/loop.js, tick/dispatch.js, tick/checks.js, tick/cleanup.js, tick/index.js。DoD: 1) 功能完全保持，2) 单元测试全部迁移，3) 集成测试通过。",
    "estimated_minutes": 960
  },
  {
    "title": "[P2] 重构 executor.js 为多文件模块",
    "priority": "P2",
    "task_type": "dev",
    "prd_content": "将 executor.js (2025行) 拆分为 executor/process-manager.js, executor/resource-checker.js, executor/command-builder.js, executor/session.js, executor/index.js。DoD: 同上。",
    "estimated_minutes": 960
  },
  {
    "title": "[P2] 统一配置管理 - 提取 Magic Number",
    "priority": "P2",
    "task_type": "dev",
    "prd_content": "创建 config/constants.js，提取所有 Magic Number（TICK_INTERVAL_MINUTES, MEM_PER_TASK_MB, CPU_PER_TASK 等）。DoD: 1) constants.js 导出所有常量，2) 所有文件改用 import，3) 文档化每个常量含义。",
    "estimated_minutes": 480
  },
  {
    "title": "[P2] 引入结构化日志",
    "priority": "P2",
    "task_type": "dev",
    "prd_content": "所有 console.log 改为 JSON format，包含 {timestamp, level, tickId, taskId, message, context}。引入 winston 或 pino 日志库。DoD: 1) 所有日志改为结构化，2) 支持日志级别过滤，3) 可导出到文件。",
    "estimated_minutes": 480
  },
  {
    "title": "[P2] 添加 Prometheus metrics 端点",
    "priority": "P2",
    "task_type": "dev",
    "prd_content": "创建 /metrics 端点，导出 tick_duration_seconds, tasks_dispatched_total, alertness_level, executor_slots_available 等指标。DoD: 1) metrics 端点返回 Prometheus 格式，2) 至少 10 个核心指标，3) Grafana 可正常抓取。",
    "estimated_minutes": 480
  }
]
```

---

## 预计工作量

| 优先级 | 任务数 | 预计总时间 |
|--------|--------|-----------|
| P0 | 4 | 2.2 小时 |
| P1 | 6 | 4.7 小时 |
| P2（架构） | 4 | 8 天 |
| P2（质量） | 6 | 3.7 小时 |
| P2（测试） | 2 | 3.5 小时 |
| P2（可观测性） | 2 | 2 天 |
| L3（技术债） | 9 | 6 天 |
| **总计** | **33** | **约 18 天**（假设单人全职） |

---

## 执行建议

### 第 1 周：消除稳定性风险
1. Day 1: 修复所有 P0 问题（2.2 小时）
2. Day 2-3: 修复 P1 问题（4.7 小时）
3. Day 4-5: 补充测试覆盖（3.5 小时）

### 第 2-3 周：架构重构
1. Week 2: 重构 routes.js + tick.js（4 天）
2. Week 3: 重构 executor.js + 统一配置（3 天）

### 第 4 周：可观测性和技术债
1. Day 1-2: 引入结构化日志 + Prometheus metrics（2 天）
2. Day 3-5: 清理 L3 技术债（持续改进）

---

## 成功标准

✅ **P0 全部修复** - 无内存泄漏、无浮动 Promise、无死锁
✅ **P1 全部修复** - 系统稳定性提升，无超时/竞态条件
✅ **核心模块单元测试覆盖 > 80%**
✅ **单个文件不超过 1000 行**
✅ **所有配置统一管理**
✅ **结构化日志 + Prometheus metrics 可用**

---

## 风险

| 风险 | 缓解措施 |
|------|---------|
| **重构破坏现有功能** | 每次重构后运行完整回归测试 |
| **测试覆盖不足** | 重构前补充单元测试 |
| **生产环境验证困难** | 使用 feature flag 灰度发布 |
| **时间预估不准** | 每个 task 增加 20% buffer |

---

## 下一步行动

1. **立即**: 创建 GitHub Issue 跟踪所有 P0/P1 问题
2. **本周**: 通过 Brain API 派发前 4 个 P0 task 给 Caramel
3. **下周**: 启动架构重构 initiative
4. **持续**: 每周 code review，防止新的技术债累积
