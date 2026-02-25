---
id: prd-action-loop
version: 1.0.0
created: 2026-01-28
---

# PRD: Action Loop（定时 Tick）

## 目标
实现定时自动推进机制，让 Brain 每隔一段时间自动检查状态并执行动作。

## 依赖
- PRD 03: 优先级引擎（获取今日焦点）

## 功能需求

### 1. Tick 机制

每 30 分钟执行一次 tick：
1. 获取今日焦点 OKR
2. 检查相关任务状态
3. 决定下一步动作
4. 执行动作（更新任务/创建任务/触发 n8n）
5. 记录决策日志

### 2. Tick API

#### POST /api/brain/tick
手动触发一次 tick
```json
{
  "success": true,
  "actions_taken": [
    { "action": "update-task", "task_id": "...", "status": "in_progress" }
  ],
  "next_tick": "2026-01-28T16:30:00Z"
}
```

#### GET /api/brain/tick/status
获取 tick 状态
```json
{
  "enabled": true,
  "interval_minutes": 30,
  "last_tick": "2026-01-28T16:00:00Z",
  "next_tick": "2026-01-28T16:30:00Z",
  "actions_today": 15
}
```

#### POST /api/brain/tick/enable
启用自动 tick

#### POST /api/brain/tick/disable
禁用自动 tick

### 3. N8N 集成

创建 n8n workflow：
- 触发器：每 30 分钟
- 动作：POST /api/brain/tick
- 错误处理：失败时通知

### 4. 决策逻辑

```javascript
async function tick() {
  const focus = await getDailyFocus();
  const tasks = await getTasksForObjective(focus.objective_id);

  // 决策规则
  const inProgress = tasks.filter(t => t.status === 'in_progress');

  if (inProgress.length === 0) {
    // 没有进行中的任务，选一个开始
    const next = tasks.find(t => t.status === 'queued');
    if (next) {
      await updateTask(next.id, { status: 'in_progress' });
    }
  }

  // 检查超时任务
  const stale = tasks.filter(t => isStale(t));
  for (const task of stale) {
    await logDecision('stale_task_detected', task);
  }
}
```

## 验收标准
- [ ] 可以手动触发 tick
- [ ] tick 能自动选择并推进任务
- [ ] n8n workflow 配置完成
- [ ] 决策日志记录完整
