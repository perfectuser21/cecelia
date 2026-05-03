# RCA: slot-allocator effectiveSlots 缩减为 1 / Max Seats=2

**日期**: 2026-05-03  
**严重程度**: P1（连 P0 任务也受限流）  
**报告症状**: `env CECELIA_MAX_SEATS=10 + CECELIA_BUDGET_SLOTS=7`，运行时 `effectiveSlots=1, Max Seats=2`

---

## 一、症状描述

诊断 agent 实测：
- `CECELIA_MAX_SEATS=10`，`CECELIA_BUDGET_SLOTS=7` 已正确写入环境
- `/api/brain/tick/status` 返回 `max_concurrent=2, auto_dispatch_max=1`
- 实际运行时 `effectiveSlots=1`，系统严重限流，P0 任务排队

---

## 二、降级链路（完整追踪）

### Layer 0：硬件参数（platform-utils.js）

```
机器: TOTAL_MEM_MB=5983, CPU_CORES=6
usableMemMb = (5983 - 5000) * 0.8 = 786.4 MB
usableCpu   = 6 * 0.8 = 4.8

raw = floor(min(786.4/400, 4.8/0.5))
    = floor(min(1.966, 9.6))
    = 1

PHYSICAL_CAPACITY = min(max(1, 2), 20) = 2   ← 内存瓶颈，floor 到最小值 2
```

`SYSTEM_RESERVED_MB=5000` 为 OS 预留 5GB，此容器总内存 ~6GB，
可用任务内存仅 786MB，按 400MB/task 估算只够跑 1 个任务，故 `PHYSICAL_CAPACITY=2`（底部保护值）。

### Layer 1：getEffectiveMaxSeats()（executor.js:385-390，修复前）

```js
// 修复前代码：
function getEffectiveMaxSeats() {
  if (_budgetCap && _budgetCap > 0) {
    return Math.min(_budgetCap, PHYSICAL_CAPACITY);   // ← BUG
  }
  return PHYSICAL_CAPACITY;
}
```

```
_budgetCap = 7  (来自 CECELIA_BUDGET_SLOTS=7)
getEffectiveMaxSeats() = min(7, 2) = 2
```

**降级点 1**：用户显式设置的 `CECELIA_BUDGET_SLOTS=7` 被 `PHYSICAL_CAPACITY=2` 静默截断为 2。
没有日志、没有警告。

### Layer 2：MAX_SEATS 快照（executor.js:393）

```js
const MAX_SEATS = getEffectiveMaxSeats();  // = 2，模块启动时固化
```

`MAX_SEATS` 是启动快照，后续不会随 `_budgetCap` 变化。

### Layer 3：checkServerResources() SAFETY_MARGIN（executor.js:572）

```js
const SAFETY_MARGIN = 0.80;
effectiveSlots = Math.floor(effectiveSlots * SAFETY_MARGIN);
// = floor(2 * 0.80) = floor(1.6) = 1
```

**降级点 2**：即便零压力（cpuPressure=0, memPressure=0, swapPressure=0），
`floor(2 * 0.8) = 1`。

### Layer 4：tick-status.js 报出

```js
const AUTO_DISPATCH_MAX = Math.max(MAX_SEATS - INTERACTIVE_RESERVE, 1);
// = max(2 - 2, 1) = 1
```

`/api/brain/tick/status` 返回 `auto_dispatch_max=1`，即最终症状。

### 完整降级序列

```
ENV: CECELIA_BUDGET_SLOTS=7
  ↓ Layer 0
  PHYSICAL_CAPACITY = 2  (5983MB 总内存 - 5000MB 系统预留 → 786MB 可用 → 1 task)
  ↓ Layer 1 (BUG)
  getEffectiveMaxSeats() = min(7, 2) = 2  ← 用户意图被静默覆盖
  ↓ Layer 2
  MAX_SEATS = 2  (startup snapshot)
  ↓ Layer 3
  effectiveSlots = floor(2 * 0.80) = 1  (even at zero pressure)
  ↓ Layer 4
  auto_dispatch_max = max(2 - 2, 1) = 1
  ↓ 结果
  effectiveSlots=1, Max Seats=2  (诊断 agent 实测)
```

---

## 三、根因

**单一根因**：`getEffectiveMaxSeats()` 中 `Math.min(_budgetCap, PHYSICAL_CAPACITY)` 把用户显式设置的 budget cap 静默截断到硬件下界。

`PHYSICAL_CAPACITY` 的 400MB/task 假设在低内存容器（仅 ~1GB 可用）上极保守，
最小值保护（`max(raw, 2)`）让结果固定在 2。
这本是为"无 ENV 时估算上界"设计的，却被错误地用于限制"有 ENV 时的用户覆盖"。

**PHYSICAL_CAPACITY 的正确角色**：无 ENV 时的自动上界估算（防止在内存充足的高配机器上无限派发）。  
**真正的资源保护**：`checkServerResources()` 的压力缩放（cpu/memory/swap pressure）——这才是实时、动态的安全阀，在真实过载时会将 effectiveSlots 降到 0。

---

## 四、修复

**文件**: `packages/brain/src/executor.js:385-390`

```js
// 修复后：
function getEffectiveMaxSeats() {
  if (_budgetCap && _budgetCap > 0) {
    // Explicit budget override: honor as-is. PHYSICAL_CAPACITY is an estimate
    // based on 400MB/task assumption which bottoms out at 2 on low-RAM containers.
    // The real safety valve is checkServerResources() pressure-based scaling.
    return _budgetCap;
  }
  return PHYSICAL_CAPACITY;
}
```

修复后验证（零压力条件）：
```
_budgetCap = 7  (CECELIA_BUDGET_SLOTS=7)
getEffectiveMaxSeats() = 7
effectiveSlots = floor(7 * 0.80) = 5 = 7 - 2 = CECELIA_BUDGET_SLOTS - INTERACTIVE_RESERVE ✓

_budgetCap = 10  (CECELIA_MAX_SEATS=10)
getEffectiveMaxSeats() = 10
effectiveSlots = floor(10 * 0.80) = 8 = 10 - 2 = CECELIA_MAX_SEATS - INTERACTIVE_RESERVE ✓
```

---

## 五、影响范围

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 低内存容器 + BUDGET_SLOTS=7 | effectiveSlots=1 | effectiveSlots=5 |
| 低内存容器 + MAX_SEATS=10 | effectiveSlots=1 | effectiveSlots=8 |
| 高内存机器 + BUDGET_SLOTS=7 | effectiveSlots=5（已正常）| effectiveSlots=5（不变）|
| 无 ENV（自动估算） | 不变 | 不变（走 PHYSICAL_CAPACITY 路径）|

高内存机器（PHYSICAL_CAPACITY >= _budgetCap）行为不变，只有低内存容器受益。

---

## 六、预防措施

1. **启动日志**：Brain 启动时应打印 `PHYSICAL_CAPACITY`、`_budgetCap`、`getEffectiveMaxSeats()` 三值，便于运维快速发现截断
2. **告警条件**：若 `_budgetCap` 被截断（`_budgetCap > PHYSICAL_CAPACITY`），应打 WARN 日志提示用户
3. **测试**：`tests/slot-allocator-env-respect.test.js` 验证低内存机器上 ENV 被正确尊重
