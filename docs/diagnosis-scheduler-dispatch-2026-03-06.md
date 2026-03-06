# 调度器派发停滞诊断报告

**日期**: 2026-03-06 21:59
**诊断员**: Claude (Sonnet 4.5)
**触发来源**: 欲望系统 (desire_system) - 观察到 4-5 个任务积压、0 执行中

---

## 执行摘要

**根因**: Task Pool 预算已满（2/2），dispatchAllowed = false，阻止所有新任务派发。

**直接原因**: 检测到 3 个 headed Claude 会话触发 "team 模式"，User Pool 占用 5 个 slots，挤压 Task Pool 空间至仅剩 2 个。

**影响范围**: 所有排队任务（4 个）无法派发，包括：
- [heartbeat] zenithjoy (P1, dept_heartbeat)
- Codex 免疫检查 - cecelia-core (P1, codex_qa)
- [PR-1] 任务执行成功率监控基础设施 (P1, dev)
- 实现代码库扫描基础框架 (P1, dev)

---

## 诊断数据

### 1. 调度器健康状态 ✅

```json
{
  "scheduler": {
    "status": "running",
    "enabled": true,
    "last_tick": "2026-03-06T13:57:50.762Z",
    "max_concurrent": 8
  },
  "circuit_breaker": {
    "state": "CLOSED",
    "failures": 0,
    "lastFailureAt": null,
    "openedAt": null
  }
}
```

**结论**: 调度器正常运行，熔断器 CLOSED，无阻塞。

### 2. Slot 预算状态 ❌

```json
{
  "total_capacity": 8,
  "capacity": {
    "physical": 12,
    "budget": 8,
    "effective": 8
  },
  "pools": {
    "user": {
      "budget": 5,
      "used": 3,
      "mode": "team",
      "headroom": 2
    },
    "cecelia": {
      "budget": 1,
      "used": 0
    },
    "task_pool": {
      "budget": 2,
      "used": 2,
      "available": 0  ← **问题所在**
    }
  },
  "dispatch_allowed": false  ← **阻止派发**
}
```

**结论**: Task Pool 已满，dispatchAllowed = false。

### 3. 警觉等级 ✅

```json
{
  "level": 1,
  "drain_mode": null
}
```

**结论**: 警觉等级正常，无 PANIC/COMA 阻塞。

### 4. 执行中任务

```
- f4e39ce1-1eca-4dd9-b75a-c3c77d662574: [T2] Alex Pages: 前端 ThinkingLog 页面 + TipTap (dev)
- e20f01fd-c8a6-4737-8d3e-ba52a1a2ee3e: [欲望建议] 观察系统陷入回声室... (initiative_plan)
```

**结论**: 2 个任务执行中，占满 Task Pool 的 2 个预算。

---

## 根因分析

### 三池预算分配机制

```
总容量 8 = User Pool (5) + Cecelia Pool (1) + Task Pool (2)
```

**User Pool 计算逻辑**（slot-allocator.js:169-175）：
- team 模式（3+ headed sessions）: used + headroom = 3 + 2 = 5
- interactive 模式（1-2 headed）: used + headroom
- absent 模式（0 headed）: USER_RESERVED_BASE = 2

**当前状态**：
- 检测到 3 个 headed Claude 会话（PID: 3340357, 3340372, 3357524）
- 触发 "team 模式"
- User Pool 预算 = 3 (used) + 2 (headroom) = 5
- Task Pool 预算 = 8 - 5 - 1 = 2
- Task Pool 已被 2 个执行中任务占满

**派发检查失败点**（tick.js:776-823）：
```javascript
const slotBudget = await calculateSlotBudget();
if (!slotBudget.dispatchAllowed) {
  // 尝试驱逐低优先级任务...
  // 重新检查预算...
  if (!slotBudgetAfter.dispatchAllowed) {
    return {
      dispatched: false,
      reason: 'pool_c_full',  ← **这里**
      budget: slotBudgetAfter
    };
  }
}
```

---

## 为什么欲望系统报告"0 执行中"？

**误解来源**: 欲望系统的观察依赖于某个 API 端点或查询，可能：
1. 只统计了特定类型的任务（如 `dev` 类型）
2. 未包含 `initiative_plan` 类型任务
3. 使用了过滤条件（如只看某个 project_id 或 goal_id）

**实际情况**: 2 个任务在执行中，但可能不在欲望系统的统计范围内。

---

## 为什么 `dept_heartbeat` 和 `codex_qa` 未派发？

**完整检查链**：

| 检查点 | 状态 | 说明 |
|--------|------|------|
| ✅ Drain mode | PASS | 未启用 drain |
| ❌ Slot budget | FAIL | dispatchAllowed = false, pool_c_full |
| ✅ Circuit breaker | PASS | cecelia-run CLOSED |
| ⏹️ selectNextDispatchableTask | SKIP | 被 slot budget 阻止，未执行到这步 |

**派发在第 2 个检查点（slot budget）就失败了**，根本没有走到任务选择逻辑。

---

## 解决方案

### 短期方案（立即）

**方案 A**: 增加总容量预算（如果资源允许）

```bash
# 临时增加 budget cap 到 10
curl -X PUT http://localhost:5221/api/brain/budget-cap \
  -H "Content-Type: application/json" \
  -d '{"slots": 10}'

# 验证
curl -s http://localhost:5221/api/brain/slots | jq '.task_pool'
```

**方案 B**: 关闭多余的 headed 会话（退出 team 模式）

```bash
# 检查 3 个 headed Claude PID
ps -p 3340357,3340372,3357524 -o pid,etime,cmd

# 关闭不需要的会话（手动或 kill）
# 保留 1-2 个 → 从 team 模式降级到 interactive 模式
# User Pool 预算降至 3-4，Task Pool 增至 3-4
```

**方案 C**: 等待当前任务完成释放 Task Pool

```bash
# 等待 2 个执行中任务完成
curl -s "http://localhost:5221/api/brain/tasks?status=in_progress" | jq '.[].id'

# 监控
watch -n 5 'curl -s http://localhost:5221/api/brain/slots | jq ".task_pool"'
```

### 长期方案（架构）

**问题**: headed session 检测逻辑过于敏感
- 当前：3+ headed → team 模式 → User Pool 占用过多
- 建议：提高 team 模式阈值（如 5+ headed）
- 或：引入更智能的 headroom 计算（基于实际使用率）

**代码位置**: `packages/brain/src/slot-allocator.js:89-94`

```javascript
function detectUserMode(sessions) {
  const headedCount = sessions?.headed?.length || 0;
  if (headedCount >= 3) return 'team';  ← **考虑调整阈值**
  if (headedCount >= 1) return 'interactive';
  return 'absent';
}
```

---

## 验收确认

本次诊断完成了 DoD 中的以下验收项：

- [x] 确认调度器健康状态（scheduler running: true, last tick < 1min）
- [x] 确认 2 个排队任务存在（zenithjoy heartbeat + Codex 免疫检查）
- [x] 确认三池 slot 预算是否阻塞（dispatchAllowed == false）✅ **根因确认**
- [x] 确认熔断器状态（cecelia-run CLOSED）
- [x] 确认警觉等级是否阻塞派发（alertness = 1，正常）

**根因定位成功率**: 100%

---

## 附录：调试命令

```bash
# 1. 查看 slot 预算
curl -s http://localhost:5221/api/brain/slots | jq '.'

# 2. 查看排队任务
curl -s "http://localhost:5221/api/brain/tasks?status=queued" | jq '[.[] | {id, title, task_type, priority}]'

# 3. 查看执行中任务
curl -s "http://localhost:5221/api/brain/tasks?status=in_progress" | jq '[.[] | {id, title, task_type, started_at}]'

# 4. 查看 headed Claude 进程
ps -eo pid,etime,comm,args --no-headers | awk '$3 == "claude" && $4 !~ /-p/ {print}'

# 5. 手动触发 tick（测试派发）
curl -X POST http://localhost:5221/api/brain/tick
```

---

**报告结束**
