# dev任务改代码路由进harness_initiative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `task_type='dev'` 且判定为"改代码"的 Brain 任务，在 `dispatcher.js:797` 派发前被改写为 `task_type='harness_initiative'`，正确路由进 kernel harness（evaluator/judge/GAN），不再走绕过 kernel 的 legacy docker-executor 链路。

**Architecture:** 新增纯函数模块 `packages/brain/src/dispatch-code-routing.js`（`classifyCodeChange`/`deriveGearForTask`/`buildHarnessRoutingPayload`），在 `dispatcher.js:797` `triggerCeceliaRun` 调用前插入判定+改写逻辑。不改 gear 状态机、不改 `orchestrator/dispatcher.js`、不引入新 task_type。

**Tech Stack:** Node.js (ESM)、Vitest、PostgreSQL（Brain 现有技术栈，无新增依赖）。

---

## Task 1: 新增 dispatch-code-routing.js 的失败测试

**Files:**
- Create: `packages/brain/src/__tests__/dispatch-code-routing.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { describe, it, expect } from 'vitest';
import { classifyCodeChange, deriveGearForTask, buildHarnessRoutingPayload } from '../dispatch-code-routing.js';

describe('classifyCodeChange', () => {
  it('task_type≠dev → 不路由', () => {
    const task = { task_type: 'research', title: '调研一下X', payload: {} };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(false);
    expect(result.reason).toBe('not_dev_type');
  });

  it('纯文档标题 → 不路由', () => {
    const task = { task_type: 'dev', title: 'docs: 更新 README', payload: {} };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(false);
    expect(result.reason).toBe('doc_or_config_only');
  });

  it('纯配置标题 → 不路由', () => {
    const task = { task_type: 'dev', title: 'chore(config): 调整超时阈值', payload: {} };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(false);
    expect(result.reason).toBe('doc_or_config_only');
  });

  it('非默认仓库（v1范围限制）→ 不路由', () => {
    const task = { task_type: 'dev', title: '修一下发布器的bug', payload: { repo: 'zenithjoy' } };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(false);
    expect(result.reason).toBe('non_default_repo_v1_scope_limit');
  });

  it('repo 缺省视为 cecelia → 正常路由', () => {
    const task = { task_type: 'dev', title: '加个新接口', description: '', payload: {} };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(true);
    expect(result.reason).toBe('code_change');
  });

  it('repo=cecelia 显式给出 → 正常路由', () => {
    const task = { task_type: 'dev', title: '加个新接口', description: '', payload: { repo: 'cecelia' } };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(true);
    expect(result.reason).toBe('code_change');
  });
});

describe('deriveGearForTask', () => {
  it('标题含"修复bug" → hotfix', () => {
    const task = { title: '修复bug：派发死锁', description: '' };
    expect(deriveGearForTask(task)).toBe('hotfix');
  });

  it('标题含 fix( → hotfix', () => {
    const task = { title: 'fix(brain): 修一个空指针', description: '' };
    expect(deriveGearForTask(task)).toBe('hotfix');
  });

  it('标题含"新增能力/立项" → segmented', () => {
    const task = { title: '新增能力：多平台一键发布', description: '这是一次立项，贯穿全流程' };
    expect(deriveGearForTask(task)).toBe('segmented');
  });

  it('描述含"架构重构" → segmented', () => {
    const task = { title: '优化派发逻辑', description: '这是一次架构重构' };
    expect(deriveGearForTask(task)).toBe('segmented');
  });

  it('普通描述（无关键词）→ default', () => {
    const task = { title: '加个新接口', description: '给用户列表加分页参数' };
    expect(deriveGearForTask(task)).toBe('default');
  });

  it('bugfix 与 large 关键词同时命中 → hotfix 优先', () => {
    const task = { title: '修复bug', description: '涉及架构重构' };
    expect(deriveGearForTask(task)).toBe('hotfix');
  });
});

describe('buildHarnessRoutingPayload', () => {
  it('产出 orchestrator/code_change/gear/origin_task_type/thin_prd 五个字段', () => {
    const task = {
      task_type: 'dev',
      title: '加个新接口',
      description: '给用户列表加分页参数',
      payload: { context: '补充上下文：只加 GET /users 的分页' },
    };
    const patch = buildHarnessRoutingPayload(task, 'default');
    expect(patch.orchestrator).toBe('skill-relay');
    expect(patch.code_change).toBe(true);
    expect(patch.gear).toBe('default');
    expect(patch.origin_task_type).toBe('dev');
    expect(patch.thin_prd).toContain('加个新接口');
    expect(patch.thin_prd).toContain('给用户列表加分页参数');
    expect(patch.thin_prd).toContain('补充上下文：只加 GET /users 的分页');
  });

  it('description/context 缺省时 thin_prd 至少含 title，不抛错', () => {
    const task = { task_type: 'dev', title: '加个新接口', payload: {} };
    const patch = buildHarnessRoutingPayload(task, 'default');
    expect(patch.thin_prd).toContain('加个新接口');
  });
});
```

- [ ] **Step 2: 跑测试确认失败（模块不存在）**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatch-code-routing.test.js`
Expected: FAIL，报错含 `Cannot find module '../dispatch-code-routing.js'` 或 `Failed to resolve import`

- [ ] **Step 3: Commit（Red）**

```bash
git add packages/brain/src/__tests__/dispatch-code-routing.test.js
git commit -m "test(brain): dispatch-code-routing 分类/gear推导/payload构建 失败测试"
```

---

## Task 2: 实现 dispatch-code-routing.js

**Files:**
- Create: `packages/brain/src/dispatch-code-routing.js`

- [ ] **Step 1: 写实现**

```js
/**
 * dispatch-code-routing — 决策 bf361265（2026-08-11）落地：
 * task_type='dev' 且判定为"改代码"的任务，在 dispatcher.js 派发前改道 harness_initiative，
 * 不再依赖各执行体 hooks/AGENTS.md 自觉遵守 kernel 路由。
 *
 * v1 范围限制：只路由 payload.repo 缺省或等于 'cecelia' 的任务。非默认仓库的路由需要先解决
 * payload.repo → payload.base_repo 的通用映射（harness-worktree.js DEFAULT_BASE_REPO 静默兜底
 * 到 cecelia 本地路径的风险），留作后续任务，本次不处理。
 */

const DOC_OR_CONFIG_ONLY_PATTERN = /^(docs?)\b|^(docs?)\(|^chore\(config\)|纯文档|仅改文档|仅改配置|readme更新|更新文档/i;
const BUGFIX_PATTERN = /^(fix|hotfix|chore)\b|^(fix|hotfix|chore)\(|修复|\bbug\b|小改动/i;
const LARGE_PATTERN = /大功能|新增能力|立项|贯穿|sprint测试|架构重构|breaking change/i;

const DEFAULT_REPO = 'cecelia';

function taskText(task) {
  return `${task?.title || ''} ${task?.description || ''}`;
}

/**
 * classifyCodeChange(task) — 判定一个任务是否属于"改代码类"，命中则应改道 harness_initiative。
 * @returns {{ isCodeChange: boolean, reason: 'not_dev_type'|'doc_or_config_only'|'non_default_repo_v1_scope_limit'|'code_change' }}
 */
export function classifyCodeChange(task) {
  if (task?.task_type !== 'dev') {
    return { isCodeChange: false, reason: 'not_dev_type' };
  }
  const text = taskText(task);
  if (DOC_OR_CONFIG_ONLY_PATTERN.test(text)) {
    return { isCodeChange: false, reason: 'doc_or_config_only' };
  }
  const repo = task?.payload?.repo || DEFAULT_REPO;
  if (repo !== DEFAULT_REPO) {
    return { isCodeChange: false, reason: 'non_default_repo_v1_scope_limit' };
  }
  return { isCodeChange: true, reason: 'code_change' };
}

/**
 * deriveGearForTask(task) — 标题/描述关键词启发式推导 gear（hotfix/default/segmented）。
 * BUGFIX_PATTERN 优先于 LARGE_PATTERN（小修复即使提到"重构"字眼也判 hotfix，宁可偏轻量）。
 * @returns {'hotfix'|'default'|'segmented'}
 */
export function deriveGearForTask(task) {
  const text = taskText(task);
  if (BUGFIX_PATTERN.test(text)) return 'hotfix';
  if (LARGE_PATTERN.test(text)) return 'segmented';
  return 'default';
}

/**
 * buildHarnessRoutingPayload(task, gear) — 改道 harness_initiative 时需要 merge 进
 * taskToDispatch.payload 的字段。除已知两道硬闸（orchestrator/gear）外，额外合成 thin_prd，
 * 避免 Planner（harness-planner/SKILL.md）在 thin_prd 缺省时失去锚点、产出跑题的 sprint-prd.md
 * （thin_prd 不是代码级硬闸，是 LLM subagent 读的操作手册，缺省不报错但会静默跑偏）。
 * @returns {{ orchestrator: 'skill-relay', code_change: true, gear: string, origin_task_type: 'dev', thin_prd: string }}
 */
export function buildHarnessRoutingPayload(task, gear) {
  const parts = [task?.title, task?.description, task?.payload?.context].filter(Boolean);
  return {
    orchestrator: 'skill-relay',
    code_change: true,
    gear,
    origin_task_type: 'dev',
    thin_prd: parts.join('\n\n'),
  };
}
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatch-code-routing.test.js`
Expected: PASS，全部用例绿

- [ ] **Step 3: Commit（Green）**

```bash
git add packages/brain/src/dispatch-code-routing.js
git commit -m "feat(brain): dispatch-code-routing — classifyCodeChange/deriveGearForTask/buildHarnessRoutingPayload"
```

---

## Task 3: dispatcher.js 集成——失败测试

**Files:**
- Modify: `packages/brain/src/__tests__/dispatcher-dev-no-langgraph.test.js`

- [ ] **Step 1: 在现有 `describe('F7: dev 派发迁离 LangGraph', ...)` 块内，把第 163 行的用例替换/追加为下面三个用例（保留原有其余用例不动）**

用下面这段替换原第 163-172 行的 `it('dev task 派发 → triggerCeceliaRun 被调', ...)`：

```js
  it('dev task（无 bugfix/large 关键词，默认仓库）派发 → 改道 harness_initiative，triggerCeceliaRun 收到改写后的任务', async () => {
    const task = makeDevTask();
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mocks.triggerCeceliaRun).toHaveBeenCalledTimes(1);
    const dispatched = mocks.triggerCeceliaRun.mock.calls[0][0];
    expect(dispatched.id).toBe(task.id);
    expect(dispatched.task_type).toBe('harness_initiative');
    expect(dispatched.payload.orchestrator).toBe('skill-relay');
    expect(dispatched.payload.code_change).toBe(true);
    expect(dispatched.payload.gear).toBe('default');
    expect(dispatched.payload.origin_task_type).toBe('dev');
    expect(dispatched.payload.thin_prd).toContain(task.title);
  });

  it('dev task 标题含"修复bug" → 改道 harness_initiative 且 gear=hotfix', async () => {
    const task = makeDevTask({ id: 'dev-task-hotfix-001', title: '修复bug：派发死锁' });
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    const dispatched = mocks.triggerCeceliaRun.mock.calls[0][0];
    expect(dispatched.task_type).toBe('harness_initiative');
    expect(dispatched.payload.gear).toBe('hotfix');
  });

  it('dev task 非默认仓库（v1范围限制）→ 不改道，task_type 保持 dev', async () => {
    const task = makeDevTask({ id: 'dev-task-other-repo-001', payload: { repo: 'zenithjoy' } });
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    const dispatched = mocks.triggerCeceliaRun.mock.calls[0][0];
    expect(dispatched.task_type).toBe('dev');
    expect(dispatched.payload.orchestrator).toBeUndefined();
  });

  it('dev task 纯文档标题（docs:）→ 不改道，task_type 保持 dev', async () => {
    const task = makeDevTask({ id: 'dev-task-docs-001', title: 'docs: 更新 README' });
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    const dispatched = mocks.triggerCeceliaRun.mock.calls[0][0];
    expect(dispatched.task_type).toBe('dev');
  });
```

- [ ] **Step 2: 跑测试确认新用例失败（分流逻辑还没接线，task_type 仍是 dev）**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-dev-no-langgraph.test.js`
Expected: FAIL——新增的 4 个用例里，断言 `dispatched.task_type === 'harness_initiative'` 的用例会失败（实际仍是 'dev'）；`非默认仓库`/`纯文档` 两个用例预期本来就应该 PASS（因为逻辑还没接，task_type 天然还是 'dev'）——这是正常的，本 step 只要求"命中改道"的用例先红，不要求全部用例都红。

- [ ] **Step 3: Commit（Red）**

```bash
git add packages/brain/src/__tests__/dispatcher-dev-no-langgraph.test.js
git commit -m "test(brain): dispatcher 改代码任务分流集成测试（Red）"
```

---

## Task 4: dispatcher.js 接线——实现

**Files:**
- Modify: `packages/brain/src/dispatcher.js:5`（顶部注释）
- Modify: `packages/brain/src/dispatcher.js:797`（插入分流逻辑）

- [ ] **Step 1: 更新顶部注释（第 5 行）**

把：
```js
 * dev 任务与其他 task_type 一样走 triggerCeceliaRun 本地 spawn（活性信号已通）。
```
改为：
```js
 * dev 任务默认走 triggerCeceliaRun 本地 spawn（活性信号已通）；改代码类 dev 任务
 * （见 dispatch-code-routing.js classifyCodeChange）在此之前已被改道 harness_initiative，
 * 走 runHarnessInitiativeRouter（kernel evaluator/judge/GAN 全链路），不再走本地 spawn。
```

- [ ] **Step 2: 加 import（文件顶部 import 区，第 15 行 `import pool from './db.js';` 之后）**

```js
import { classifyCodeChange, deriveGearForTask, buildHarnessRoutingPayload } from './dispatch-code-routing.js';
```

- [ ] **Step 3: 在第 797 行 `execResult = await triggerCeceliaRun(taskToDispatch);` 之前插入**

把：
```js
  execResult = await triggerCeceliaRun(taskToDispatch);
```
改为：
```js
  const codeRouting = classifyCodeChange(taskToDispatch);
  if (codeRouting.isCodeChange) {
    const gear = deriveGearForTask(taskToDispatch);
    taskToDispatch = {
      ...taskToDispatch,
      task_type: 'harness_initiative',
      payload: {
        ...taskToDispatch.payload,
        ...buildHarnessRoutingPayload(taskToDispatch, gear),
      },
    };
    tickLog(`[dispatch] code_change_routing task=${taskToDispatch.id} origin_type=dev → harness_initiative gear=${gear}`);
  }

  execResult = await triggerCeceliaRun(taskToDispatch);
```

- [ ] **Step 4: 跑测试确认全部通过**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-dev-no-langgraph.test.js src/__tests__/dispatch-code-routing.test.js`
Expected: PASS，全部用例绿

- [ ] **Step 5: Commit（Green）**

```bash
git add packages/brain/src/dispatcher.js
git commit -m "feat(brain): dev任务改代码在dispatcher派发前改道harness_initiative（决策bf361265）"
```

---

## Task 5: 回归——dispatcher 全套测试无破坏

**Files:**
- 无新文件，只跑测试

- [ ] **Step 1: 跑 packages/brain/src/__tests__ 下所有 *dispatcher* 测试文件**

Run: `cd packages/brain && npx vitest run src/__tests__/*dispatcher*`
Expected: 全部 PASS。重点关注 `dispatcher-allocation-guide.test.js`、`dispatcher-xian-harness-bypass.test.js`、`dispatcher-harness-concurrency-cap.test.js` 三个——本次改动插入点紧邻 764-795 行的 allocation guide 逻辑，需要确认新分流不改变这三个文件覆盖的分支行为。

- [ ] **Step 2: 若有失败，定位是否为本次改动导致（新分流让某个原本 task_type='dev' 的测试 fixture 被意外改道 harness_initiative，从而触发这些文件里假设"仍是 dev/仍走 legacy"的断言）**

如果某个失败用例的 fixture 是"改代码类默认路由条件"的 dev 任务（无 bugfix/large 关键词、默认仓库），且该测试的意图并非验证本次的路由逻辑，两个选项二选一（不要两个都做）：
- 给该 fixture 加 `payload: { repo: 'other-repo' }` 或纯文档标题，显式排除出本次路由范围，保持原测试意图不变；
- 或如果该测试就是在测"改代码 dev 任务的 legacy 行为"本身（已经被本次需求废弃），按 Task 3 的模式改写断言。

- [ ] **Step 3: 全绿后无需 commit（本 step 是验证，不改代码）**

---

## Task 6: 版本 bump（brain-version-bump-gate 要求的 4 个文件）

**Files:**
- Modify: `packages/brain/package.json:49`
- Modify: `packages/brain/package-lock.json:3,9`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md:11`

- [ ] **Step 1: 依次修改 4 个文件，版本从 `1.272.25` → `1.272.26`**

`packages/brain/package.json:49`：
```json
  "version": "1.272.26"
```

`packages/brain/package-lock.json:3` 和 `:9`（两处都要改，`name` 行不变，只改 `version`）：
```json
  "version": "1.272.26",
```
和：
```json
      "version": "1.272.26",
```

`.brain-versions`（追加新行，不是替换最后一行——脚本用 `tail -1` 读最新值）：
```bash
echo "1.272.26" >> .brain-versions
```

`DEFINITION.md:11`：
```markdown
**Brain 版本**: 1.272.26
```

- [ ] **Step 2: 跑版本同步校验确认通过**

Run: `bash scripts/check-version-sync.sh`
Expected: 四行全部 `✅`，无 `❌`

- [ ] **Step 3: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): version bump 1.272.25 → 1.272.26"
```

---

## Self-Review（写完计划后自查，不是子任务）

- **Spec 覆盖**：设计文档 6 节（模块/插入点/gear正则/文档排除正则/测试改动/收尾）中，1-5 节对应 Task 1-5；「收尾」节的「关闭 PR #4792」依赖本 PR 的 URL（还不存在，需等 finishing 阶段 push+开 PR 后才能引用），**不放进本计划**，作为 subagent-driven-development 执行完毕、finishing 产出 PR 号之后的手动收尾步骤单独执行，不属于本实施计划范围。
- **占位符扫描**：无 TBD/TODO/"参考 Task N 的代码"。
- **类型一致性**：`classifyCodeChange` 返回 `{isCodeChange, reason}`、`deriveGearForTask` 返回字符串、`buildHarnessRoutingPayload(task, gear)` 接收 gear 字符串——三处签名在 Task 1(测试)/Task 2(实现)/Task 4(dispatcher调用) 全部一致。
