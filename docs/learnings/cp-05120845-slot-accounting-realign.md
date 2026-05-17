# Learning: Slot Accounting — DB-authoritative in_progress 对齐

**Branch**: cp-05120845-slot-accounting-realign
**Date**: 2026-05-12
**PR**: P1 B3

---

### 根本原因

`calculateSlotBudget()` 的 `totalRunning` 计算用了：

```js
Math.max(sessions.total, ceceliaUsed + autoDispatchUsed)
```

`sessions.total` = headed 进程数 + headless 进程数。headless 进程中包含**任务已完成但进程尚未退出**的孤儿进程（zombie orphans）。

实证：DB `in_progress=0`，但有 8 个孤儿 headless 进程在 ps 里，导致 `sessions.total=8`，`totalRunning=8`，`availableRaw = effectiveSlots - 8 = 0`，`dispatch_allowed=false`。dispatcher 死锁。

### 修复

移除 `Math.max(ps, db)` 模式，改用三源相加（均为真值）：

```js
const totalRunning = userSlotsUsed + ceceliaUsed + autoDispatchUsed;
```

- `userSlotsUsed` = headed 进程数（真实用户会话，ps 准确）
- `ceceliaUsed` / `autoDispatchUsed` = DB count（tasks WHERE status='in_progress'）
- headless 孤儿进程：不再计入 Pool C 算法

### 下次预防

- [ ] 任何涉及 `sessions.total` 的算法都要警惕：`sessions.total = headed + headless`，headless 可能含僵尸进程
- [ ] Pool C 的 available 计算应只依赖真值来源：DB（任务状态）+ ps headed（用户会话）
- [ ] "ps 检测 > DB 计数" 场景不应该缩减派发槽位，应该以 DB 为准
- [ ] 孤儿进程清理（B2 zombie reaper）与 slot-allocator 公式解耦：即使孤儿进程未被清理，dispatcher 也不应被卡死
