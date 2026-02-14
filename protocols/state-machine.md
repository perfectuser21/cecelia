# State Machine（状态机）

## Task 状态

```
┌─────────┐
│ queued  │ ← 初始状态 / 被打回后重新排队
└────┬────┘
     │ Autumnrice/Nobel 派发
     ▼
┌──────────┐
│ assigned │ ← 已分配给执行者
└────┬─────┘
     │ 执行者开始
     ▼
┌─────────┐
│ running │ ← 执行中
└────┬────┘
     │
     ├─────────────────────┐
     ▼                     ▼
┌─────────┐          ┌─────────┐
│ success │          │ failed  │
└────┬────┘          └────┬────┘
     │                    │
     ▼                    │
┌──────────┐              │
│ [QA审核] │              │
└────┬─────┘              │
     │                    │
     ├──── 通过 ──→ ✅ done
     │
     └──── 打回 ──→ rejected ──→ queued (重新派发)
```

## 状态定义

| 状态 | 说明 | 谁能改 |
|------|------|--------|
| `queued` | 等待派发 | Autumnrice |
| `assigned` | 已分配执行者 | Nobel |
| `running` | 执行中 | 执行者 |
| `success` | 执行成功 | 执行者 |
| `failed` | 执行失败 | 执行者 |
| `rejected` | 被 QA/Audit 打回 | 小检/小审 |
| `cancelled` | 被取消 | Autumnrice/用户 |

## 打回规则

### 小检（QA）打回条件

- 缺少必要 evidence
- evidence 与 DoD 不符
- 输出格式错误
- 数据不完整

### 小审（Audit）打回条件

- 触犯红线策略（见 redline-policies.md）
- 泄露敏感信息
- 执行了未授权操作

### 打回后流程

```
rejected
    │
    ▼
Autumnrice 收到通知
    │
    ├── 可修复 → 修改 inputs/constraints → 重新派发 (queued)
    │
    └── 不可修复 → 上报 Cecelia → 通知用户
```

## 超时处理

| 状态 | 超时时间 | 超时动作 |
|------|----------|----------|
| assigned | 5 分钟 | → queued (重新派发) |
| running | 30 分钟 | → failed (超时) |

## 状态存储

### API 端点

```bash
# 创建任务
POST /api/orchestrator/v2/tasks
Body: TaskEnvelope

# 更新状态
PATCH /api/orchestrator/v2/tasks/:id/status
Body: { "status": "running" }

# 提交证据
POST /api/orchestrator/v2/tasks/:id/evidence
Body: { "screenshot": "...", "json_output": {...} }

# 打回任务
POST /api/orchestrator/v2/tasks/:id/reject
Body: { "reason": "...", "level": "L2", "action_required": "..." }

# 查询任务
GET /api/orchestrator/v2/tasks/:id
GET /api/orchestrator/v2/tasks?status=running&owner=nobel
```
