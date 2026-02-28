---
id: prd-okr-unification
version: 1.0.0
created: 2026-02-26
updated: 2026-02-26
changelog:
  - 1.0.0: 初始版本
---

# PRD：OKR 系统矛盾统一

## 背景

Cecelia 的 OKR/任务系统存在 6 个设计意图与代码实现之间的核心矛盾。
这些矛盾导致系统行为不可预测：秋米被调用数百次产出 0 个有效 Task，
45 个空 Initiative 堵死系统，用户完全被绕过。

**根本原因**：文档和代码在拉扯两个不同的哲学——

- 文档说：**用户主导**，系统辅助
- 代码做：**系统自主**，全自动无人干预

必须选一个，然后彻底对齐。

---

## 6 个矛盾

### 矛盾 1：谁定 OKR？

| | 文档说的 | 代码做的 |
|---|---------|---------|
| **流程** | 用户定方向 → Cecelia 记录 → 秋米拆已确认的 KR | decomp-checker 自动扫所有 KR → 直接创建拆解任务 → 秋米派发 |
| **用户角色** | 决策者 | 被完全绕过 |
| **确认门禁** | 应该有 | 没有（除了一个从未启用的 manual_mode） |

**代码位置**：`decomposition-checker.js` L326-845，Check 1-6 全部自动创建任务，无用户确认。

### 矛盾 2：能同时跑多少条线？

4 套不同标准，互不兼容：

| 标准 | 来源 | 数值 |
|------|------|------|
| "2-3 条线" | 口头共识 | 2-3 |
| MAX_ACTIVE_PATHS | decomp-checker.js L41 | 10 |
| Task slots | slot-allocator.js | 8-12（动态） |
| capacity gate | decomp-checker.js L890 | 查数但无明确上限 |

**结果**：Project 层无限制，可能 50+ 个同时存在。

### 矛盾 3：Focus 机制形同虚设

| 阶段 | 是否尊重 Focus |
|------|---------------|
| focus.js 选焦点 | ✅ 选了 |
| planner.js 规划 | ✅ 焦点 KR +100 分 |
| tick.js 派发 | ❌ `dispatchNextTask(allGoalIds)` 全局扫描，无视焦点 |

**代码位置**：`tick.js` L1654，dispatch 用 allGoalIds 而不是 focusKrIds。

### 矛盾 4：decomp-checker 越权

| Check | 做的事 | 越权程度 |
|-------|--------|---------|
| Check 1-4 | 自动决定 Global OKR → KR → Area OKR → Project 的拆解 | 极度越权 — 直接替用户做战略决策 |
| Check 5 | 自动给 Project 创建 Initiative 拆解任务 | 中度越权 |
| Check 6 | 给空 Initiative 补 Task | 合理自动化 |

**Check 1-4 本质上在替用户做 OKR 规划**，用户没有机会说"这个方向我不想拆"。

### 矛盾 5：秋米的角色

| | 设计 | 实际 |
|---|------|------|
| 定位 | 战略顾问（OKR 拆解专家） | 执行工人（按模板填表） |
| 决策权 | 建议拆解方案 | 只能执行 decomp-checker 派的任务 |
| 创意空间 | 应该有 | 没有（拆什么、怎么拆都被预设了） |

### 矛盾 6：KR 状态流转断裂

- goals 表有 `pending → in_progress → completed` 流转
- **但代码里没有任何地方自动把 KR 从 pending 改成 in_progress**
- `decomposing` 状态在 SQL WHERE 里出现过一次，但从未被赋值
- 结果：KR 永远卡在创建时的状态，除非人工改

---

## 统一方案

### 核心决策：用户主导 + 系统执行

```
用户定方向（2-3 条线） → 标记 KR 为 ready
  → decomp-checker 只拆 ready 的 KR
    → 秋米有拆解决策权（怎么拆、分几层）
      → 产出 Task → Caramel 执行
```

### 变更 1：KR 加 "ready" 门禁

**goals 表已有的状态**：`pending | needs_info | ready | decomposing | in_progress | completed | cancelled`

**用起来**：
- `pending`：系统或用户创建，未审核
- `ready`：**用户确认要做**，decomp-checker 可以拆
- `decomposing`：秋米正在拆解中
- `in_progress`：有 Task 在执行
- `completed`：KR 完成

**decomp-checker 改动**：Check 1-6 的 WHERE 条件从 `NOT IN ('completed', 'cancelled')` 改为 `status = 'ready'`。

**用户操作**：通过 Cecelia 对话或 CeceliaPage 把 KR 标记为 ready。

### 变更 2：统一并行数

定义一个单一来源 `packages/brain/src/capacity.js`：

```
MAX_ACTIVE_STREAMS = 3      # 同时活跃的 KR（用户决定哪 3 个 ready）
MAX_PROJECTS_PER_KR = 2     # 每个 KR 下最多 2 个 active Project
MAX_INITIATIVES_PER_PROJECT = 3  # 每个 Project 下最多 3 个 active Initiative
MAX_QUEUED_TASKS = 9        # 全局排队任务上限
```

decomp-checker 的 capacity gate 改用这些统一常数。

### 变更 3：Focus = 用户选的 ready KR

废掉 focus.js 的自动选择逻辑。Focus 就是用户标记为 ready 的 KR 列表（最多 3 个）。

tick.js 的 dispatch 改为只派发 focus KR 下的任务：
```javascript
// 改前：dispatchNextTask(allGoalIds)
// 改后：dispatchNextTask(readyKrIds)
```

### 变更 4：decomp-checker 收权

| Check | 改前 | 改后 |
|-------|------|------|
| Check 1-4 | 自动创建 Goal 级拆解任务 | **删除** — KR 以上的层级由用户手动管理 |
| Check 5 | 自动创建 Project→Initiative 拆解 | 保留，但只对 ready KR 下的 Project |
| Check 6 | 自动给空 Initiative 补 Task | 保留，但只对 ready KR 下的 Initiative |

**秋米的权力回归**：Check 5 创建的拆解任务给秋米时，秋米可以决定怎么拆（几个 Initiative、每个多大），不再被模板限制死。

### 变更 5：KR 状态自动流转

```
用户标记 ready → decomp-checker 检测到 → 创建拆解任务 → 状态改 decomposing
  → 秋米完成拆解（创建了 Project/Initiative/Task）→ 状态改 in_progress
    → 所有 Task 完成 → 状态改 completed
```

代码里需要在以下位置加 UPDATE：
- decomp-checker 创建拆解任务后 → `UPDATE goals SET status = 'decomposing'`
- 秋米拆解完成回调 → `UPDATE goals SET status = 'in_progress'`
- 所有关联 Task 完成时 → `UPDATE goals SET status = 'completed'`

### 变更 6：dispatch rate 最小值保证

（已在 PR #17 修复）`Math.max(1, Math.floor(poolCAvailable * dispatchRate))`

---

## 变更影响清单

| 文件 | 变更类型 | 内容 |
|------|---------|------|
| `packages/brain/src/decomposition-checker.js` | 重构 | Check 1-4 删除；Check 5-6 加 ready 门禁 |
| `packages/brain/src/capacity.js` | 新建 | 统一并行数常数 |
| `packages/brain/src/tick.js` | 修改 | dispatch 用 readyKrIds 替代 allGoalIds |
| `packages/brain/src/planner.js` | 修改 | selectTopAreas 改为只看 ready KR |
| `packages/brain/src/focus.js` | 简化 | 废掉自动选择，Focus = ready KR 列表 |
| `DEFINITION.md` | 更新 | OKR 流程描述对齐新设计 |
| `packages/brain/migrations/` | 新增 | goals 表状态流转触发器（可选） |

## 不在范围

- CeceliaPage 前端对接（后续 PR）
- 秋米 /okr skill 的 prompt 重写（后续 PR）
- 历史 OKR 数据清理（用户手动盘点后执行）

---

## 执行顺序

1. **用户盘点现有 OKR** — 决定保留哪些 KR，标记 ready
2. **PR-A**：decomp-checker 加 ready 门禁 + 删 Check 1-4 + 统一 capacity
3. **PR-B**：Focus/dispatch 对齐 ready KR
4. **PR-C**：KR 状态自动流转
5. **重新启用 Tick**
