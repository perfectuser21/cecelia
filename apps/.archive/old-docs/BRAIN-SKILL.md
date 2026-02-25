---
id: brain-skill
version: 1.1.0
created: 2026-01-28
updated: 2026-01-28
changelog:
  - 1.0.0: Initial Brain Skill documentation
  - 1.1.0: 修正定义，添加白名单+幂等性，拆分 status API
---

# Brain Skill - Cecelia 大脑系统

## 架构定义

```
Brain API = 状态与动作服务
Orchestrator = 大脑本体（常驻调度器）
Claude Code / Cecelia = 皮层（按需推理）
```

```
┌─────────────────────────────────────────────────────────────┐
│  用户 / 前台                                                 │
│     ↓                                                        │
│  Claude Code / Cecelia（皮层 / 按需推理）                     │
│     ↓                                                        │
│  Cecelia-Orchestrator（大脑本体 / 常驻调度器）                │
│     │                                                        │
│     ├── State DB: policy, working_memory, decision_log      │
│     └── Brain API: 状态与动作服务                            │
└─────────────────────────────────────────────────────────────┘
```

## API 端点

### 状态读取

| 端点 | 说明 |
|------|------|
| `GET /api/brain/status` | 精简决策包（给 LLM 皮层用，固定 schema）|
| `GET /api/brain/status/full` | 完整状态（给人 debug 用）|
| `GET /api/brain/tasks` | 优先级排序的任务列表 |
| `GET /api/brain/memory` | 工作记忆 |
| `GET /api/brain/policy` | 当前策略 |
| `GET /api/brain/decisions` | 历史决策记录（只读审计）|

### 动作执行（白名单 + 幂等）

| 端点 | 必填参数 | 说明 |
|------|---------|------|
| `POST /action/create-task` | title | 创建任务 |
| `POST /action/update-task` | task_id | 更新任务状态/优先级 |
| `POST /action/batch-update-tasks` | filter, update | 批量更新 |
| `POST /action/create-goal` | title | 创建目标 |
| `POST /action/update-goal` | goal_id | 更新目标 |
| `POST /action/set-memory` | key, value | 设置工作记忆 |
| `POST /action/trigger-n8n` | webhook_path | 触发 N8N |

**注意**：`log-decision` 不对外暴露，由系统内部自动记录。

## 决策包 Schema（固定）

`GET /api/brain/status` 返回：

```json
{
  "policy_version": 1,
  "policy_rules": {
    "priority_order": ["P0", "P1", "P2"],
    "confidence_threshold": 0.6,
    "allowed_actions": ["create-task", "update-task", ...]
  },
  "memory": {
    "current_focus": { "project": "xxx", "goal": "xxx" },
    "today_intent": { "description": "今日目标" },
    "blocked_by": { "items": [] }
  },
  "recent_decisions": [
    { "ts": "...", "action": "create-task", "status": "success" }
  ],
  "system_health": {
    "n8n_ok": true,
    "n8n_failures_1h": 0,
    "task_system_ok": true
  },
  "tasks": {
    "p0": [...],
    "p1": [...],
    "stats": { "open_p0": 1, "open_p1": 2, "in_progress": 1, "queued": 3 }
  }
}
```

## 幂等性

所有 Action 支持幂等键，防止重复触发：

```bash
curl -X POST /api/brain/action/create-task \
  -d '{
    "title": "新任务",
    "idempotency_key": "decision-123-create-task"
  }'
```

重复请求会返回：
```json
{
  "success": true,
  "duplicate": true,
  "previousResult": { ... }
}
```

## 白名单

只允许以下 Action：
- `create-task`
- `update-task`
- `batch-update-tasks`
- `create-goal`
- `update-goal`
- `set-memory`
- `trigger-n8n`

其他 Action 会被拒绝。

## 使用示例

### 1. 皮层（Claude Code）进来时

```bash
# 先获取决策包
curl -s http://localhost:5212/api/brain/status | jq

# 根据状态做决策...

# 执行动作（带幂等键）
curl -X POST http://localhost:5212/api/brain/action/update-task \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "xxx",
    "status": "in_progress",
    "idempotency_key": "session-abc-update-task-xxx"
  }'
```

### 2. Debug 时

```bash
# 获取完整状态
curl -s http://localhost:5212/api/brain/status/full | jq

# 查看决策日志
curl -s http://localhost:5212/api/brain/decisions | jq
```
