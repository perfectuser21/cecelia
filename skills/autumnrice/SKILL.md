---
id: autumnrice
version: 1.0.0
created: 2026-01-29
updated: 2026-01-29
changelog:
  - 1.0.0: 初始版本
---

# /autumnrice - 秋米 (管家/调度)

Autumnrice 是管家/调度 Agent，负责：
- 分析用户需求
- 拆解成具体任务
- 分配给其他 Agent 执行

## 实现

**无头 CC + Opus 模型 + /autumnrice Skill**

```bash
claude -p "/autumnrice 帮我做登录功能" --model opus
```

## Agent 家族

| Agent | Skill | 模型 | 职责 |
|-------|-------|------|------|
| Cecelia | /cecelia | Haiku | 入口 |
| Autumnrice | /autumnrice | Opus | 调度 |
| Caramel | /dev | Sonnet | 编程 |
| Nobel | N8N | - | 自动化 |

## 架构

```
Cecelia (入口) → call_autumnrice tool → claude -p "/autumnrice ..." --model opus
                                              │
                                              ▼
                                       Autumnrice (本 skill)
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
              Caramel (/dev)           Nobel (N8N)                其他 Agent
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
```

### Step 3: 拆解任务

创建具体可执行的任务，分配给 Caramel (/dev)：

```bash
# 如果是编程任务，调用 Caramel
claude -p "/dev <prd_path>" --model sonnet

# 如果是自动化任务，调用 Nobel (N8N)
# TODO: N8N 集成
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
  "agent_assigned": "Caramel"
}
```
