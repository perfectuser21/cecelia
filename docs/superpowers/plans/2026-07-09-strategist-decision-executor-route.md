# strategist_decision executor 执行侧接线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `task_type='strategist_decision'` 的任务被 Brain tick 派发到容器跑 headless claude 时，能正确路由到 `/line-strategist` 并拿到 `LINE_ID`/`TRIGGER`/`TRIGGER_CONTEXT`/`BRAIN_TASK_ID`，而不是 fallback 成 `/dev` 且读不到任何参数。

**Architecture:** 三处改动都在 `packages/brain/src/executor.js`：`skillMap` 补一项、新增一个仿 `_prepareHarnessReportPrompt` 模式的 prompt 构建函数、`_TASK_ROUTES` 注册路由。另外 `line-strategist` skill 需要同步进 `packages/workflows/skills/`（CI/生产 fallback 快照目录），否则 `loadSkillContent` 在容器里找不到文件。

**Tech Stack:** Node.js（executor.js），vitest（测试，沿用 `executor-report-prompt.test.js` 的真实 loadSkillContent 模式，不 mock fs）。

## Global Constraints

- 只改 `strategist_decision` 这一个 task_type 的路由和 prompt 构建，不碰其他任何已有 task_type
- 不改 `task-router.js`（它已经注册对了）
- 不改 `line-strategist` skill 本身内容（`zenithjoy-skills/line-strategist/SKILL.md`），只同步快照
- `scripts/sync-skills-snapshot.sh` 只新增 `line-strategist` 一项，不夹带其他 skill 的既有漂移修复（那是别的任务范围）

---

### Task 1: skillMap + prompt 构建 + 路由注册 + skill 快照同步

**Files:**
- Modify: `packages/brain/src/executor.js:1292-1343`（`getSkillForTaskType` 的 `skillMap`）
- Modify: `packages/brain/src/executor.js`（`_prepareHarnessReportPrompt` 定义之后，约第2141行，新增 `_prepareStrategistDecisionPrompt` 函数）
- Modify: `packages/brain/src/executor.js:2227-2253`（`_TASK_ROUTES` 对象）
- Modify: `scripts/sync-skills-snapshot.sh`（`SKILLS` 数组加 `line-strategist`）
- Create: `packages/workflows/skills/line-strategist/SKILL.md`（跑同步脚本产出，不手写）
- Test: `packages/brain/src/__tests__/executor-strategist-decision-prompt.test.js`（新文件）

**Interfaces:**
- Consumes：`loadSkillContent(skillName)`（已在 executor.js 顶部 import，来自 `./harness-shared.js`，返回 SKILL.md 字符串，找不到文件会 throw）
- Produces：`_prepareStrategistDecisionPrompt(task)` — 输入 `task`（含 `id`/`title`/`description`/`payload.journey_id`/`payload.trigger`/`payload.trigger_context`），返回 prompt 字符串；`getSkillForTaskType('strategist_decision', payload)` 返回 `'/line-strategist'`

- [ ] **Step 1: 先跑同步脚本，把 line-strategist 快照文件产出来（测试要读真实文件）**

```bash
cd /Users/administrator/worktrees/cecelia/strategist-decision-executor-route
# 只加 line-strategist 一项到 SKILLS 数组（scripts/sync-skills-snapshot.sh 里手动改一行）
bash scripts/sync-skills-snapshot.sh
git status --short packages/workflows/skills/
# 确认只有 line-strategist/ 是新增，其他 5 个 harness skill 若被脚本顺带改动了，
# 用 git checkout -- <path> 撤销，保持本次 PR 范围只含 line-strategist
```

Expected: `packages/workflows/skills/line-strategist/SKILL.md` 文件存在，内容是
`~/perfect21/zenithjoy-skills/line-strategist/SKILL.md` 的原样拷贝。

- [ ] **Step 2: 写失败测试**

创建 `packages/brain/src/__tests__/executor-strategist-decision-prompt.test.js`：

```javascript
/**
 * Test: strategist_decision 任务的 skill 路由 + prompt 参数注入
 *
 * PR3674 只完成了任务创建侧（line-strategist-dispatch.js），executor.js 执行侧
 * 完全没接：getSkillForTaskType 的 skillMap 缺 strategist_decision，fallback 成 /dev；
 * _prepareDefaultPrompt 也不会把 payload.journey_id 等塞进 prompt。
 *
 * 修法：skillMap 补项 + 仿 _prepareHarnessReportPrompt 模式新增
 * _prepareStrategistDecisionPrompt（inline SKILL.md + 参数块）。
 *
 * 注意：本测试**不 mock fs**，让 loadSkillContent 读到真实的
 * packages/workflows/skills/line-strategist/SKILL.md（Step 1 已同步）。
 */

import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execSync: vi.fn(() => ''),
}));

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { EXECUTOR: 'executor' },
  STATUS: { START: 'start', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US: 'us', HK: 'hk' },
}));

vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../auto-learning.js', () => ({ processExecutionAutoLearning: vi.fn() }));

describe('strategist_decision — executor 执行侧接线', () => {
  it('getSkillForTaskType 对 strategist_decision 返回 /line-strategist（不是 /dev fallback）', async () => {
    const { getSkillForTaskType } = await import('../executor.js');
    expect(getSkillForTaskType('strategist_decision', {})).toBe('/line-strategist');
  });

  it('preparePrompt 对 strategist_decision 任务：inline SKILL 内容 + 注入 LINE_ID/TRIGGER/TRIGGER_CONTEXT/BRAIN_TASK_ID', async () => {
    const { preparePrompt } = await import('../executor.js');

    const task = {
      id: 'strategist-task-1',
      title: '军师决策[测试Line]: xxx',
      description: '任务终态触发（run_terminal）',
      task_type: 'strategist_decision',
      payload: {
        journey_id: 'journey-abc-123',
        trigger: 'run_terminal',
        trigger_context: { terminal_task_ids: ['t1', 't2'] },
      },
    };

    const prompt = await preparePrompt(task);

    // 1) 不能以裸 slash command 开头（容器 headless 不展开 → 空 SKILL 静默降级）
    expect(prompt.startsWith('/')).toBe(false);

    // 2) 必须 inline 了真实 line-strategist SKILL.md 的内容特征串
    expect(prompt).toContain('Line 军师(line-strategist)');

    // 3) 必须注入四个参数，值来自 payload
    expect(prompt).toContain('LINE_ID: journey-abc-123');
    expect(prompt).toContain('TRIGGER: run_terminal');
    expect(prompt).toContain('BRAIN_TASK_ID: strategist-task-1');
    expect(prompt).toContain('terminal_task_ids');
  });

  it('trigger/trigger_context 缺失时有合理默认值，不抛异常（TRIGGER=manual 场景）', async () => {
    const { preparePrompt } = await import('../executor.js');

    const task = {
      id: 'strategist-task-2',
      title: '军师决策[测试Line]: manual',
      task_type: 'strategist_decision',
      payload: { journey_id: 'journey-xyz' },
    };

    const prompt = await preparePrompt(task);
    expect(prompt).toContain('TRIGGER: manual');
    expect(prompt).toContain('LINE_ID: journey-xyz');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/executor-strategist-decision-prompt.test.js`
Expected: 全部 FAIL（`getSkillForTaskType` 返回 `/dev` 不是 `/line-strategist`；`preparePrompt` 走 `_prepareDefaultPrompt` 分支，prompt 里没有 SKILL.md 内容也没有 LINE_ID 等字段）

- [ ] **Step 4: 实现修复**

在 `packages/brain/src/executor.js` 里：

1. `skillMap`（第1292行起的对象）里加一行（放在合理位置，比如 `harness_intervention`/`staging_e2e` 附近的其他非-harness特判项旁边，或任意位置，因为是普通对象 key-value）：

```js
'strategist_decision': '/line-strategist',  // Line 军师决策（PR3674 终态钩子派发，见 line-strategist-dispatch.js）
```

2. 在 `_prepareHarnessReportPrompt` 函数定义结束之后（约第2141行 `return \`/sprint-report\n\n${paramsBlock}\`;\n}` 之后），新增：

```js
function _prepareStrategistDecisionPrompt(task) {
  const skillContent = loadSkillContent('line-strategist');
  const payload = task.payload || {};
  const paramsBlock = `## Line 军师决策任务

LINE_ID: ${payload.journey_id || ''}
TRIGGER: ${payload.trigger || 'manual'}
TRIGGER_CONTEXT: ${JSON.stringify(payload.trigger_context || {})}
BRAIN_TASK_ID: ${task.id}
DRY_RUN: false

${task.description || task.title}`;

  return [
    '你是 line-strategist session。按下面 SKILL 指令完成一次决策。',
    '',
    skillContent,
    '',
    '---',
    '',
    paramsBlock,
  ].join('\n');
}
```

3. `_TASK_ROUTES` 对象（第2227行起）加一行（放在其他单行 handler 旁边即可）：

```js
strategist_decision:      _prepareStrategistDecisionPrompt,
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/executor-strategist-decision-prompt.test.js`
Expected: 全部 PASS

- [ ] **Step 6: 跑 executor.js 全部现有测试确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/executor*.test.js`
Expected: 全部 PASS（含 `executor-report-prompt.test.js`、`executor-payload-routing.test.js`、`executor-initiative-skill-map.test.js`、`executor-skill-override.test.js`、`executor-task-type-null-fix.test.js` 等既有文件）

- [ ] **Step 7: Commit（TDD 两段式，快照同步单独一个 commit）**

```bash
# commit 1: 快照同步（line-strategist 加入 sync 脚本 + 产出的快照文件）
git add scripts/sync-skills-snapshot.sh packages/workflows/skills/line-strategist/
git commit -m "chore(brain): line-strategist 加入 skill 快照同步清单

executor.js 的 loadSkillContent() 需要从 packages/workflows/skills/ 这个
CI/生产 fallback 快照读 SKILL.md（本地 ~/.claude-account*/skills/ 路径在
容器里不存在）。line-strategist 此前没同步进这个清单，会导致 headless
容器里 loadSkillContent('line-strategist') 找不到文件而 throw。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"

# commit 2: 失败测试（TDD red）
git add packages/brain/src/__tests__/executor-strategist-decision-prompt.test.js
git commit -m "test(brain): strategist_decision executor 执行侧接线失败测试(TDD red)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"

# commit 3: 实现（TDD green）
git add packages/brain/src/executor.js
git commit -m "fix(brain): executor.js 补 strategist_decision 路由 + prompt 参数注入

PR#3674(Line军师终态接线)只完成了任务创建侧(line-strategist-dispatch.js
正确建strategist_decision任务)，执行侧完全没接：executor.js的
getSkillForTaskType()有自己独立的skillMap（跟task-router.js的
SKILL_WHITELIST是两张不同步的表），strategist_decision不在这张表里，
fallback到/dev而不是/line-strategist；_prepareDefaultPrompt也完全没把
payload.journey_id/trigger/trigger_context转成line-strategist skill
需要的LINE_ID/TRIGGER/TRIGGER_CONTEXT，BRAIN_TASK_ID同样未传。

新增_prepareStrategistDecisionPrompt仿_prepareHarnessReportPrompt模式
（inline SKILL.md全文，因为容器headless claude不展开slash command），
拼参数块把payload字段转成对应环境变量文本注入prompt。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
