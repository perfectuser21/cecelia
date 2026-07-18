# 刀2a：执行层决策收权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。TDD 铁律：commit-1 fail test / commit-2 impl。

**Goal:** 把 `triggerCeceliaRun` 里散落的 9 个执行体决策点（REVIEW短路/staging/internal/payload-override/xian/xian_m1/local-codex×2/harness）收进一个纯决策函数 `resolveExecution(task)`，主体照决策派发。**行为完全不变（纯收权，先减肥）**——为刀2b 三轴分配器提供唯一插座。

**Architecture:** 决策与派发分离。`resolveExecution(task)` 纯函数返回 `{kind, trigger, reason}`（不执行、可单测、注入依赖）；`triggerCeceliaRun` 变成"求决策 → switch 派发"。收权后所有"选谁执行"的逻辑只在这一个函数里，三轴 allocate() 将来只增强这个函数，不再是第 N 个脑子。

**顺带根治**：completed_no_pr 洗 claim（9c7ae233）——失败回报路径也收进决策层的一个明确出口，禁止回调野路子改 claim。（本刀只做收权，9c7ae233 的 requeue 护栏在计划末尾单列 Task，可拆下一刀。）

**上游**：设计 spec `docs/superpowers/specs/2026-07-18-tri-axis-allocator-design.md`（被 REJECT，本刀是它的前置）；对抗审查结论（executor.js:3153 triggerCeceliaRun 9 段 if 链是真实决策链）。

**⚠️ 死规矩**：本地测试 `DB_NAME=cecelia_scratch`，禁裸跑 migrate。

---

## 现状：triggerCeceliaRun 的 9 段决策（executor.js:3153-3262+）

| # | 行 | 条件 | 派发 |
|---|----|------|------|
| 0 | 3161 | REVIEW_TASK_TYPES | triggerCodexReview |
| 0.5 | 3168 | staging_e2e | runStagingE2E |
| 0.6 | 3178 | getInternalTaskHandler 命中 | 内联 handler |
| 1 | 3199 | payload.machine/executor（非 harness） | resolveExecutor→codex bridge / forceUsClaude |
| 2 | 3229 | location==='xian' | triggerCodexBridge |
| 2.1 | 3241 | location==='xian_m1' | triggerCodexBridge(M1) |
| 2.5 | 3248 | spec_review/code_review_gate | triggerLocalCodexExec |
| 2.8 | 3254 | location==='us' && executor==='codex' | triggerLocalCodexExec |
| 2.85 | 3262 | harness_initiative/golden_path_proposal | runHarnessInitiativeRouter |
| 默认 | 3262后 | 其余 | US Claude 默认派发 |

**收权目标**：这 9 段的**条件判断**抽到 `resolveExecution(task)`，返回 `{kind, params, reason}`；派发动作留在主体 switch。

---

### Task 1: 抽 resolveExecution 纯决策函数（决策与派发分离）

**Files:**
- Create: `packages/brain/src/lib/resolve-execution.js`（纯决策，无副作用）
- Test: `packages/brain/src/lib/__tests__/resolve-execution.test.js`
- Modify: `packages/brain/src/executor.js:3153-3350`（triggerCeceliaRun 改为求决策+switch）

- [ ] **Step 1: 写失败测试**——决策函数把 9 段条件 1:1 映射成 kind，注入 deps 便于单测：

```js
// packages/brain/src/lib/__tests__/resolve-execution.test.js
import { describe, it, expect } from 'vitest';
import { resolveExecution, EXECUTION_KINDS } from '../resolve-execution.js';

// deps 注入：getCachedLocation/getTaskLocation/getCachedConfig/getInternalTaskHandler/REVIEW_TASK_TYPES
function deps(over = {}) {
  return {
    REVIEW_TASK_TYPES: ['code_review', 'prd_review'],
    getInternalTaskHandler: () => null,
    getCachedLocation: () => null,
    getTaskLocation: () => 'us',
    getCachedConfig: () => null,
    RETIRED_HARNESS_TYPES: new Set(),
    ...over,
  };
}

describe('resolveExecution — 9 段决策 1:1 收权', () => {
  it('REVIEW 类 → codex_review（最高优先，短路）', () => {
    const r = resolveExecution({ task_type: 'code_review' }, deps());
    expect(r.kind).toBe(EXECUTION_KINDS.CODEX_REVIEW);
  });
  it('staging_e2e → staging_runner', () => {
    expect(resolveExecution({ task_type: 'staging_e2e' }, deps()).kind).toBe(EXECUTION_KINDS.STAGING_RUNNER);
  });
  it('internal handler 命中 → internal', () => {
    const r = resolveExecution({ task_type: 'harness_intervention' }, deps({ getInternalTaskHandler: () => (() => {}) }));
    expect(r.kind).toBe(EXECUTION_KINDS.INTERNAL);
  });
  it('payload.executor 显式 override（非 harness）→ explicit_route', () => {
    const r = resolveExecution({ task_type: 'dev', payload: { executor: 'codex' } }, deps());
    expect(r.kind).toBe(EXECUTION_KINDS.EXPLICIT_ROUTE);
  });
  it('location=xian → xian_bridge', () => {
    const r = resolveExecution({ task_type: 'crystallize' }, deps({ getTaskLocation: () => 'xian' }));
    expect(r.kind).toBe(EXECUTION_KINDS.XIAN_BRIDGE);
  });
  it('location=xian_m1 → xian_m1_bridge', () => {
    const r = resolveExecution({ task_type: 'x' }, deps({ getTaskLocation: () => 'xian_m1' }));
    expect(r.kind).toBe(EXECUTION_KINDS.XIAN_M1_BRIDGE);
  });
  it('spec_review/code_review_gate → local_codex', () => {
    const r = resolveExecution({ task_type: 'code_review_gate' }, deps());
    expect(r.kind).toBe(EXECUTION_KINDS.LOCAL_CODEX);
  });
  it('us + dynamic executor=codex → local_codex', () => {
    const r = resolveExecution({ task_type: 'b' }, deps({ getTaskLocation: () => 'us', getCachedConfig: () => ({ executor: 'codex' }) }));
    expect(r.kind).toBe(EXECUTION_KINDS.LOCAL_CODEX);
  });
  it('harness_initiative → harness_graph', () => {
    expect(resolveExecution({ task_type: 'harness_initiative' }, deps()).kind).toBe(EXECUTION_KINDS.HARNESS_GRAPH);
  });
  it('其余 → us_claude 默认', () => {
    expect(resolveExecution({ task_type: 'dev' }, deps()).kind).toBe(EXECUTION_KINDS.US_CLAUDE);
  });
  it('决策纯函数：不触发任何 IO（同输入同输出）', () => {
    const t = { task_type: 'dev' };
    expect(resolveExecution(t, deps())).toEqual(resolveExecution(t, deps()));
  });
  it('每个决策带 reason（可审计）', () => {
    expect(resolveExecution({ task_type: 'staging_e2e' }, deps()).reason).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑红** `cd packages/brain && npx vitest run src/lib/__tests__/resolve-execution.test.js` → FAIL（模块不存在）

- [ ] **Step 3: 写 resolve-execution.js**——把 9 段 if 的**条件**照搬（顺序即优先级），返回 kind+reason，不执行：

```js
// packages/brain/src/lib/resolve-execution.js
// 执行体决策收权（刀2a）：triggerCeceliaRun 的 9 段路由条件抽成纯函数。
// 行为与原 if 链 1:1（顺序即优先级）。派发动作留在 executor.js 主体。
// 刀2b 三轴 allocator 将在 US_CLAUDE/LOCAL_CODEX 等 kind 内增强 {vendor,account,machine}。

export const EXECUTION_KINDS = {
  CODEX_REVIEW: 'codex_review',
  STAGING_RUNNER: 'staging_runner',
  INTERNAL: 'internal',
  EXPLICIT_ROUTE: 'explicit_route',
  XIAN_BRIDGE: 'xian_bridge',
  XIAN_M1_BRIDGE: 'xian_m1_bridge',
  LOCAL_CODEX: 'local_codex',
  HARNESS_GRAPH: 'harness_graph',
  US_CLAUDE: 'us_claude',
};

/**
 * 纯决策：给一个任务，返回该走哪种执行体（不执行）。
 * @param {object} task
 * @param {object} deps 注入：REVIEW_TASK_TYPES/getInternalTaskHandler/getCachedLocation/getTaskLocation/getCachedConfig/RETIRED_HARNESS_TYPES
 * @returns {{kind:string, reason:string, params?:object}}
 */
export function resolveExecution(task, deps) {
  const { REVIEW_TASK_TYPES, getInternalTaskHandler, getCachedLocation, getTaskLocation, getCachedConfig, RETIRED_HARNESS_TYPES } = deps;
  const tt = task.task_type;

  // 0. REVIEW 短路（最高优先）
  if (REVIEW_TASK_TYPES.includes(tt)) return { kind: EXECUTION_KINDS.CODEX_REVIEW, reason: 'review 类走独立 Codex Review 池' };
  // 0.5 staging
  if (tt === 'staging_e2e') return { kind: EXECUTION_KINDS.STAGING_RUNNER, reason: 'staging_e2e native runner' };
  // 0.6 internal handler
  if (getInternalTaskHandler(tt)) return { kind: EXECUTION_KINDS.INTERNAL, reason: 'internal handler 命中' };

  const dynamicLocation = getCachedLocation(tt);
  const location = dynamicLocation ?? getTaskLocation(tt);
  const dynamicExecutor = getCachedConfig(tt)?.executor;

  // 1. 显式 payload override（非 harness/retired）
  const hasOverride = (task.payload?.machine || task.payload?.executor)
    && tt !== 'harness_initiative' && tt !== 'golden_path_proposal'
    && !RETIRED_HARNESS_TYPES.has(tt);
  if (hasOverride) return { kind: EXECUTION_KINDS.EXPLICIT_ROUTE, reason: 'payload.machine/executor 显式路由' };

  // 2/2.1 西安 bridge
  if (location === 'xian') return { kind: EXECUTION_KINDS.XIAN_BRIDGE, reason: `location=xian (src=${dynamicLocation ? 'dynamic' : 'map'})` };
  if (location === 'xian_m1') return { kind: EXECUTION_KINDS.XIAN_M1_BRIDGE, reason: 'location=xian_m1 钉 M1' };
  // 2.5 本机 codex review 池
  if (tt === 'spec_review' || tt === 'code_review_gate') return { kind: EXECUTION_KINDS.LOCAL_CODEX, reason: `${tt} → 本机 Codex CLI review 池` };
  // 2.8 动态 executor=codex
  if (location === 'us' && dynamicExecutor === 'codex') return { kind: EXECUTION_KINDS.LOCAL_CODEX, reason: 'B类 dynamic executor=codex' };
  // 2.85 harness graph
  if (tt === 'harness_initiative' || tt === 'golden_path_proposal') return { kind: EXECUTION_KINDS.HARNESS_GRAPH, reason: 'harness full graph' };
  // 默认 US Claude
  return { kind: EXECUTION_KINDS.US_CLAUDE, reason: '默认 US Claude 派发' };
}
```

- [ ] **Step 4: 跑绿**（13 用例全过）

- [ ] **Step 5: executor.js 改用决策函数**——triggerCeceliaRun 顶部求一次决策，9 段 if 改成读 `decision.kind` 的 switch。**保留每段原有的副作用调用**（setExecutorKind/updateTaskStatus 等），只把"判断"换成读 decision。payload override 段的 resolveExecutor（真正解析 machineId/url）保留，由 EXPLICIT_ROUTE 分支调用。逐段对照原行为，禁改语义。

- [ ] **Step 6: 全量回归**——`cd packages/brain && npx vitest run --exclude 'src/__tests__/integration/**'` 重点跑 executor 相关：`npx vitest run src/__tests__/dispatch-now.test.js src/__tests__/dispatch-anchor-gate.test.js`（确认路由零回归）

- [ ] **Step 7: Commit**
```bash
git add packages/brain/src/lib/resolve-execution.js packages/brain/src/lib/__tests__/resolve-execution.test.js packages/brain/src/executor.js
git commit -m "refactor(brain/executor): 执行体决策收权——9段路由抽 resolveExecution 纯函数（刀2a，行为不变）[600295fe]"
```

---

### Task 2: 版本 bump + DevGate + Learning

**Files:** package.json/package-lock/.brain-versions/DEFINITION.md（bump 1.267.2→1.268.0，minor）+ `docs/learnings/cp-07180640-executor-consolidation.md`

- [ ] npm version 1.268.0（4 件套）→ facts-check + check-version-sync 全绿
- [ ] Learning：根本原因=执行体决策散在 9 段 if 链，三轴分配器无处插座（对抗审查 REJECT）；下次预防=加派发通道前先收权成一个决策点（beeba317 收 harness cap 同款手法）
- [ ] Commit

## Self-Review
- 覆盖：设计"先收权后加层"原则 → Task1 收权；三轴 allocate 的插座 = resolve-execution.js 的 kind（刀2b 在此增强）
- 纯函数无 IO：Step1 最后一个用例锁死
- 零回归：Step6 跑 dispatch/anchor 现有测试
