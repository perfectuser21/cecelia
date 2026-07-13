# capture-triage line_backlog 自动建task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `capture-triage.js` 的 `routeAtom` line_backlog 分支从"仅标记 atom"改为"真正调用 `createTask` 建 `harness_initiative` 任务"，让 Brain dispatcher tick 自动拾取执行；命中生产环境护栏时保留原有仅标记行为。

**Architecture:** 在 `packages/brain/src/capture-triage.js` 新增 `isProductionSensitive(atom)` 纯函数护栏 + 改造 `routeAtom` 的 `line_backlog` 分支，引入 `actions.js` 的 `createTask`。测试用 `vi.mock('../actions.js', ...)` 隔离真实 DB 依赖。

**Tech Stack:** Node.js, vitest, PostgreSQL（既有 pool 注入测试模式）

---

## 背景 Context（给零上下文的工程师）

- `packages/brain/src/capture-triage.js` 是 Brain 的收件箱四路分诊 tick job。`routeAtom(pool, atom, verdict, opts)` 函数（约第83-136行）按 `verdict.route` 落地四路之一：`urgent` / `line_backlog` / `invariant` / `okr`。
- 当前 `line_backlog` 分支（第88-97行）：从源 task 的 `payload.journey_id` 拿到 journeyId后，只是把 atom 标记为 `status=confirmed, routed_to_table='journeys', routed_to_id=journeyId`，从不创建任何可执行任务。
- 决策 `57d296a1`（`decisions` 表）要求改为真正创建 Brain task（`task_type='harness_initiative'`），让 Brain 既有 dispatcher tick 自动拾取执行；同时要求护栏：涉及生产环境的条目仍走原有仅标记流程。
- `createTask` 定义在 `packages/brain/src/actions.js:96`，接受 `{ title, description, priority, task_type, trigger_source, payload, goal_id, ... }`。若 `goal_id` 未提供且 `trigger_source` 不在 `actions.js` 的 `isSystemTask()` 白名单（`packages/brain/src/actions.js:15-23`，含 `'cortex'`）内，会 throw。本项目沿用已有先例 `packages/brain/src/learning.js:139` 的写法：`trigger_source: 'cortex'` 绕过 `goal_id` 必填。
- `createTask` 成功时返回 `{ success: true, task: {...} }`（`task.id` 是新任务 uuid）；`task_type='harness_initiative'` 时 Brain 对 `payload.orchestrator` 有硬校验，必须是 `'skill-relay'`（见 `packages/brain/src/routes/task-tasks.js` 的相关 warn 逻辑与 CLAUDE.md 中记录的硬性字段要求）。
- 测试文件 `packages/brain/src/__tests__/capture-triage.test.js` 用一个手写的 fake `pool`（`makePool()` 辅助函数）驱动 `runCaptureTriage`，并对 `../invariant-gate.js` 用 `vi.mock` 隔离。`createTask` 真实实现内部使用自己 import 的 `./db.js` 单例 pool（不接受注入的 pool 参数），所以必须同样用 `vi.mock('../actions.js', ...)` 隔离，否则单测会打真实 DB。

## File Structure

- Modify: `packages/brain/src/capture-triage.js` — 加 `isProductionSensitive` 导出函数 + import `createTask` + 改 `routeAtom` 的 `line_backlog` 分支
- Modify: `packages/brain/src/__tests__/capture-triage.test.js` — mock `../actions.js`；新增 3 条测试；改写既有 `line_backlog：handoff FAIL → routed 改写为 journeys/journey_id` 测试为新行为

---

### Task 1: 加生产环境护栏函数 + import createTask

**Files:**
- Modify: `packages/brain/src/capture-triage.js:16-21`

- [ ] **Step 1: 写 import + 护栏函数（先加代码，无独立单测——纯函数会被 Task 3 的分支测试间接覆盖）**

在文件顶部 import 区块加入：

```js
import { callLLM } from './llm-caller.js';
import { checkInvariantCandidate } from './invariant-gate.js';
import { createTask } from './actions.js';

export const TRIAGE_SOURCE_TYPES = ['handoff', 'learning', 'issue'];
export const ROUTES = ['urgent', 'line_backlog', 'invariant', 'okr'];
export const LLM_CONFIDENCE_FLOOR = 0.7;

// 决策57d296a1护栏：命中生产环境相关关键词的 atom 不走自动建 task，留人工排期
const PRODUCTION_SENSITIVE_PATTERN = /生产环境|生产|production|prod\s*env|LLM渠道切换/i;

/** 是否命中生产环境护栏（决策57d296a1）。命中 → 不自动建 task，留原有仅标记流程。 */
export function isProductionSensitive(atom) {
  const text = `${atom.content || ''} ${atom.target_subtype || ''}`;
  return PRODUCTION_SENSITIVE_PATTERN.test(text);
}
```

这一步替换掉原文件第16-21行（原 import 两行 + 三个 const 导出）。

- [ ] **Step 2: 语法自检**

Run: `cd packages/brain && node --check src/capture-triage.js`
Expected: 无输出（exit 0）

- [ ] **Step 3: Commit（暂不提交，等 Task 2 测试写完一起走 TDD 两段式——见 Task 2/3 说明）**

本 Task 不单独 commit，代码改动会和 Task 2 的 Red 测试、Task 3 的实现一起走标准 TDD commit 顺序（见 Task 3 末尾）。

---

### Task 2: 写 line_backlog 新行为的失败测试（TDD Red）

**Files:**
- Modify: `packages/brain/src/__tests__/capture-triage.test.js`

- [ ] **Step 1: 在文件顶部加 `vi.mock('../actions.js', ...)`**

修改文件顶部（原第1-5行）为：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyCheapRules, isProductionSensitive, runCaptureTriage, updateAtom, __resetCaptureTriageForTest } from '../capture-triage.js';

vi.mock('../invariant-gate.js', () => ({ checkInvariantCandidate: vi.fn() }));
import { checkInvariantCandidate } from '../invariant-gate.js';

vi.mock('../actions.js', () => ({ createTask: vi.fn() }));
import { createTask } from '../actions.js';
```

- [ ] **Step 2: 在 `beforeEach` 里加 `createTask` 重置 + 默认返回值**

把原第59行：

```js
  beforeEach(() => { __resetCaptureTriageForTest(); checkInvariantCandidate.mockReset(); });
```

改为：

```js
  beforeEach(() => {
    __resetCaptureTriageForTest();
    checkInvariantCandidate.mockReset();
    createTask.mockReset();
    createTask.mockResolvedValue({ success: true, task: { id: 'new-task-1' } });
  });
```

- [ ] **Step 3: 改写既有测试 `line_backlog：handoff FAIL → routed 改写为 journeys/journey_id`（第70-76行）为新行为**

把：

```js
  it('line_backlog：handoff FAIL → routed 改写为 journeys/journey_id', async () => {
    const pool = makePool([{ id: 'a2', target_type: 'handoff', target_subtype: 'FAIL', content: 'x', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    await runCaptureTriage(pool);
    const upd = pool.updates[0];
    expect(upd.params).toContain('journeys');
    expect(upd.params).toContain('jrn-1');
  });
```

改为：

```js
  it('line_backlog：handoff FAIL → 真调用 createTask 建 harness_initiative，atom 改写为 tasks/新task id', async () => {
    const pool = makePool([{ id: 'a2', target_type: 'handoff', target_subtype: 'FAIL', content: 'x', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    await runCaptureTriage(pool);
    expect(createTask).toHaveBeenCalledTimes(1);
    const callArg = createTask.mock.calls[0][0];
    expect(callArg.task_type).toBe('harness_initiative');
    expect(callArg.trigger_source).toBe('cortex');
    expect(callArg.priority).toBe('P1');
    expect(callArg.payload).toMatchObject({
      orchestrator: 'skill-relay',
      executor: 'claude',
      mode: 'headed',
      journey_id: 'jrn-1',
    });
    const upd = pool.updates[0];
    expect(upd.sql).toMatch(/status = 'confirmed'/);
    expect(upd.params).toContain('tasks');
    expect(upd.params).toContain('new-task-1');
  });
```

- [ ] **Step 4: 新增测试——PASS+NEXT 来源 priority 默认 P2**

紧跟在上面那条测试后面插入：

```js
  it('line_backlog：handoff PASS+NEXT → createTask priority 默认 P2', async () => {
    const pool = makePool([{ id: 'a2b', target_type: 'handoff', target_subtype: 'PASS+NEXT', content: 'x', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    await runCaptureTriage(pool);
    expect(createTask.mock.calls[0][0].priority).toBe('P2');
  });
```

- [ ] **Step 5: 新增测试——命中生产护栏不建 task，保留旧行为**

```js
  it('line_backlog：content 含"生产环境"命中护栏 → 不调用 createTask，走原 journeys 标记流程', async () => {
    const pool = makePool([{ id: 'a2c', target_type: 'handoff', target_subtype: 'FAIL', content: '这是生产环境的紧急变更', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    await runCaptureTriage(pool);
    expect(createTask).not.toHaveBeenCalled();
    const upd = pool.updates[0];
    expect(upd.params).toContain('journeys');
    expect(upd.params).toContain('jrn-1');
  });
```

- [ ] **Step 6: 新增测试——createTask 未返回 task id 时不误标 confirmed**

```js
  it('line_backlog：createTask 未返回 task id → atom 不标 confirmed，ai_reason 标 task_create_failed', async () => {
    createTask.mockResolvedValue({ success: true, deduplicated: true });
    const pool = makePool([{ id: 'a2d', target_type: 'handoff', target_subtype: 'FAIL', content: 'x', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    await runCaptureTriage(pool);
    const upd = pool.updates[0];
    expect(upd.sql).not.toMatch(/status = 'confirmed'/);
    expect(upd.params.join(' ')).toContain('[triage:task_create_failed]');
  });
```

- [ ] **Step 7: 在文件顶部新增一条 `isProductionSensitive` 纯函数单测（放在 `applyCheapRules` describe 块后面，`makePool` 定义之前）**

```js
describe('isProductionSensitive（决策57d296a1生产护栏）', () => {
  it('content 含"生产环境" → true', () => {
    expect(isProductionSensitive({ content: '这是生产环境变更', target_subtype: '' })).toBe(true);
  });
  it('content 含 "production" / "prod env"（大小写不敏感）→ true', () => {
    expect(isProductionSensitive({ content: 'touching Production DB', target_subtype: '' })).toBe(true);
    expect(isProductionSensitive({ content: 'switch prod env config', target_subtype: '' })).toBe(true);
  });
  it('target_subtype 含 "LLM渠道切换" → true', () => {
    expect(isProductionSensitive({ content: 'x', target_subtype: 'LLM渠道切换' })).toBe(true);
  });
  it('普通内容 → false', () => {
    expect(isProductionSensitive({ content: '修复一个测试用例', target_subtype: 'FAIL' })).toBe(false);
  });
});
```

- [ ] **Step 8: Run test 确认新增/改写用例全部 FAIL（因为 Task 1 的实现还没接到 routeAtom 里）**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: 新增的 5 条相关用例 FAIL（`createTask` 未被调用 / `isProductionSensitive` 未导出等），其余既有用例仍 PASS

---

### Task 3: 实现 routeAtom line_backlog 分支改造（TDD Green）

**Files:**
- Modify: `packages/brain/src/capture-triage.js`（`routeAtom` 函数，line_backlog 分支）

- [ ] **Step 1: 改写 `routeAtom` 的 line_backlog 分支**

把原文件里（Task 1 完成 import 改动后，行号会整体下移约7行；用内容定位而非行号）：

```js
  if (route === 'line_backlog') {
    let journeyId = null;
    if (atom.routed_to_table === 'tasks' && atom.routed_to_id) {
      const { rows } = await pool.query(`SELECT payload->>'journey_id' AS journey_id FROM tasks WHERE id = $1::uuid`, [atom.routed_to_id]);
      journeyId = rows[0]?.journey_id ?? null;
    }
    if (!journeyId) {
      return updateAtom(pool, atom.id, { confidence, aiReason: `[triage:no_journey] 源无 journey_id，留人工复核。${reason}` });
    }
    return updateAtom(pool, atom.id, { status: 'confirmed', routedToTable: 'journeys', routedToId: journeyId, confidence, aiReason: `[triage:line_backlog] ${reason}` });
  }
```

替换为：

```js
  if (route === 'line_backlog') {
    let journeyId = null;
    if (atom.routed_to_table === 'tasks' && atom.routed_to_id) {
      const { rows } = await pool.query(`SELECT payload->>'journey_id' AS journey_id FROM tasks WHERE id = $1::uuid`, [atom.routed_to_id]);
      journeyId = rows[0]?.journey_id ?? null;
    }
    if (!journeyId) {
      return updateAtom(pool, atom.id, { confidence, aiReason: `[triage:no_journey] 源无 journey_id，留人工复核。${reason}` });
    }
    if (isProductionSensitive(atom)) {
      return updateAtom(pool, atom.id, { status: 'confirmed', routedToTable: 'journeys', routedToId: journeyId, confidence, aiReason: `[triage:line_backlog] 命中生产护栏，留人工排期。${reason}` });
    }
    const priority = atom.target_subtype === 'FAIL' ? 'P1' : 'P2';
    const result = await createTask({
      title: `[自动派工] ${atom.content.slice(0, 80)}`,
      description: `系统自动创建（来源: capture_atoms分诊, atom_id=${atom.id}）\n\n${atom.content}`,
      task_type: 'harness_initiative',
      priority,
      trigger_source: 'cortex',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'claude',
        mode: 'headed',
        journey_id: journeyId,
        thin_prd: atom.content,
      },
    });
    const taskId = result?.task?.id;
    if (!taskId) {
      return updateAtom(pool, atom.id, { confidence, aiReason: `[triage:task_create_failed] createTask 未返回 task id。${reason}` });
    }
    return updateAtom(pool, atom.id, { status: 'confirmed', routedToTable: 'tasks', routedToId: taskId, confidence, aiReason: `[triage:line_backlog] 自动创建 task ${taskId}。${reason}` });
  }
```

- [ ] **Step 2: Run 全部 capture-triage 测试确认转绿**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: 全部用例 PASS（包括 Task 2 新增的 5 条 + 原有全部用例）

- [ ] **Step 3: Commit（TDD 两段式：测试 Red 一个 commit，实现 Green 一个 commit）**

```bash
git add packages/brain/src/__tests__/capture-triage.test.js
git commit -m "test: capture-triage line_backlog自动建task失败测试(Red)"
git add packages/brain/src/capture-triage.js
git commit -m "feat: capture-triage line_backlog真正建harness_initiative task(决策57d296a1)"
```

---

### Task 4: 全量测试 + DoD 收尾

**Files:** 无新增文件

- [ ] **Step 1: 跑 Brain 全量相关测试防回归**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js src/__tests__/actions.test.js`
Expected: 全部 PASS（若 `actions.test.js` 不存在此步骤跳过该文件，仅跑 capture-triage）

- [ ] **Step 2: `node --check` 语法冒烟**

Run: `cd packages/brain && node --check src/capture-triage.js`
Expected: 无输出（exit 0）

- [ ] **Step 3: 确认无遗留 console.log / 注释代码**

Run: `cd packages/brain && git diff main -- src/capture-triage.js | grep -n "console.log\|^-.*TODO"`
Expected: 无输出

---

## DoD（对应 PrepPRD 验收标准）

- [ ] 新增/改写单元测试覆盖：正常建 task / 护栏命中不建 task / createTask 失败兜底（Task 2/3 已覆盖）
- [ ] CI 全绿（push 后由 engine-ship/engine-pr-watchdog 把关）
