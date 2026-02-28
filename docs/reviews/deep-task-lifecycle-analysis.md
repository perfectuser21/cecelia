---
id: deep-task-lifecycle-analysis
version: 1.0.0
created: 2026-02-26
updated: 2026-02-26
changelog:
  - 1.0.0: 初始版本 - Cecelia Brain 任务生命周期深度分析
title: Cecelia Brain 任务生命周期深度分析
description: 全面追踪任务从创建到完成的完整生命周期，包括调度、执行、回调和保护机制
---

# Cecelia Brain 任务生命周期深度分析

## 摘要

本文档对 Cecelia Brain 的任务生命周期进行全面的代码级分析，涵盖从 HTTP 请求创建任务到任务执行完成的完整调用链。分析基于 `packages/brain/src/` 目录下的源代码文件，共计 76 个数据库迁移和数十个核心模块。

---

## 1. 完整调用链图

### 1.1 任务创建路径

```
HTTP Request
    │
    ▼
routes.js (Express Router)
    │
    ├─ POST /api/brain/action/create-task (L1465)
    │   └─ handleAction() (L1379)
    │       │
    │       ├─ 1. 白名单检查 (L1381)
    │       ├─ 2. 必填参数验证 (L1387)
    │       ├─ 3. 幂等性检查 checkIdempotency() (L1394)
    │       ├─ 4. 执行 createTask() (L1404)
    │       │   │
    │       │   ├─ isSystemTask() 检查 (L14)
    │       │   ├─ 去重查询 dedupResult (L48)
    │       │   ├─ INSERT tasks (L63)
    │       │   └─ broadcastTaskState() WebSocket (L85)
    │       │
    │       ├─ 5. 保存幂等键 saveIdempotency() (L1432)
    │       └─ 6. 记录决策日志 (L1435)
    │
    └─ POST /api/brain/execution-callback (L2018)
        └─ 任务完成回调处理
            │
            ├─ 状态映射 (L2041-2048)
            │   ├─ 'AI Done' → 'completed'
            │   └─ 'AI Failed' → 'failed'
            │
            ├─ PR 检查 (L2050-2064)
            │   └─ dev 任务无 PR → completed_no_pr
            │
            ├─ DB 事务更新 (L2080-2134)
            │   ├─ UPDATE tasks (原子更新)
            │   ├─ INSERT decision_log
            │   └─ COMMIT/ROLLBACK
            │
            ├─ 清理 activeProcesses (L2136-2140)
            │
            └─ 后处理
                ├─ completed: cbSuccess + notifyTaskCompleted + publishTaskCompleted
                ├─ failed: cbFailure + notifyTaskFailed + publishTaskFailed
                └─ 智能重试/隔离决策 (L2219-2268)
```

### 1.2 Tick 调度路径

```
Tick Loop (5s interval)
    │
    ▼
executeTick() (tick.js L1063)
    │
    ├─ 0. Alertness 评估 (L1070-1100)
    │   └─ evaluateAlertness()
    │       ├─ collectMetrics()
    │       ├─ diagnoseProblem()
    │       └─ determineTargetLevel()
    │
    ├─ 0. Thalamus 事件处理 (L1102-1143)
    │   └─ thalamusProcessEvent()
    │       └─ 若 thalamus_action === 'dispatch_task' → 跳过 normal dispatch
    │
    ├─ 0.5-0.9 各种检查
    │   ├─ PR Plans 完成检查 (L1145)
    │   ├─ 统一拆解检查 (L1161)
    │   ├─ 循环任务检查 (L1179)
    │   ├─ 周期性清理 (L1195)
    │   ├─ Codex 免疫检查 (L1220)
    │   ├─ Layer 2 健康检查 (L1227)
    │   ├─ Initiative 闭环检查 (L1239)
    │   └─ Project 完成检查 (L1255)
    │
    ├─ 1. 目标/KR 检查 (L1305)
    │   └─ 若无 active goals → dispatched=0, reason='no_active_goals'
    │
    ├─ 2. 派发循环 (L1449-1700)
    │   │
    │   └─ dispatchNextTask() (L700)
    │       │
    │       ├─ 0. Drain 检查 (L703)
    │       ├─ 0a. Billing Pause 检查 (L718)
    │       ├─ 0. Slot Budget 检查 (L725)
    │       │   └─ calculateSlotBudget()
    │       │
    │       ├─ 2. Circuit Breaker 检查 (L739)
    │       │   └─ isAllowed('cecelia-run')
    │       │
    │       ├─ 3. 选择任务 (L745-788)
    │       │   ├─ selectNextDispatchableTask()
    │       │   ├─ processCortexTask() (若 requires_cortex)
    │       │   └─ preFlightCheck() (L751)
    │       │
    │       ├─ 4. 更新状态为 in_progress (L790)
    │       │   └─ updateTask({ task_id, status: 'in_progress' })
    │       │
    │       ├─ 5. Executor 可用性检查 (L807)
    │       │   └─ checkCeceliaRunAvailable()
    │       │
    │       └─ 6. 触发执行 (L828)
    │           └─ triggerCeceliaRun(task)
    │
    └─ 5. 超时任务处理 (L1471)
        └─ autoFailTimedOutTasks()
```

### 1.3 任务执行路径

```
executor.js::triggerCeceliaRun() (L1384)
    │
    ├─ 1. 位置路由 (L1385)
    │   └─ getTaskLocation(task_type)
    │       ├─ 'dev'/'review'/'qa'/'audit' → 'us'
    │       └─ 'talk'/'research'/'data' → 'hk'
    │
    ├─ 2. 去重检查 (L1415)
    │   └─ activeProcesses.get(task.id) + isProcessAlive()
    │
    ├─ 3. 资源检查 (L1436)
    │   └─ checkServerResources()
    │
    ├─ 4. Prompt 准备 (L1459)
    │   └─ preparePrompt(task)
    │
    ├─ 5. 调用 cecelia-bridge (L1488)
    │   └─ POST http://localhost:3457/trigger-cecelia
    │       │
    │       ├─ 写 prompt 文件
    │       ├─ 构建环境变量
    │       └─ exec cecelia-run (后台)
    │
    └─ 6. 注册到 activeProcesses (L1521)
```

### 1.4 cecelia-run 执行路径

```
cecelia-run (bash script)
    │
    ├─ 1. 参数验证 (L35)
    │
    ├─ 2. 获取并发锁 (L85)
    │   ├─ cleanup_zombies()
    │   └─ mkdir slot-* 目录
    │
    ├─ 3. Worktree 创建 (L381)
    │   └─ worktree-manage.sh create
    │       └─ 若失败 → 安全中止 (拒绝在主仓库运行)
    │
    ├─ 4. Claude 执行 (L420)
    │   └─ claude -p "$prompt" [options]
    │       │
    │       ├─ Permission mode: plan / bypassPermissions
    │       ├─ Model: CECELIA_MODEL
    │       └─ Provider: MiniMax / Anthropic
    │
    ├─ 5. 重试循环 (L407)
    │   └─ MAX_RETRIES=5
    │
    ├─ 6. 结果处理 (L468)
    │   ├─ exit_code=0 → 'AI Done'
    │   └─ exit_code≠0 → 'AI Failed'
    │
    ├─ 7. 回调 Brain (L502)
    │   └─ send_webhook()
    │       └─ POST http://localhost:5221/api/brain/execution-callback
    │
    └─ 8. 清理 (L239)
        ├─ 杀进程组
        └─ 删除 worktree
```

---

## 2. 任务状态机

### 2.1 状态定义

| 状态 | 说明 | 可转换到 |
|------|------|----------|
| `queued` | 等待派发 | `in_progress`, `quarantined`, `cancelled` |
| `in_progress` | 正在执行 | `completed`, `failed`, `quarantined`, `queued` (revert) |
| `completed` | 成功完成 | - (终态) |
| `completed_no_pr` | 完成但无 PR | - (终态) |
| `failed` | 执行失败 | `queued` (smart retry), `quarantined` |
| `quarantined` | 隔离中 | `queued` (release), `cancelled` |
| `cancelled` | 已取消 | - (终态) |

### 2.2 状态转换图

```
                    ┌─────────────────┐
                    │     queued      │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────────┐
        │in_progress│  │quarantine│  │  cancelled   │
        └────┬─────┘  └────┬─────┘  └──────────────┘
             │             │
     ┌───────┼───────┐     │
     │       │       │     │
     ▼       ▼       ▼     ▼
completed failed  reverted  (release)
             │             │
             │    ┌────────┴────────┐
             │    │                  │
             ▼    ▼                  ▼
        quarantined    queued (retry)
```

### 2.3 触发条件

| 转换 | 触发条件 | 代码位置 |
|------|----------|----------|
| queued → in_progress | dispatchNextTask() 成功更新任务 | tick.js L790-805 |
| in_progress → completed | execution-callback 收到 'AI Done' | routes.js L2042-2043 |
| in_progress → failed | execution-callback 收到 'AI Failed' | routes.js L2044-2045 |
| failed → queued | 智能重试，classification.should_retry=true | routes.js L2219-2233 |
| failed → quarantined | handleTaskFailure() 决策 | routes.js L2253-2268 |
| in_progress → reverted | executor 不可用，任务回滚到 queued | tick.js L810-819 |

---

## 3. 故障模式清单

### 3.1 创建阶段故障 (F-001 到 F-015)

| ID | 故障点 | 位置 | 影响 | 概率 | 缓解措施 |
|----|--------|------|------|------|----------|
| F-001 | goal_id 验证失败 | actions.js L41-45 | 任务创建失败，返回 400 | 中 | isSystemTask() 白名单 |
| F-002 | 去重查询超时 | actions.js L48-55 | 任务创建阻塞 | 低 | 数据库索引 |
| F-003 | INSERT 失败 | actions.js L63-79 | 任务创建失败 | 低 | 事务回滚 |
| F-004 | WebSocket 广播失败 | actions.js L85 | 前端不更新 | 低 | 非阻塞，catch 忽略 |
| F-005 | 幂等键冲突 | routes.js L1394-1396 | 返回 previousResult | 中 | checkIdempotency() |
| F-006 | 白名单检查失败 | routes.js L1381-1384 | 拒绝执行 | 低 | ALLOWED_ACTIONS 配置 |
| F-007 | 必填参数缺失 | routes.js L1387-1391 | 返回 400 | 中 | 预先验证 |
| F-008 | 幂等键保存失败 | routes.js L1432 | 重复请求无法识别 | 低 | 降级处理 |
| F-009 | 决策日志写入失败 | routes.js L1435 | 审计缺失 | 低 | 非阻塞 |
| F-010 | 并发创建相同任务 | actions.js L48-60 | 只有一个成功 | 中 | 分布式锁或 DB 约束 |
| F-011 | payload JSON 超大 | actions.js L77 | DB 写入失败 | 低 | 大小限制 |
| F-012 | prd_content 超大 | actions.js L75 | DB 写入失败 | 低 | MAX_PRD_LENGTH 限制 |
| F-013 | tags 格式错误 | actions.js L73 | DB 写入失败 | 低 | 预验证 |
| F-014 | trigger_source 无效 | actions.js L78 | 默认值降级 | 低 | 默认值 fallback |
| F-015 | execution_profile 无效 | actions.js L76 | 任务执行使用默认模型 | 低 | 执行时降级 |

### 3.2 调度阶段故障 (F-016 到 F-045)

| ID | 故障点 | 位置 | 影响 | 概率 | 缓解措施 |
|----|--------|------|------|------|----------|
| F-016 | Drain 模式激活 | tick.js L708-715 | 不派发任务 | 低 | 手动恢复 |
| F-017 | Billing Pause 激活 | tick.js L720-722 | 不派发任务 | 中 | setBillingPause() |
| F-018 | Slot Budget 不足 | tick.js L727-736 | 不派发任务 | 中 | 资源动态计算 |
| F-019 | Circuit Breaker Open | tick.js L740-742 | 不派发任务 | 中 | 30min 自动恢复 |
| F-020 | 无可派发任务 | tick.js L756 | dispatched=0 | 高 | 正常状态 |
| F-021 | Pre-flight 检查失败 | tick.js L765-788 | 跳过任务 | 中 | 多次重试 (5次) |
| F-022 | Cortex 任务处理 | tick.js L760-761 | 可能唤醒 L2 | 低 | processCortexTask() |
| F-023 | updateTask 失败 | tick.js L790-798 | dispatched=0 | 低 | 日志记录 |
| F-024 | Executor 不可用 | tick.js L808-819 | 任务回滚 queued | 中 | checkCeceliaRunAvailable() |
| F-025 | 任务不存在 | tick.js L823-825 | dispatched=0 | 低 | 原子查询 |
| F-026 | triggerCeceliaRun 失败 | tick.js L831-842 | 任务回滚 queued | 中 | 错误分类 |
| F-027 | Alertness PANIC | tick.js L1086-1094 | 跳过所有操作 | 低 | 手动恢复 |
| F-028 | Thalamus 决策冲突 | tick.js L1130-1137 | 可能跳过 dispatch | 低 | fallback_to_tick |
| F-029 | 周期性清理失败 | tick.js L1195-1205 | 磁盘空间泄漏 | 低 | 非阻塞 |
| F-030 | 健康检查失败 | tick.js L1227-1236 | 问题未发现 | 低 | 多层检查 |
| F-031 | 超时任务检测失败 | tick.js L1471 | 僵尸任务 | 低 | autoFailTimedOutTasks() |
| F-032 | 僵尸任务清理失败 | tick.js L1566 | 资源泄漏 | 低 | 定期清理 |
| F-033 | 资源检查误判 | executor.js L1436-1450 | 拒绝合法任务 | 低 | 动态阈值 |
| F-034 | Slot 预算计算错误 | slot-allocator.js L161-219 | 派发策略错误 | 低 | 双重检查 |
| F-035 | 用户会话检测错误 | slot-allocator.js L42-80 | 模式判断错误 | 低 | TTL 过滤 |
| F-036 | 内部任务检测错误 | slot-allocator.js L103-115 | 优先级错误 | 低 | SQL 精确匹配 |
| F-037 | 资源压力计算错误 | slot-allocator.js L185-186 | 过度节流 | 低 | effectiveSlots |
| F-038 | 活跃进程去重失败 | executor.js L1415-1434 | 重复派发 | 低 | isProcessAlive() |
| F-039 | Pre-flight 检查误判 | pre-flight-check.js L22-105 | 拒绝合法任务 | 低 | 可配置规则 |
| F-040 | 描述内容验证误判 | pre-flight-check.js L69-96 | 拒绝合法任务 | 低 | 启发式改进 |
| F-041 | 任务选择死循环 | tick.js L753-788 | Pre-flight 全失败 | 低 | MAX_PRE_FLIGHT_RETRIES |
| F-042 | 数据库连接池耗尽 | tick.js L747 | 调度阻塞 | 低 | 连接池配置 |
| F-043 | 决策日志过大 | tick.js L861 | 磁盘空间 | 低 | 日志轮转 |
| F-044 | 派发结果记录失败 | tick.js L1449 | 统计不准确 | 低 | 非关键 |
| F-045 | 任务状态不一致 | tick.js L2113 | 回调处理异常 | 低 | 事务保证 |

### 3.3 执行阶段故障 (F-046 到 F-065)

| ID | 故障点 | 位置 | 影响 | 概率 | 缓解措施 |
|----|--------|------|------|------|----------|
| F-046 | 任务路由错误 | executor.js L1386-1388 | 任务执行错误位置 | 低 | LOCATION_MAP |
| F-047 | MiniMax Executor 不可用 | executor.js L1388 | 任务失败 | 低 | fallback to US |
| F-048 | Run ID 生成冲突 | executor.js L1394 | 追踪混淆 | 低 | UUID + 时间戳 |
| F-049 | Prompt 准备失败 | executor.js L1459 | 任务无法执行 | 低 | preparePrompt() 错误处理 |
| F-050 | Repo 路径解析失败 | executor.js L1468-1473 | 使用错误目录 | 低 | payload 降级 |
| F-051 | Credentials 读取失败 | executor.js L1483-1486 | API 认证失败 | 低 | 错误日志 |
| F-052 | Bridge HTTP 请求失败 | executor.js L1492-1517 | 任务未执行 | 中 | 重试逻辑 |
| F-053 | Bridge 返回错误 | executor.js L1510-1518 | 任务未执行 | 低 | 错误分类 |
| F-054 | activeProcesses 写入失败 | executor.js L1521-1527 | 追踪失败 | 低 | 内存+DB |
| F-055 | cecelia-bridge 崩溃 | bridge.js L1-71 | 任务未执行 | 低 | 健康检查 |
| F-056 | Prompt 文件写入失败 | bridge.js L27 | 任务无法执行 | 低 | 文件系统检查 |
| F-057 | cecelia-run 启动失败 | cecelia-run L35-42 | 任务失败 | 低 | 参数验证 |
| F-058 | 并发锁获取超时 | cecelia-run L83-123 | 任务失败 | 中 | MAX_LOCK_WAIT |
| F-059 | Worktree 创建失败 | cecelia-run L381-401 | 安全中止 | 低 | 拒绝主仓库 |
| F-060 | Claude 进程启动失败 | cecelia-run L410-421 | 任务失败 | 低 | 错误日志 |
| F-061 | Claude 进程超时 | cecelia-run L407-466 | 任务重试或失败 | 中 | MAX_RETRIES |
| F-062 | Claude 进程被杀死 | cecelia-run L239-250 | 任务失败 | 低 | 清理函数 |
| F-063 | Webhook 回调失败 | cecelia-run L162-224 | Brain 不知道结果 | 中 | 重试+日志 |
| F-064 | Core API 更新失败 | cecelia-run L486-499 | Dashboard 不同步 | 低 | 非关键 |
| F-065 | 临时文件未清理 | cecelia-run L512-513 | 磁盘空间泄漏 | 低 | finally 清理 |

### 3.4 回调阶段故障 (F-066 到 F-080)

| ID | 故障点 | 位置 | 影响 | 概率 | 缓解措施 |
|----|--------|------|------|------|----------|
| F-066 | task_id 缺失 | routes.js L2031-2036 | 回调失败 | 低 | 参数验证 |
| F-067 | 状态映射错误 | routes.js L2041-2048 | 状态不正确 | 低 | 显式映射 |
| F-068 | PR 检查失败 | routes.js L2050-2064 | 状态不正确 | 低 | 容错处理 |
| F-069 | DB 事务失败 | routes.js L2080-2134 | 状态未更新 | 低 | ROLLBACK |
| F-070 | 幂等性检查失败 | routes.js L2113 | 重复更新 | 低 | WHERE status='in_progress' |
| F-071 | activeProcesses 清理失败 | routes.js L2136-2140 | 内存泄漏 | 低 | catch 忽略 |
| F-072 | Circuit Breaker 更新失败 | routes.js L2147/2183 | 熔断状态错误 | 低 | 非阻塞 |
| F-073 | WebSocket 广播失败 | routes.js L2151/2187 | 前端不更新 | 低 | 非阻塞 |
| F-074 | 失败分类失败 | routes.js L2200-2250 | 无智能重试 | 低 | 容错处理 |
| F-075 | 智能重试配置错误 | routes.js L2219-2233 | 重试策略错误 | 低 | classification |
| F-076 | Billing Pause 误触 | routes.js L2236-2239 | 停止派发 | 低 | 条件检查 |
| F-077 | 隔离决策失败 | routes.js L2253-2268 | 任务未隔离 | 低 | 容错处理 |
| F-078 | Thalamus 分析失败 | routes.js L2154-2172/2270-2288 | 无智能决策 | 低 | 容错处理 |
| F-079 | KR 进度同步失败 | routes.js L2293-2320 | 进度不准确 | 低 | 非关键 |
| F-080 | Embedding 生成失败 | routes.js L2174-2180 | 搜索功能受损 | 低 | 非阻塞 |

---

## 4. 竞争条件分析

### 4.1 并发访问点

| 位置 | 资源 | 风险等级 | 描述 |
|------|------|----------|------|
| actions.js L48-60 | tasks 表 (title, goal_id, project_id) | **高** | 并发创建相同任务 |
| tick.js L790-798 | tasks 表 (status) | **高** | 多 tick 同时抢同一任务 |
| executor.js L1415-1434 | activeProcesses Map | 中 | 并发去重检查 |
| routes.js L2080-2134 | tasks 表 + decision_log | 中 | 回调事务 |
| executor.js L1521-1527 | activeProcesses Map | 低 | 并发注册 |
| quarantine.js L150-152 | tasks 表 (status) | 低 | 重复隔离 |

### 4.2 具体竞争场景

#### 场景 1: 重复任务创建
```
时间线:
T1: Request A → dedup 查询 → 无结果
T2: Request B → dedup 查询 → 无结果 (A 还未 commit)
T3: Request A → INSERT 成功
T4: Request B → INSERT 成功 (重复任务!)

影响: 同一任务被创建多次
缓解: 应用程序级去重不够，需要 DB 唯一约束
当前状态: 无 DB 级别唯一约束，存在风险
```

#### 场景 2: 任务重复派发
```
时间线:
T1: Tick 1 → selectNextDispatchableTask() → task-001
T2: Tick 2 → selectNextDispatchableTask() → task-001 (还未 update)
T3: Tick 1 → UPDATE tasks SET status='in_progress' WHERE id='task-001'
T4: Tick 2 → UPDATE tasks SET status='in_progress' WHERE id='task-001' (影响 0 行)

影响: 任务可能被多次派发
缓解: updateTask() 检查返回值，当前代码 L796 有处理
当前状态: 有部分保护，但不完整
```

#### 场景 3: 回调覆盖
```
时间线:
T1: Task-001 开始执行 → status='in_progress'
T2: execution-callback (success) → UPDATE ... WHERE status='in_progress'
T3: execution-callback (duplicate) → 尝试 UPDATE ... WHERE status='in_progress' (已不是)

影响: 重复回调无影响
缓解: WHERE status='in_progress' 保护
当前状态: 安全
```

---

## 5. 超时和重试矩阵

### 5.1 超时配置

| 阶段 | 超时项 | 默认值 | 配置位置 |
|------|--------|--------|----------|
| Tick 执行 | TICK_TIMEOUT_MS | 60000ms | tick.js L30 |
| Tick 循环间隔 | TICK_LOOP_INTERVAL_MS | 5000ms | tick.js L29 |
| Task Dispatch | DISPATCH_TIMEOUT_MINUTES | 60min | tick.js L32 |
| Webhook 等待 | 无 (异步) | - | - |
| Bridge 请求 | 无 (HTTP 超时) | - | - |
| cecelia-run 锁等待 | MAX_LOCK_WAIT | 300s | cecelia-run L83 |
| cecelia-run 清理 | idle_threshold | 600s | cecelia-run L48 |
| Circuit Breaker | OPEN_DURATION_MS | 30min | circuit-breaker.js L15 |
| Billing Pause | reset_time | API 返回 | routes.js L2236-2239 |

### 5.2 重试策略

| 场景 | 重试条件 | 重试次数 | 重试间隔 | 代码位置 |
|------|----------|----------|----------|----------|
| Pre-flight 失败 | 检查失败 | 5 次 | 立即 | tick.js L753 |
| Executor 不可用 | available=false | 0 (回滚 queued) | - | tick.js L810-819 |
| triggerCeceliaRun 失败 | success=false | 0 (回滚 queued) | - | tick.js L831-842 |
| Claude 执行 | exit_code≠0 | 5 次 | 2s 延迟 | cecelia-run L407 |
| 智能重试 | classification.should_retry | 根据策略 | strategy.next_run_at | routes.js L2219-2233 |
| Circuit Breaker | 探测成功 | 1 次 | 30min 后 | circuit-breaker.js L36-38 |

### 5.3 智能重试策略

失败分类 (`quarantine.js`):
- **billing_cap**: 等待 reset_time，不重试
- **rate_limit**: 30min 后重试
- **auth**: 不重试，通知人
- **network**: 30min 后重试
- **resource**: 不重试，通知人
- **task_error**: 正常失败计数，3 次后隔离

---

## 6. 数据一致性分析

### 6.1 三层一致性模型

| 层级 | 存储 | 特点 | 同步方式 |
|------|------|------|----------|
| **DB** | PostgreSQL tasks 表 | 持久化真实源 | - |
| **Memory** | activeProcesses Map | 内存缓存 | executor.js L1521 |
| **Process** | cecelia-run 进程 | 实际执行体 | PID 追踪 |

### 6.2 一致性风险

| 风险点 | 描述 | 影响 | 缓解措施 |
|--------|------|------|----------|
| DB in_progress 但进程死 | 任务卡住 | 资源泄漏 | autoFailTimedOutTasks() |
| Memory 有但 DB 无 | 重复派发 | 资源冲突 | isProcessAlive() 检查 |
| DB completed 但 Memory 有 | 内存泄漏 | 资源泄漏 | removeActiveProcess() |
| 进程完成但无回调 | 任务卡住 | 永久 in_progress | 超时检测 |

### 6.3 事务保证

**execution-callback** (routes.js L2080-2134):
```javascript
await client.query('BEGIN');
// 更新 tasks 表
await client.query('UPDATE tasks SET ... WHERE id = $1 AND status = $2', [...]);// 写入 decision_log
await client.query('INSERT INTO decision_log ...');
await client.query('COMMIT');
```

**特点**:
- 原子更新 + 日志写入
- WHERE status='in_progress' 保证幂等
- 失败时 ROLLBACK

---

## 7. 资源泄漏风险清单

| 资源类型 | 泄漏风险 | 位置 | 影响 | 缓解措施 |
|----------|----------|------|------|----------|
| **activeProcesses** | 回调失败未删除 | routes.js L2136-2140 | 内存泄漏 | try-catch 保护 |
| **磁盘空间** | 临时文件未清理 | cecelia-run L512-513 | 磁盘满 | finally 块清理 |
| **Worktree** | 创建失败未删除 | cecelia-run L389-401 | 仓库污染 | 清理函数 trap |
| **DB 连接** | 事务未提交 | routes.js L2080-2134 | 连接池耗尽 | finally 释放 |
| **Slot 目录** | 僵尸进程 | cecelia-run L46-80 | 锁死 | cleanup_zombies() |
| **磁盘空间** | 日志文件 | cecelia-run L157 | 磁盘满 | 日志轮转配置 |
| **PID 文件** | 进程崩溃遗留 | cecelia-run L108 | 锁死 | mkdir atomic |

---

## 8. 熔断和降级策略

### 8.1 Circuit Breaker

**位置**: `circuit-breaker.js`

**状态机**:
```
CLOSED (正常) ──3次失败──▶ OPEN (熔断)
  ▲                          │
  │                          ▼
  │                     HALF_OPEN (探测)
  │                          │
  └───────成功(<──────────────┘
```

**配置**:
- FAILURE_THRESHOLD: 3 次
- OPEN_DURATION_MS: 30 分钟

**触发条件**:
- 连续 3 次失败 → OPEN
- HALF_OPEN 探测失败 → 回到 OPEN

### 8.2 Alertness 降级

**位置**: `alertness/index.js`

**等级**:
| 等级 | 名称 | 派发率 | 行为 |
|------|------|--------|------|
| 0 | SLEEPING | 0% | 无任务，不派发 |
| 1 | CALM | 100% | 正常派发 |
| 2 | AWARE | 70% | 减少派发 |
| 3 | ALERT | 30% | 激进减少 |
| 4 | PANIC | 0% | 仅心跳检查 |

**转换规则**:
- 冷却期: 1 分钟内不允许降级
- PANIC 锁定: 30 分钟内不能再次进入 PANIC
- 渐进恢复: 只能逐级降低

### 8.3 Billing Pause

**触发**: API 返回 billing 相关错误

**行为**:
- 设置 billingPause 状态
- 所有 dispatchNextTask() 返回 `reason: 'billing_pause'`
- reset_time 后自动恢复

### 8.4 Drain 模式

**触发**: 手动调用 `/api/brain/tick/drain`

**行为**:
- _draining = true
- 阻止新任务派发
- 等待 in_progress 任务完成

### 8.5 降级路径

```
正常模式
    │
    ├─ Circuit Breaker OPEN → 停止派发，30min 后探测
    │
    ├─ Alertness PANIC → 停止派发，仅心跳检查
    │
    ├─ Billing Pause → 等待 reset_time
    │
    ├─ Drain Mode → 停止派发，等待完成
    │
    └─ 资源不足 → 动态调整派发数量
```

---

## 9. 观测性评估

### 9.1 日志系统

| 日志位置 | 内容 | 用途 |
|----------|------|------|
| Brain stdout | 所有模块日志 | 调试 |
| /tmp/cecelia-{task_id}.log | cecelia-run 输出 | 任务调试 |
| /tmp/cecelia-run.log | 结构化执行日志 | 审计 |
| decision_log 表 | 决策记录 | 回溯 |
| cecelia_events 表 | 事件流 | 分析 |

### 9.2 追踪系统

**位置**: `trace.js`

**能力**:
- LAYER: L0_ORCHESTRATOR → L1_THALAMUS → L2_CORTEX
- 步骤记录: start → end
- 状态: SUCCESS / FAILED / PENDING

### 9.3 监控端点

| 端点 | 用途 |
|------|------|
| GET /api/brain/status | 基础状态 |
| GET /api/brain/status/full | 完整状态 |
| GET /api/brain/tick/status | Tick 状态 |
| GET /api/brain/alertness | 警觉等级 |
| GET /api/brain/watchdog | 资源监控 |
| GET /api/brain/circuit-breaker | 熔断状态 |
| GET /api/brain/quarantine | 隔离区状态 |
| GET /api/brain/slots | 槽位分配 |

### 9.4 WebSocket 事件

| 事件 | 触发时机 |
|------|----------|
| task:created | 任务创建 |
| task:started | 任务开始执行 |
| task:completed | 任务完成 |
| task:failed | 任务失败 |
| task:updated | 任务更新 |
| alertness:changed | 警觉等级变化 |

---

## 10. 单点故障清单

| 组件 | 类型 | 影响 | 缓解 |
|------|------|------|------|
| **PostgreSQL** | 基础设施 | 全部功能不可用 | 多副本/备份 |
| **Brain 进程** | 服务 | 无调度/任务管理 | 健康检查/重启 |
| **cecelia-bridge** | 服务 | 任务无法执行 | 健康检查/重启 |
| **Claude Code CLI** | 工具 | 任务执行失败 | 错误处理/重试 |
| **Tailscale 网络** | 网络 | HK MiniMax 不可用 | US fallback |
| **磁盘空间** | 资源 | 服务崩溃 | 监控/清理 |
| **内存** | 资源 | OOM | 资源检查/限制 |

---

## 11. 完整数据库 Schema

### 11.1 核心表 (从 migrations/000_base_schema.sql)

```sql
-- areas
CREATE TABLE areas (
    id uuid PRIMARY KEY,
    name varchar(100) NOT NULL,
    group_name varchar(100),
    description text,
    icon varchar(50),
    sort_order integer,
    created_at timestamp DEFAULT now()
);

-- projects
CREATE TABLE projects (
    id uuid PRIMARY KEY,
    workspace_id uuid,
    parent_id uuid REFERENCES projects(id),
    name varchar(255) NOT NULL,
    repo_path varchar(500),
    description text,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    metadata jsonb,
    status varchar(50) DEFAULT 'active',
    area_id uuid REFERENCES areas(id)
);

-- goals
CREATE TABLE goals (
    id uuid PRIMARY KEY,
    project_id uuid REFERENCES projects(id),
    parent_id uuid REFERENCES goals(id),
    title varchar(255) NOT NULL,
    description text,
    status varchar(50) DEFAULT 'pending',
    priority varchar(10) DEFAULT 'P1',
    progress integer DEFAULT 0,
    weight numeric(3,2) DEFAULT 1.0,
    target_date date,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    owner_agent varchar(100),
    type varchar(50) DEFAULT 'objective',
    is_pinned boolean DEFAULT false,
    metadata jsonb
);

-- features
CREATE TABLE features (
    id uuid PRIMARY KEY,
    title text NOT NULL,
    description text,
    prd text,
    goal_id uuid REFERENCES goals(id),
    project_id uuid REFERENCES projects(id),
    status text DEFAULT 'planning',
    active_task_id uuid,
    current_pr_number integer DEFAULT 0,
    created_at timestamp,
    updated_at timestamp,
    completed_at timestamp
);

-- tasks (核心表)
CREATE TABLE tasks (
    id uuid PRIMARY KEY,
    goal_id uuid REFERENCES goals(id),
    project_id uuid REFERENCES projects(id),
    title varchar(255) NOT NULL,
    description text,
    status varchar(50) DEFAULT 'queued',
    priority varchar(10) DEFAULT 'P1',
    assigned_to varchar(100),
    payload jsonb,
    due_at timestamp,
    created_at timestamp DEFAULT now(),
    started_at timestamp,
    completed_at timestamp,
    updated_at timestamp DEFAULT now(),
    estimated_hours integer,
    tags text[],
    metadata jsonb,
    queued_at timestamp DEFAULT now(),
    area_id uuid REFERENCES areas(id),
    feature_id uuid REFERENCES features(id)
);

-- blocks
CREATE TABLE blocks (
    id uuid PRIMARY KEY,
    parent_id uuid NOT NULL,
    parent_type varchar(50) NOT NULL,
    type varchar(50) NOT NULL,
    content jsonb DEFAULT '{}',
    order_index integer DEFAULT 0,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

-- brain_config
CREATE TABLE brain_config (
    key varchar(100) PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamp
);

-- cecelia_events
CREATE TABLE cecelia_events (
    id serial PRIMARY KEY,
    event_type text NOT NULL,
    source text,
    payload jsonb,
    created_at timestamp DEFAULT now()
);

-- decision_log
CREATE TABLE decision_log (
    id uuid PRIMARY KEY,
    trigger text,
    input_summary text,
    llm_output_json jsonb,
    action_result_json jsonb,
    status text,
    created_at timestamp DEFAULT now(),
    ts timestamp DEFAULT now()
);

-- working_memory
CREATE TABLE working_memory (
    key text PRIMARY KEY,
    value_json jsonb,
    updated_at timestamp DEFAULT now()
);

-- pending_actions
CREATE TABLE pending_actions (
    id uuid PRIMARY KEY,
    action_type text NOT NULL,
    params jsonb,
    context jsonb,
    decision_id uuid,
    created_at timestamp DEFAULT now(),
    status text DEFAULT 'pending_approval',
    reviewed_by text,
    reviewed_at timestamp,
    execution_result jsonb,
    expires_at timestamp DEFAULT (now() + interval '24 hours')
);

-- project_kr_links
CREATE TABLE project_kr_links (
    project_id uuid REFERENCES projects(id),
    kr_id uuid REFERENCES goals(id),
    created_at timestamp DEFAULT now(),
    PRIMARY KEY (project_id, kr_id)
);
```

### 11.2 索引

```sql
CREATE INDEX idx_blocks_parent ON blocks(parent_id, parent_type);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_goal ON tasks(goal_id);
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_project ON goals(project_id);
CREATE INDEX idx_cecelia_events_type_time ON cecelia_events(event_type, created_at DESC);
CREATE INDEX idx_reflections_type ON reflections(type);
```

---

## 12. 配置项清单

### 12.1 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| PORT / BRAIN_PORT | 5221 | Brain HTTP 端口 |
| DB_HOST | localhost | PostgreSQL 主机 |
| DB_PORT | 5432 | PostgreSQL 端口 |
| DB_NAME | cecelia | 数据库名 |
| ENV_REGION | - | us/hk 区域 |
| CECELIA_TICK_INTERVAL_MS | 5000 | Tick 循环间隔 |
| CECELIA_CLEANUP_INTERVAL_MS | 3600000 | 清理周期 (1h) |
| CECELIA_BUDGET_SLOTS | - | API 预算槽位 |
| CECELIA_MAX_SEATS | - | 最大并发数 |
| DISPATCH_TIMEOUT_MINUTES | 60 | 任务超时时间 |
| BRIDGE_PORT | 3457 | cecelia-bridge 端口 |
| BRAIN_URL | http://localhost:5221 | Brain URL |
| CECELIA_WORK_DIR | /home/xx/perfect21/cecelia/core | 工作目录 |
| CECELIA_RUN_PATH | /home/xx/bin/cecelia-run | 执行器路径 |
| LOCK_DIR | /tmp/cecelia-locks | 锁目录 |
| CECELIA_MAX_CONCURRENT | 12 | 最大并发 |
| CECELIA_MAX_LOCK_WAIT | 300 | 锁等待超时 |
| CECELIA_MAX_RETRIES | 5 | 执行重试次数 |
| CECELIA_MAX_TURNS | 30 | Claude 最大轮数 |
| HK_MINIMAX_URL | http://100.86.118.99:5226 | HK MiniMax |

### 12.2 运行时配置 (代码内)

| 配置 | 值 | 位置 |
|------|-----|------|
| TICK_INTERVAL_MINUTES | 5 | tick.js L28 |
| TICK_LOOP_INTERVAL_MS | 5000 | tick.js L29 |
| TICK_TIMEOUT_MS | 60000 | tick.js L30 |
| STALE_THRESHOLD_HOURS | 24 | tick.js L31 |
| MAX_PRE_FLIGHT_RETRIES | 5 | tick.js L747 |
| AUTO_DISPATCH_MAX | MAX_SEATS - INTERACTIVE_RESERVE | tick.js L36 |
| FAILURE_THRESHOLD | 3 | circuit-breaker.js L14 |
| OPEN_DURATION_MS | 30 * 60 * 1000 | circuit-breaker.js L15 |
| FAILURE_THRESHOLD (Quarantine) | 3 | quarantine.js L29 |
| MAX_PRD_LENGTH | 50000 | quarantine.js L32 |
| MAX_PAYLOAD_SIZE | 100000 | quarantine.js L35 |
| CPU_CORES | os.cpus().length | executor.js L128 |
| MEM_PER_TASK_MB | 500 | executor.js L130 |
| CPU_PER_TASK | 0.5 | executor.js L131 |
| INTERACTIVE_RESERVE | 2 | executor.js L132 |
| RSS_KILL_MB | min(TOTAL_MEM*0.35, 2400) | watchdog.js L30 |
| RSS_WARN_MB | RSS_KILL_MB * 0.75 | watchdog.js L31 |
| CPU_SUSTAINED_PCT | 95 | watchdog.js L32 |
| CPU_SUSTAINED_TICKS | 6 | watchdog.js L33 |
| STARTUP_GRACE_SEC | 60 | watchdog.js L34 |
| IDLE_KILL_HOURS | 2 | watchdog.js L39 |
| IDLE_CPU_PCT_THRESHOLD | 1 | watchdog.js L41 |
| SESSION_TTL_SECONDS | 4 * 60 * 60 | slot-allocator.js L28 |
| CECELIA_RESERVED | 1 | slot-allocator.js L25 |
| USER_RESERVED_BASE | 2 | slot-allocator.js L26 |
| USER_PRIORITY_HEADROOM | 2 | slot-allocator.js L27 |

---

## 13. 总结与建议

### 13.1 系统健壮性评估

**优点**:
1. 多层保护机制 (Circuit Breaker, Alertness, Quarantine)
2. 智能重试和失败分类
3. 资源动态管理 (Slot Allocator)
4. 事务保证的数据一致性
5. 完整的观测性 (日志/追踪/WebSocket)

**改进建议**:
1. **添加 DB 级别去重约束**: 防止并发创建相同任务
2. **完善分布式锁**: 多 Brain 实例场景
3. **增强超时监控**: 精确追踪每个阶段超时
4. **备份 Brain 实例**: 高可用支持
5. **详细资源监控面板**: 实时资源使用

### 13.2 风险评估

| 风险 | 级别 | 建议 |
|------|------|------|
| 任务重复创建 | 中 | 添加 DB 唯一约束 |
| 多实例竞争 | 中 | 分布式锁实现 |
| 磁盘空间耗尽 | 低 | 增强监控/告警 |
| 内存泄漏 | 低 | 定期重启 |
| 网络分区 | 低 | HK/US fallback |

---

*文档版本: 1.0.0*
*生成时间: 2026-02-26*
*分析范围: packages/brain/src/, /home/xx/bin/cecelia-*, migrations/*
