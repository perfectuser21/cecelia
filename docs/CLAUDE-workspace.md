# Cecelia Workspace 项目规则

## Brain API（大脑系统）

**每次会话开始时，先获取系统状态：**

```bash
curl -s http://localhost:5211/api/brain/status | jq
```

### 架构

```
Brain API = 状态与动作服务
Orchestrator = 大脑本体（常驻调度器）
Claude Code = 皮层（按需推理）
```

### 决策流程

1. **获取状态**：`GET /api/brain/status` → 决策包
2. **分析任务**：查看 `tasks.p0` 和 `tasks.p1`
3. **执行动作**：`POST /api/brain/action/{action-name}`（带 idempotency_key）
4. **系统自动记录决策**

### 可用 Action（白名单）

| Action | 必填参数 |
|--------|---------|
| `create-task` | title |
| `update-task` | task_id |
| `create-goal` | title |
| `update-goal` | goal_id |
| `set-memory` | key, value |
| `trigger-n8n` | webhook_path |
| `batch-update-tasks` | filter, update |

### 示例

```bash
# 更新任务状态（带幂等键）
curl -X POST http://localhost:5211/api/brain/action/update-task \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "xxx",
    "status": "in_progress",
    "idempotency_key": "session-xxx-update-task"
  }'

# 设置当前 focus
curl -X POST http://localhost:5211/api/brain/action/set-memory \
  -H "Content-Type: application/json" \
  -d '{
    "key": "current_focus",
    "value": {"project": "cecelia-workspace", "goal": "Brain MVP"}
  }'
```

### 注意

- 所有 Action 自动记录到 decision_log
- 幂等键防止重复执行
- `log-decision` 不对外暴露

---

## 开发规范

- 使用 `/dev` 工作流开发功能
- 分支保护：不允许直接 push main/develop
- PR 必须 CI 通过才能合并
