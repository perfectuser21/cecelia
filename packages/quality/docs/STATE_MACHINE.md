# State Machine - Cecelia Quality Platform

本文档定义了 Cecelia Quality Platform 中的完整状态机模型。

---

## 概述

Cecelia Quality Platform 有两个主要的状态机：

1. **Task State Machine** - 任务的生命周期
2. **Run State Machine** - 单次执行的生命周期

这两个状态机协同工作，构成了完整的任务执行流程。

---

## 1. Task State Machine（任务状态机）

### 状态定义

| 状态 | 说明 | 可转换到 |
|------|------|----------|
| `inbox` | 收件箱（原始输入） | todo, cancelled |
| `todo` | 待执行（已入队） | doing, blocked, cancelled |
| `doing` | 执行中（Worker 正在处理） | done, blocked, cancelled |
| `blocked` | 阻塞（依赖未满足或错误） | todo, doing, cancelled |
| `done` | 已完成（成功） | - |
| `cancelled` | 已取消（用户或系统取消） | - |

### 状态流转图

```
                   ┌─────────┐
                   │  inbox  │  (原始输入)
                   └────┬────┘
                        │
                        ▼
                   ┌─────────┐
             ┌────▶│  todo   │  (待执行)
             │     └────┬────┘
             │          │
             │          ▼
    ┌────────┴────┐ ┌─────────┐
    │   blocked   │◀│  doing  │  (执行中)
    └─────────────┘ └────┬────┘
                         │
                         ▼
                    ┌─────────┐
                    │  done   │  (已完成)
                    └─────────┘

         (任何状态都可以转换到 cancelled)
```

### 触发条件

| 转换 | 触发者 | 条件 |
|------|--------|------|
| `inbox → todo` | Gateway | 任务验证通过，入队成功 |
| `todo → doing` | Worker | Worker 从队列中取出任务 |
| `doing → done` | Worker | 执行成功，Run status = succeeded |
| `doing → blocked` | Worker | 执行失败，Run status = failed，可重试 |
| `blocked → todo` | Heartbeat | 阻塞条件解除，重新入队 |
| `* → cancelled` | User/System | 用户取消或系统清理 |

### 代码示例

```bash
# 创建任务（inbox）
bash scripts/db-api.sh task:create $TASK_ID $PROJECT_ID "Run QA" runQA P0 '{}'

# 入队（inbox → todo）
bash gateway/gateway.sh enqueue "$TASK_JSON"

# 执行（todo → doing）
# Worker 自动执行

# 完成（doing → done）
bash scripts/db-api.sh task:update $TASK_ID done

# 阻塞（doing → blocked）
bash scripts/db-api.sh task:update $TASK_ID blocked
```

---

## 2. Run State Machine（执行状态机）

### 状态定义

| 状态 | 说明 | 可转换到 |
|------|------|----------|
| `queued` | 已排队（等待 Worker） | running, cancelled |
| `running` | 执行中（Worker 正在处理） | succeeded, failed, timeout, cancelled |
| `succeeded` | 执行成功 | - |
| `failed` | 执行失败（可重试） | - |
| `timeout` | 执行超时 | - |
| `cancelled` | 已取消 | - |

### 状态流转图

```
    ┌─────────┐
    │ queued  │  (等待执行)
    └────┬────┘
         │
         ▼
    ┌─────────┐
    │ running │  (执行中)
    └────┬────┘
         │
         ├──────┬──────┬──────┐
         ▼      ▼      ▼      ▼
   ┌─────────┬────────┬────────┬──────────┐
   │succeeded│ failed │timeout │cancelled │  (终态)
   └─────────┴────────┴────────┴──────────┘
```

### 触发条件

| 转换 | 触发者 | 条件 |
|------|--------|------|
| `queued → running` | Worker | Worker 开始执行 |
| `running → succeeded` | Worker | Exit code = 0 |
| `running → failed` | Worker | Exit code != 0 |
| `running → timeout` | Worker | 执行时间超过配置的 timeout |
| `* → cancelled` | User/System | 用户取消或 Worker 被杀 |

### 代码示例

```bash
# 创建 Run（queued）
bash scripts/db-api.sh run:create $RUN_ID $TASK_ID runQA P0

# 开始执行（queued → running）
bash scripts/db-api.sh run:update $RUN_ID running

# 成功（running → succeeded）
bash scripts/db-api.sh run:update $RUN_ID succeeded 0

# 失败（running → failed）
bash scripts/db-api.sh run:update $RUN_ID failed 1 "Error message"
```

---

## 3. 完整生命周期（Task + Run）

### 流程图

```
┌──────────────────────────────────────────────────────────┐
│                      Task 生命周期                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Inbox → Gateway 接收任务                              │
│             ├── 验证 schema                              │
│             └── 写入 DB (inbox)                          │
│                                                          │
│  2. Todo → Gateway 入队                                  │
│            ├── 写入 queue.jsonl                          │
│            └── 更新 DB (todo)                            │
│                                                          │
│  3. Doing → Worker 执行                                  │
│             ├── 创建 Run (queued)                        │
│             ├── 更新 Run (running)                       │
│             ├── 执行 Intent (runQA/fixBug/...)           │
│             ├── 收集 Evidence                            │
│             ├── 更新 Run (succeeded/failed)              │
│             └── 更新 Task (done/blocked)                 │
│                                                          │
│  4. Done → Evidence 归档                                 │
│            ├── 写入 runs/<runId>/summary.json            │
│            ├── 写入 Evidence 到 DB                       │
│            └── Notion 同步                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 时序图

```
User/N8N    Gateway    Queue    Worker    QA/CloudCode    DB    Notion
   │           │         │         │            │         │       │
   │──enqueue──▶│         │         │            │         │       │
   │           │─write──▶│         │            │         │       │
   │           │─insert──────────────────────────────────▶│       │
   │           │         │         │            │         │       │
   │           │         │◀─dequeue──│          │         │       │
   │           │         │         │─create run────────────▶│       │
   │           │         │         │            │         │       │
   │           │         │         │─execute────▶│         │       │
   │           │         │         │            │─run QA──▶│       │
   │           │         │         │            │◀─result──│       │
   │           │         │         │◀───done────│         │       │
   │           │         │         │                      │       │
   │           │         │         │─update run───────────▶│       │
   │           │         │         │─update task──────────▶│       │
   │           │         │         │─evidence add─────────▶│       │
   │           │         │         │                      │       │
   │           │         │         │───────sync───────────────────▶│
   │           │         │         │                      │       │
```

---

## 4. State 文件更新规则

### state.json 更新时机

| 事件 | 更新字段 |
|------|----------|
| Gateway 入队 | `queueLength` |
| Worker 完成 | `lastRun`, `queueLength`, `stats` |
| Heartbeat 检查 | `health`, `lastHeartbeat` |
| Notion 同步 | `lastSyncNotion` |

### DB system_state 表更新

```bash
# 更新队列长度
bash scripts/db-api.sh state:update queue_length 5

# 更新健康状态
bash scripts/db-api.sh state:update health '"ok"'

# 更新最近心跳
bash scripts/db-api.sh state:update last_heartbeat '"2026-01-27T10:00:00Z"'
```

---

## 5. 重试和恢复策略

### 重试规则

| 失败类型 | 重试次数 | 重试间隔 |
|----------|----------|----------|
| 网络错误 | 3 | 30s, 60s, 120s |
| 执行超时 | 1 | 5m |
| 依赖阻塞 | ∞ | Heartbeat 检查 (5m) |
| 用户取消 | 0 | - |

### 恢复流程

```bash
# 1. Heartbeat 检测阻塞任务
# 2. 检查阻塞条件是否解除
if [[ condition_resolved ]]; then
  # 3. 重新入队
  bash scripts/db-api.sh task:update $TASK_ID todo
  bash gateway/gateway.sh enqueue "$TASK_JSON"
fi
```

---

## 6. 清理策略

### 自动清理规则

| 状态 | 保留时长 | 清理触发 |
|------|----------|----------|
| done | 30 天 | Heartbeat |
| cancelled | 7 天 | Heartbeat |
| failed (无重试) | 14 天 | Heartbeat |

### 清理脚本

```bash
# 清理 30 天前的已完成任务
sqlite3 db/cecelia.db "DELETE FROM tasks WHERE status = 'done' AND completed_at < datetime('now', '-30 days');"

# 清理 7 天前的已取消任务
sqlite3 db/cecelia.db "DELETE FROM tasks WHERE status = 'cancelled' AND updated_at < datetime('now', '-7 days');"

# 清理 runs 目录（30 天前）
find runs/ -type d -mtime +30 -exec rm -rf {} \;
```

---

## 7. 监控指标

### 关键指标

| 指标 | 计算方式 | 健康阈值 |
|------|----------|----------|
| 成功率 | succeeded / total | > 95% |
| 平均执行时长 | avg(duration) | < 300s |
| 队列积压 | queueLength | < 10 |
| 阻塞任务数 | blocked count | < 3 |
| 24h 失败数 | failed (24h) | < 5 |

### 健康判定

```bash
# Health = ok
- 成功率 > 95%
- 队列积压 < 10
- 阻塞任务 < 3

# Health = degraded
- 成功率 80-95%
- 队列积压 10-50
- 阻塞任务 3-10

# Health = unhealthy
- 成功率 < 80%
- 队列积压 > 50
- 阻塞任务 > 10
```

---

## 8. 实际使用示例

### 完整流程示例

```bash
# Step 1: 初始化数据库
bash scripts/db-init.sh init

# Step 2: 启动 Gateway HTTP Server (后台)
nohup node gateway/gateway-http.js > /tmp/gateway.log 2>&1 &

# Step 3: 提交任务
curl -X POST http://localhost:5680/add \
  -H "Content-Type: application/json" \
  -d '{"source":"cloudcode","intent":"runQA","priority":"P0","payload":{"project":"cecelia-quality"}}'

# Step 4: Worker 执行
bash worker/worker.sh

# Step 5: 查看结果
bash scripts/db-api.sh tasks:active
bash scripts/db-api.sh system:health

# Step 6: 同步到 Notion
bash scripts/notion-sync.sh
```

---

**版本**: 1.0.0
**最后更新**: 2026-01-27
