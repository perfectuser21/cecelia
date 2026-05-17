# P0 harness 跳过 backpressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 8 个 P0 `harness_*` task 在 backpressure 触发时跳过 burst limit，避免被 88 个 P1 content-pipeline 积压拖累。

**Architecture:** 在 `slot-allocator.js` 加 `BACKPRESSURE_BYPASS_TASK_TYPES` 白名单常量 + `shouldBypassBackpressure(task)` 工具函数，并让 `getBackpressureState()` 接受可选 `task` 参数；匹配白名单时直接返回 `active=false, override_burst_limit=null`。`dispatch-helpers.js` 选中候选任务时给匹配 task 打 `_bypass_backpressure` 标记。

**Tech Stack:** Node.js ESM, vitest

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `packages/brain/src/slot-allocator.js` | 加白名单常量、工具函数、修改 `getBackpressureState` 支持 task 入参 |
| `packages/brain/src/dispatch-helpers.js` | `selectNextDispatchableTask` 给匹配 task 打 bypass 标记 |
| `packages/brain/src/__tests__/slot-allocator.test.js` | 新增 `shouldBypassBackpressure` 真值表 + `getBackpressureState({task})` 行为测试 |

---

### Task 1: 加白名单常量和 shouldBypassBackpressure 函数

**Files:**
- Modify: `packages/brain/src/slot-allocator.js`
- Test: `packages/brain/src/__tests__/slot-allocator.test.js`

- [ ] **Step 1: 写失败的测试 — shouldBypassBackpressure 真值表**

在 `packages/brain/src/__tests__/slot-allocator.test.js` 文件末尾（在最后一个 `describe` 块之后，但在文件末尾的 export/末花括号之前）追加：

```javascript
import { shouldBypassBackpressure, BACKPRESSURE_BYPASS_TASK_TYPES } from '../slot-allocator.js';

describe('shouldBypassBackpressure: P0 harness whitelist', () => {
  it('exports BACKPRESSURE_BYPASS_TASK_TYPES with 8 harness types', () => {
    expect(BACKPRESSURE_BYPASS_TASK_TYPES).toEqual([
      'harness_initiative',
      'harness_task',
      'harness_planner',
      'harness_contract_propose',
      'harness_contract_review',
      'harness_fix',
      'harness_ci_watch',
      'harness_deploy_watch',
    ]);
  });

  it('P0 harness_task → true', () => {
    expect(shouldBypassBackpressure({ priority: 'P0', task_type: 'harness_task' })).toBe(true);
  });

  it('P0 harness_initiative → true', () => {
    expect(shouldBypassBackpressure({ priority: 'P0', task_type: 'harness_initiative' })).toBe(true);
  });

  it('P1 harness_task → false (priority 不匹配)', () => {
    expect(shouldBypassBackpressure({ priority: 'P1', task_type: 'harness_task' })).toBe(false);
  });

  it('P0 content-pipeline → false (task_type 不在白名单)', () => {
    expect(shouldBypassBackpressure({ priority: 'P0', task_type: 'content-pipeline' })).toBe(false);
  });

  it('null/undefined task → false', () => {
    expect(shouldBypassBackpressure(null)).toBe(false);
    expect(shouldBypassBackpressure(undefined)).toBe(false);
    expect(shouldBypassBackpressure({})).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd packages/brain && npx vitest run src/__tests__/slot-allocator.test.js -t "shouldBypassBackpressure"
```

Expected: FAIL（`shouldBypassBackpressure` / `BACKPRESSURE_BYPASS_TASK_TYPES` 未导出）

- [ ] **Step 3: 实现常量和函数**

在 `packages/brain/src/slot-allocator.js` 现有的 `MEMORY_PRESSURE_THRESHOLD_MB = 600;` 行下方追加：

```javascript

// ============================================================
// Backpressure Bypass Whitelist (P0 harness 优先派发)
// ============================================================
// 8 个 harness_* 类型在 priority=P0 时跳过 backpressure burst limit，
// 避免被 content-pipeline 积压拖累。
const BACKPRESSURE_BYPASS_TASK_TYPES = [
  'harness_initiative',
  'harness_task',
  'harness_planner',
  'harness_contract_propose',
  'harness_contract_review',
  'harness_fix',
  'harness_ci_watch',
  'harness_deploy_watch',
];

/**
 * 判断 task 是否应该跳过 backpressure。
 * 必须同时满足 priority='P0' AND task_type 在白名单。
 * @param {{priority?:string, task_type?:string}|null|undefined} task
 * @returns {boolean}
 */
function shouldBypassBackpressure(task) {
  if (!task) return false;
  if (task.priority !== 'P0') return false;
  return BACKPRESSURE_BYPASS_TASK_TYPES.includes(task.task_type);
}
```

然后在文件末尾 `export { ... }` 块中追加 `BACKPRESSURE_BYPASS_TASK_TYPES,` 和 `shouldBypassBackpressure,`。

- [ ] **Step 4: 运行测试验证通过**

```bash
cd packages/brain && npx vitest run src/__tests__/slot-allocator.test.js -t "shouldBypassBackpressure"
```

Expected: PASS（6 个 it 全绿）

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/slot-allocator.js packages/brain/src/__tests__/slot-allocator.test.js
git commit -m "feat(brain): 加 BACKPRESSURE_BYPASS_TASK_TYPES 白名单 + shouldBypassBackpressure"
```

---

### Task 2: getBackpressureState 接受 task 参数支持 bypass

**Files:**
- Modify: `packages/brain/src/slot-allocator.js`
- Test: `packages/brain/src/__tests__/slot-allocator.test.js`

- [ ] **Step 1: 写失败的测试**

在 `packages/brain/src/__tests__/slot-allocator.test.js` 上一步追加的 describe 之后追加：

```javascript
describe('getBackpressureState: task bypass behavior', () => {
  it('queue_depth=200 + P0 harness_task → active=false, override_burst_limit=null', async () => {
    const { getBackpressureState } = await import('../slot-allocator.js');
    const state = getBackpressureState({
      queue_depth: 200,
      task: { priority: 'P0', task_type: 'harness_task' },
    });
    expect(state.active).toBe(false);
    expect(state.override_burst_limit).toBeNull();
    expect(state.queue_depth).toBe(200);
  });

  it('queue_depth=200 + P1 content-pipeline → active=true, override_burst_limit=3 (保持原行为)', async () => {
    const { getBackpressureState } = await import('../slot-allocator.js');
    const state = getBackpressureState({
      queue_depth: 200,
      task: { priority: 'P1', task_type: 'content-pipeline' },
    });
    expect(state.active).toBe(true);
    expect(state.override_burst_limit).toBe(3);
  });

  it('queue_depth=200 不传 task → active=true, override_burst_limit=3 (默认行为不变)', async () => {
    const { getBackpressureState } = await import('../slot-allocator.js');
    const state = getBackpressureState({ queue_depth: 200 });
    expect(state.active).toBe(true);
    expect(state.override_burst_limit).toBe(3);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd packages/brain && npx vitest run src/__tests__/slot-allocator.test.js -t "task bypass"
```

Expected: FAIL（第一个 case 应失败：`active=true` 而期望 `false`）

- [ ] **Step 3: 修改 getBackpressureState 加 task 参数**

在 `packages/brain/src/slot-allocator.js` 中，找到 `function getBackpressureState({` 函数签名，把入参从：

```javascript
function getBackpressureState({
  queue_depth,
  memory_available_mb,
  brain_rss_mb,
  system_total_mb,
  memory_health,
} = {}) {
```

改为：

```javascript
function getBackpressureState({
  queue_depth,
  memory_available_mb,
  brain_rss_mb,
  system_total_mb,
  memory_health,
  task,
} = {}) {
```

并在该函数 `const queuePressure = queue_depth > BACKPRESSURE_THRESHOLD;` 行**之前**插入 bypass 短路：

```javascript
  // P0 harness 白名单短路：直接返回 inactive，让 burst_limit 不生效
  if (shouldBypassBackpressure(task)) {
    return {
      active: false,
      queue_depth,
      threshold: BACKPRESSURE_THRESHOLD,
      queue_pressure: false,
      memory_pressure: false,
      memory_available_mb,
      memory_threshold_mb: MEMORY_PRESSURE_THRESHOLD_MB,
      memory_health: null,
      override_burst_limit: null,
      bypassed: true,
    };
  }
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd packages/brain && npx vitest run src/__tests__/slot-allocator.test.js -t "task bypass"
```

Expected: PASS（3 个 it 全绿）

- [ ] **Step 5: 跑整个 slot-allocator 测试集回归**

```bash
cd packages/brain && npx vitest run src/__tests__/slot-allocator.test.js
```

Expected: PASS（所有原有 case + 新增 case 都绿，无回归）

- [ ] **Step 6: 提交**

```bash
git add packages/brain/src/slot-allocator.js packages/brain/src/__tests__/slot-allocator.test.js
git commit -m "feat(brain): getBackpressureState 接受 task 参数支持 P0 harness bypass"
```

---

### Task 3: dispatch-helpers 给匹配候选打 bypass 标记

**Files:**
- Modify: `packages/brain/src/dispatch-helpers.js`
- Test: `packages/brain/src/__tests__/slot-allocator.test.js`

- [ ] **Step 1: 写失败的测试 — dispatch-helpers 模块单元行为**

在 `packages/brain/src/__tests__/slot-allocator.test.js` 末尾追加：

```javascript
describe('dispatch-helpers: bypass marker on candidates', () => {
  it('shouldBypassBackpressure 可被 dispatch-helpers 引用（合同测试）', async () => {
    // 静态校验 dispatch-helpers.js 引用了 shouldBypassBackpressure
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../dispatch-helpers.js', import.meta.url),
      'utf8'
    );
    expect(src).toContain('shouldBypassBackpressure');
    expect(src).toContain('_bypass_backpressure');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd packages/brain && npx vitest run src/__tests__/slot-allocator.test.js -t "bypass marker"
```

Expected: FAIL（dispatch-helpers.js 还没引用 shouldBypassBackpressure）

- [ ] **Step 3: 修改 dispatch-helpers.js**

在 `packages/brain/src/dispatch-helpers.js` 顶部 import 段：

```javascript
import pool from './db.js';
import { updateTask, createTask } from './actions.js';
import { sortTasksByWeight } from './task-weight.js';
import { handleTaskFailure } from './quarantine.js';
```

后面追加一行：

```javascript
import { shouldBypassBackpressure } from './slot-allocator.js';
```

然后在 `selectNextDispatchableTask` 函数中找到这段（循环结尾返回 task 那一段）：

```javascript
    // NOTE: task_dependencies 表依赖检查已在主 SELECT 的 WHERE 子句
    // （NOT EXISTS + from_task_id 子查询）完成，见 harness-dag.js:nextRunnableTask
    // 的同款做法。本循环此处只需处理 payload.depends_on 的软依赖。
    return task;
  }
  return null;
}
```

把 `return task;` 改为：

```javascript
    // P0 harness 白名单：给候选打 bypass 标记，调用方可识别跳过 burst limit
    if (shouldBypassBackpressure(task)) {
      task._bypass_backpressure = true;
    }
    return task;
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd packages/brain && npx vitest run src/__tests__/slot-allocator.test.js -t "bypass marker"
```

Expected: PASS

- [ ] **Step 5: 跑整个 brain 包测试集回归**

```bash
cd packages/brain && npx vitest run src/__tests__/slot-allocator.test.js src/__tests__/dispatch-preflight-skip.test.js src/__tests__/select-next-claimed-filter.test.js
```

Expected: PASS（slot-allocator + dispatch-helpers 相关测试全绿）

- [ ] **Step 6: 提交**

```bash
git add packages/brain/src/dispatch-helpers.js packages/brain/src/__tests__/slot-allocator.test.js
git commit -m "feat(brain): selectNextDispatchableTask 给 P0 harness 候选打 _bypass_backpressure 标记"
```

---

## Self-Review

- **Spec coverage**：4 条成功标准对应 Task 1（ARTIFACT 常量）+ Task 2（BEHAVIOR 1+2）+ Task 2 Step 5（BEHAVIOR 3 全绿）。
- **Placeholder scan**：无 TBD/TODO/省略代码。每步包含完整代码或精确命令。
- **Type consistency**：`BACKPRESSURE_BYPASS_TASK_TYPES`/`shouldBypassBackpressure` 在所有 task 中签名一致。`task._bypass_backpressure` 标记名贯穿 Task 3。
- **No Placeholders**：所有 step 均含具体代码和具体命令。
