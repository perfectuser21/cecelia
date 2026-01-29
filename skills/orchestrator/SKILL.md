---
id: orchestrator
version: 1.0.0
created: 2026-01-29
updated: 2026-01-29
changelog:
  - 1.0.0: 初始版本 - Orchestrator Agent
---

# Orchestrator Skill

统一任务调度中心。接收高层需求，拆解成具体任务，分配给 Workers 执行。

## 触发方式

1. **Cecelia 语音调用**：用户通过语音说需求，Cecelia 调用 `run_orchestrator` tool
2. **手动调用**：`/orchestrator <需求描述>`

## 架构

```
Cecelia (语音) → run_orchestrator tool → claude -p "/orchestrator ..."
                                              │
                                              ▼
                                       Orchestrator (本 skill)
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
              Worker 1                  Worker 2                  Worker 3
           (无头 Claude)             (无头 Claude)              (空闲 seat)
```

## 执行流程

### Step 1: 分析需求

理解用户的高层需求，提取：
- 功能描述
- 技术约束
- 优先级

### Step 2: 查询上下文

```bash
# OKR 列表
curl -s http://localhost:5212/api/tasks/goals | jq '.[] | {id, title, status, priority}'

# 项目列表
curl -s http://localhost:5212/api/tasks/projects | jq '.[] | {id, name, repo_path}'

# 现有任务
curl -s http://localhost:5212/api/tasks/tasks | jq '.[] | {id, title, status}'

# 可用 Workers
curl -s http://localhost:5212/api/watchdog/status | jq '.data.agents'
```

### Step 3: 关联 OKR

根据需求找到最相关的 OKR 目标。

### Step 4: 拆解任务

创建具体可执行的任务：

```bash
curl -X POST http://localhost:5212/api/tasks/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "设计登录 API",
    "priority": "P1",
    "status": "pending",
    "goal_id": "<okr_id>",
    "description": "..."
  }'
```

### Step 5: 检查 Seats & 分配

```bash
MAX_WORKERS=3
RUNNING=$(curl -s http://localhost:5212/api/watchdog/status | jq '.data.agents | length')
AVAILABLE=$((MAX_WORKERS - RUNNING))

# 如果有空闲 seat，触发 worker
if [ $AVAILABLE -gt 0 ]; then
  cecelia-run <project_path> "/dev <prd_path>"
fi
```

## 输出格式

```json
{
  "success": true,
  "analysis": {
    "requirement": "用户要做登录功能",
    "related_okr": "Brain MVP",
    "priority": "P1"
  },
  "tasks_created": [
    {"id": "xxx", "title": "设计登录 API"}
  ],
  "workers_assigned": 1,
  "seats_available": 2
}
```
