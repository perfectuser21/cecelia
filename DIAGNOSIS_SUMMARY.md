# 调度器派发停滞诊断与修复总结

**日期**: 2026-03-06
**任务**: 诊断并修复 Brain 调度器派发逻辑停滞问题
**触发**: 欲望系统报告"4-5 个任务积压、0 执行中"

---

## 问题

调度器运行正常，但排队任务（zenithjoy heartbeat + Codex 免疫检查）从未被派发执行。

---

## 诊断结果

### 根因

**Task Pool 预算已满，dispatch_allowed = false，阻止所有新任务派发。**

### 详细分析

1. **三池预算分配**：
   - 总容量 8 = User Pool (5) + Cecelia Pool (1) + Task Pool (2)
   - 检测到 3 个 headed Claude 会话 → 触发 "team 模式"
   - User Pool 占用 5 个 slots，挤压 Task Pool 至仅剩 2 个

2. **Task Pool 状态**：
   - Budget: 2
   - Used: 2（2 个任务执行中）
   - Available: 0 ❌
   - dispatchAllowed: false ❌

3. **派发检查失败点**：
   - tick.js:776-823 的 slot budget 检查
   - 在第 2 个检查点就失败，未走到任务选择逻辑

---

## 修复方案

**方案 A（已执行）**: 增加总容量预算

```bash
curl -X PUT http://localhost:5221/api/brain/budget-cap \
  -H "Content-Type: application/json" \
  -d '{"slots": 10}'
```

**修复前后对比**：

| 项目 | 修复前 | 修复后 |
|------|--------|--------|
| Budget Cap | 8 slots | 10 slots |
| Task Pool Budget | 2 | 4 |
| dispatch_allowed | false ❌ | true ✅ |
| 派发结果 | 0 个 | 2 个成功派发 |

---

## 验证结果

✅ 修复后立即触发 tick，成功派发 2 个任务：
- [heartbeat] zenithjoy (dept_heartbeat, P1)
- [PR-1] 任务执行成功率监控基础设施 (dev, P1)

✅ Codex 免疫检查也在后续 tick 中成功派发

---

## 产物

1. **诊断报告**: `docs/diagnosis-scheduler-dispatch-2026-03-06.md`
   - 完整的诊断过程和数据
   - 9 个检查点分析
   - 3 种修复方案对比

2. **验收完成**: 所有 DoD 诊断项已验证
   - [x] 调度器健康确认
   - [x] 排队任务确认
   - [x] Slot 预算根因定位 ✅
   - [x] 熔断器状态确认
   - [x] 警觉等级确认
   - [x] 修复验证

---

## 长期建议

### 架构改进

**问题**: headed session 检测逻辑过于敏感
- 当前：3+ headed → team 模式 → User Pool 占用过多
- 建议：提高 team 模式阈值（如 5+ headed）

**代码位置**: `packages/brain/src/slot-allocator.js:89-94`

```javascript
function detectUserMode(sessions) {
  const headedCount = sessions?.headed?.length || 0;
  if (headedCount >= 3) return 'team';  // 考虑调整为 >= 5
  if (headedCount >= 1) return 'interactive';
  return 'absent';
}
```

---

## 总结

调度器派发停滞的根因是 **Task Pool 预算耗尽**，由 team 模式触发导致 User Pool 占用过多空间。通过增加总容量预算到 10，成功恢复派发功能，所有积压任务已正常派发执行。

**修复时间**: < 5 分钟
**影响范围**: 全局（所有排队任务）
**修复验证**: 100% 成功
