# golden_path_proposal task_type 全链接线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Brain 能派发 `golden_path_proposal` 类型任务，走 skill-relay 路径并选中 golden-path-controller skill（本体在 T3，缺失时明确报错）。

**Architecture:** 纯枚举+分支接线：migration 扩 CHECK、task-router 四表登记、executor 复用 runHarnessInitiativeRouter、relay loadSkill 按 task_type 映射、dispatcher 并发/bridge 防线纳入。零新流程，全部复用 harness_initiative 既有路径。

**Tech Stack:** Node.js ESM / vitest / PostgreSQL migration（先例：327_ci_patrol_task_type.sql）

**Spec:** docs/superpowers/specs/2026-07-12-gp2-t2-golden-path-proposal-wiring-design.md

---

### Task 1: Migration 335 + schema 地板推进

**Files:**
- Create: `packages/brain/migrations/335_golden_path_proposal_task_type.sql`
- Modify: `packages/brain/src/selfcheck.js:28`
- Modify: `packages/brain/src/__tests__/selfcheck.test.js:181-184`
- Modify: `packages/brain/src/__tests__/learnings-vectorize.test.js:444-445`

- [ ] **Step 1: 改两个地板测试为期望 '335'（failing test）**

`selfcheck.test.js:181-184` 改为：
```js
  // 335（golden_path_proposal 加入 tasks_task_type_check）为 GP2/T2 派发链前置，
  // 推进地板到 335 防止未跑该迁移的旧 DB 上圈选建任务被 CHECK 拒。
  it('EXPECTED_SCHEMA_VERSION should be 335 (floor, bumped for golden_path_proposal task_type)', () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe('335');
```
`learnings-vectorize.test.js:444-445` 改为：
```js
    // 335 = migration 335 golden_path_proposal task_type（GP2/T2 派发链直接依赖），故推进地板到 335。
    expect(EXPECTED_SCHEMA_VERSION).toBe('335');
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/selfcheck.test.js -t "EXPECTED_SCHEMA_VERSION"`
Expected: FAIL（现值 '334'）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/selfcheck.test.js packages/brain/src/__tests__/learnings-vectorize.test.js
git commit -m "test: schema 地板推进 335 failing test（golden_path_proposal 前置）"
```

- [ ] **Step 4: 写 migration 335**

创建 `packages/brain/migrations/335_golden_path_proposal_task_type.sql`：
```sql
-- Migration 335: 扩展 tasks_task_type_check — 加入 golden_path_proposal
-- GP2/T2（AI 自提 Golden Path 模式，architecture: docs/architecture/2026-07-12-golden-path-mode/）。
-- 同 migration 327（ci_patrol）同款修法：DROP + 重建，保留现行全部值。
-- 不加这条，圈选端点（T7）建 golden_path_proposal 任务的 INSERT 直接被库拒。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory',
    'explore', 'knowledge', 'qa', 'audit', 'decomp_review', 'codex_qa',
    'codex_dev', 'codex_test_gen', 'pr_review', 'code_review',
    'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session', 'intent_expand', 'cto_review', 'spec_review',
    'code_review_gate', 'prd_review', 'initiative_review',
    'scope_plan', 'project_plan', 'okr_initiative_plan',
    'okr_scope_plan', 'okr_project_plan',
    'content-pipeline', 'content-research', 'content-generate',
    'content-review', 'content-export', 'content_publish',
    'content-copywriting', 'content-copy-review', 'content-image-review',
    'pipeline_rescue', 'crystallize', 'crystallize_scope',
    'crystallize_forge', 'crystallize_verify', 'crystallize_register',
    'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review',
    'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'sprint_report',
    'cecelia_event', 'harness_planner', 'harness_contract_propose',
    'harness_contract_review', 'harness_generate', 'harness_generator',
    'harness_ci_watch', 'harness_evaluate', 'harness_fix',
    'harness_deploy_watch', 'harness_report', 'platform_scraper',
    'harness_initiative', 'harness_task', 'harness_final_e2e',
    'trigger_backup', 'harness_intervention', 'staging_e2e', 'skill_eval',
    'ci_patrol', 'golden_path_proposal'
  )
);

INSERT INTO schema_version (version, description)
VALUES ('335', 'Add golden_path_proposal to tasks_task_type_check constraint')
ON CONFLICT (version) DO NOTHING;
```
⚠️ 值列表必须与 327 现行全量一致再追加——写完后运行下方核对命令确认无漏值：
`diff <(grep -o "'[a-z_-]*'" packages/brain/migrations/327_ci_patrol_task_type.sql | sort -u) <(grep -o "'[a-z_-]*'" packages/brain/migrations/335_golden_path_proposal_task_type.sql | sort -u)`
Expected: 只多出 `'golden_path_proposal'` 一行（>侧）。

- [ ] **Step 5: selfcheck.js:28 地板推进**

```js
export const EXPECTED_SCHEMA_VERSION = '335';
```

- [ ] **Step 6: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/selfcheck.test.js src/__tests__/learnings-vectorize.test.js`
Expected: PASS

- [ ] **Step 7: commit**

```bash
git add packages/brain/migrations/335_golden_path_proposal_task_type.sql packages/brain/src/selfcheck.js
git commit -m "feat(brain): migration 335 — tasks_task_type_check 加入 golden_path_proposal"
```

---

### Task 2: task-router 四表登记

**Files:**
- Create: `packages/brain/src/__tests__/task-router-golden-path-proposal.test.js`
- Modify: `packages/brain/src/task-router.js`（:54 / :151 / :298 / :378 四区）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/task-router-golden-path-proposal.test.js`（照 task-router-ci-patrol.test.js 模板）：
```js
/**
 * GP2/T2 golden_path_proposal 四表登记（architecture: 2026-07-12-golden-path-mode）。
 * 防 strategist_decision 式漏登：四表任一缺失，任务创建/派发即被拒或降级。
 */
import { describe, it, expect } from 'vitest';
import {
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  LOCATION_MAP,
  TASK_REQUIREMENTS,
  routeTaskCreate,
} from '../task-router.js';

describe('task-router: golden_path_proposal registration', () => {
  it('is a valid task type', () => {
    expect(VALID_TASK_TYPES).toContain('golden_path_proposal');
  });

  it('routes to /golden-path-controller skill', () => {
    expect(SKILL_WHITELIST['golden_path_proposal']).toBe('/golden-path-controller');
  });

  it('is located at us', () => {
    expect(LOCATION_MAP['golden_path_proposal']).toBe('us');
  });

  it('requires has_git', () => {
    expect(TASK_REQUIREMENTS['golden_path_proposal']).toEqual(['has_git']);
  });

  it('routeTaskCreate resolves full routing for golden_path_proposal', () => {
    const result = routeTaskCreate({ title: 'GP 提案', task_type: 'golden_path_proposal' });
    expect(result.location).toBe('us');
    expect(result.skill).toBe('/golden-path-controller');
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/task-router-golden-path-proposal.test.js`
Expected: FAIL（VALID_TASK_TYPES 不含）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/task-router-golden-path-proposal.test.js
git commit -m "test(brain): golden_path_proposal 四表登记 failing test"
```

- [ ] **Step 4: task-router.js 四处登记**

VALID_TASK_TYPES（`'ci_patrol',` 行后，:61 区）加：
```js
  'golden_path_proposal',  // GP loop：AI 自提 Golden Path 提案（圈选后走 relay 跑 golden-path-controller）
```
SKILL_WHITELIST（`'harness_final_e2e': '/harness-evaluator',` 行后，:152 区）加：
```js
  'golden_path_proposal': '/golden-path-controller', // GP 提案 — relay 实际 spawn skill 由 harness-skill-relay 映射
```
LOCATION_MAP（`'harness_initiative': 'us',` 行后，:298 区）加：
```js
  'golden_path_proposal': 'us',   // GP 提案 → US 本机 relay（同 harness_initiative 路径）
```
TASK_REQUIREMENTS/CAPABILITY_REQUIREMENTS（`'harness_initiative':       ['has_git'],` 行后，:378 区）加：
```js
  'golden_path_proposal':     ['has_git'],
```

- [ ] **Step 5: 跑测试确认绿 + 回归**

Run: `cd packages/brain && npx vitest run src/__tests__/task-router-golden-path-proposal.test.js src/__tests__/task-router.test.js src/__tests__/task-router-core.test.js src/__tests__/task-router-ci-patrol.test.js`
Expected: 全 PASS

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/task-router.js
git commit -m "feat(brain): task-router 四表登记 golden_path_proposal"
```

---

### Task 3: executor 派发分支 + EXECUTOR_KIND_FOR

**Files:**
- Create: `packages/brain/src/__tests__/golden-path-proposal-wiring.test.js`
- Modify: `packages/brain/src/executor-contracts.js:27` 区
- Modify: `packages/brain/src/executor.js`（:3158 / :3218 / :2963）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/golden-path-proposal-wiring.test.js`：
```js
/**
 * GP2/T2 executor 派发接线（DoD F2）。
 * dispatch 分支/override 排除用源码断言（同 all-features-smoke.test.js 读源模式）——
 * executeTask 全链需重基建 fake，接线正确性由字面量条件保证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXECUTOR_KIND_FOR } from '../executor-contracts.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../executor.js'), 'utf8'
);

describe('executor: golden_path_proposal 派发接线', () => {
  it('EXECUTOR_KIND_FOR 打标 relay-container', () => {
    expect(EXECUTOR_KIND_FOR.golden_path_proposal).toBe('relay-container');
  });

  it('dispatch 分支覆盖 golden_path_proposal（复用 runHarnessInitiativeRouter）', () => {
    expect(SRC).toMatch(
      /task\.task_type === 'harness_initiative' \|\| task\.task_type === 'golden_path_proposal'/
    );
  });

  it('显式 machine/executor override 排除 golden_path_proposal（防劫持绕过 relay）', () => {
    expect(SRC).toMatch(
      /task\.task_type !== 'harness_initiative' &&\s*task\.task_type !== 'golden_path_proposal'/
    );
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/golden-path-proposal-wiring.test.js`
Expected: FAIL（三条全红）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/golden-path-proposal-wiring.test.js
git commit -m "test(brain): executor golden_path_proposal 派发接线 failing test"
```

- [ ] **Step 4: executor-contracts.js 加打标**

`harness_initiative: 'relay-container',` 行后加：
```js
  // golden_path_proposal 同走 runHarnessInitiativeRouter → spawnSkillRelaySession（GP2/T2）
  golden_path_proposal: 'relay-container',
```

- [ ] **Step 5: executor.js 三处**

:3218 dispatch 分支改为：
```js
  if (task.task_type === 'harness_initiative' || task.task_type === 'golden_path_proposal') {
```
其下 :3221 打标行改为按类型取：
```js
    await setExecutorKind(task.id, EXECUTOR_KIND_FOR[task.task_type]);
```
:3158-3159 override 排除条件改为：
```js
    task.task_type !== 'harness_initiative' &&
    task.task_type !== 'golden_path_proposal' &&
```
:2963 错误文案泛化（模板串里 harness_initiative 改为 `${task?.task_type ?? 'harness_initiative'}`）：
```js
      `${task?.task_type ?? 'harness_initiative'} requires payload.orchestrator==='skill-relay'; got: ${task?.payload?.orchestrator ?? '(missing)'}`
```

- [ ] **Step 6: 跑测试确认绿 + 回归**

Run: `cd packages/brain && npx vitest run src/__tests__/golden-path-proposal-wiring.test.js src/__tests__/harness-orchestrator-lockdown.test.js src/__tests__/headed-dispatch.test.js src/__tests__/executor-startup-sync.test.js`
Expected: 全 PASS

- [ ] **Step 7: commit**

```bash
git add packages/brain/src/executor-contracts.js packages/brain/src/executor.js
git commit -m "feat(brain): executor 派发分支扩 golden_path_proposal 复用 runHarnessInitiativeRouter"
```

---

### Task 4: harness-skill-relay loadSkill 按 task_type 映射

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js`（新 helper + :162 / :392 两处调用）
- Modify: `packages/brain/src/__tests__/harness-skill-relay.test.js`（追加用例）

- [ ] **Step 1: 写 failing test**

在 `harness-skill-relay.test.js` 顶部 import 行加 `controllerSkillFor`：
```js
import { spawnSkillRelaySession, isSkillRelayTask, controllerSkillFor } from '../harness-skill-relay.js';
```
文件末尾追加：
```js
describe('controllerSkillFor（GP2/T2：按 task_type 选 controller skill）', () => {
  it('golden_path_proposal → golden-path-controller', () => {
    expect(controllerSkillFor('golden_path_proposal')).toBe('golden-path-controller');
  });
  it('harness_initiative / 未知类型 → harness-controller（默认不变）', () => {
    expect(controllerSkillFor('harness_initiative')).toBe('harness-controller');
    expect(controllerSkillFor(undefined)).toBe('harness-controller');
  });
});

describe('spawnSkillRelaySession: golden_path_proposal 选中 golden-path-controller', () => {
  it('loadSkill 被以 golden-path-controller 调用', async () => {
    const deps = makeDeps();
    const gpTask = { ...TASK, task_type: 'golden_path_proposal' };
    const r = await spawnSkillRelaySession(gpTask, deps);
    expect(r.ok).toBe(true);
    expect(deps.loadSkill).toHaveBeenCalledWith('golden-path-controller');
  });

  it('harness_initiative 默认仍是 harness-controller（零回归）', async () => {
    const deps = makeDeps();
    await spawnSkillRelaySession({ ...TASK, task_type: 'harness_initiative' }, deps);
    expect(deps.loadSkill).toHaveBeenCalledWith('harness-controller');
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js`
Expected: FAIL（controllerSkillFor 未导出）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/harness-skill-relay.test.js
git commit -m "test(brain): relay loadSkill 按 task_type 选 controller failing test"
```

- [ ] **Step 4: 实现 helper + 两处调用**

在 `harness-skill-relay.js` 顶部（isSkillRelayTask 附近）加导出：
```js
/**
 * controllerSkillFor — 按 task_type 选 relay session 要跑的 controller skill（GP2/T2）。
 * golden-path-controller 本体在 skills repo T3 落地；未部署时 loadSkillContent 会带
 * skill 名 throw（harness-shared.js:62），spawn 硬失败不起半截 session——即"明确报错"。
 */
export function controllerSkillFor(taskType) {
  return taskType === 'golden_path_proposal' ? 'golden-path-controller' : 'harness-controller';
}
```
:162 与 :392 两处 `loadSkill('harness-controller')` 都改为：
```js
    const skillContent = loadSkill(controllerSkillFor(task.task_type));
```
（:231/:237/:241 的 harness_controller 角色覆写不动——容器回调按此识别节点，T3 落地时按需调整。）

- [ ] **Step 5: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js`
Expected: 全 PASS（含既有用例零回归）

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/harness-skill-relay.js
git commit -m "feat(brain): relay loadSkill 按 task_type 映射 golden-path-controller"
```

---

### Task 5: dispatcher 并发/lock/bridge 三防线

**Files:**
- Modify: `packages/brain/src/dispatcher.js`（:82 / :90-97 / :470 / :598）
- Modify: `packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js`（追加用例）
- Modify: `packages/brain/src/__tests__/golden-path-proposal-wiring.test.js`（追加源码断言）

- [ ] **Step 1: 写 failing test**

`dispatcher-harness-concurrency-cap.test.js` 文件末尾追加（shouldApplyHarnessCap 已从 dispatcher.js 导出，沿用该文件既有 import）：
```js
describe('shouldApplyHarnessCap: golden_path_proposal 纳入同一并发防线（GP2/T2）', () => {
  it('golden_path_proposal 非 resume → true', () => {
    expect(shouldApplyHarnessCap({ task_type: 'golden_path_proposal', payload: {} })).toBe(true);
  });
  it('golden_path_proposal resume → false', () => {
    expect(shouldApplyHarnessCap({
      task_type: 'golden_path_proposal',
      payload: { resume_from_checkpoint: true },
    })).toBe(false);
  });
});
```
`golden-path-proposal-wiring.test.js` 末尾追加：
```js
const DISPATCHER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../dispatcher.js'), 'utf8'
);

describe('dispatcher: golden_path_proposal 防线接线', () => {
  it('并发 cap 计数 SQL 口径含 golden_path_proposal', () => {
    expect(DISPATCHER_SRC).toMatch(
      /task_type IN \('harness_initiative', 'golden_path_proposal'\)/
    );
  });
  it('INITIATIVE_LOCK_TASK_TYPES 含 golden_path_proposal', () => {
    expect(DISPATCHER_SRC).toMatch(/'golden_path_proposal',\s*\n\s*'harness_initiative',|'harness_initiative',\s*\n\s*'golden_path_proposal',/);
  });
  it('needsBridgeCheck 豁免 golden_path_proposal（relay 不依赖 bridge）', () => {
    expect(DISPATCHER_SRC).toMatch(
      /nextTask\.task_type !== 'harness_initiative'\s*&&\s*nextTask\.task_type !== 'golden_path_proposal'/
    );
  });
  it('绝不在 retired 集合（加了 = 派发即 terminal failed）', () => {
    const retiredBlock = DISPATCHER_SRC.match(/_RETIRED_HARNESS_TYPES_DISPATCH = new Set\(\[[\s\S]*?\]\)/)[0];
    expect(retiredBlock).not.toContain('golden_path_proposal');
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-harness-concurrency-cap.test.js src/__tests__/golden-path-proposal-wiring.test.js`
Expected: 新增用例 FAIL（retired 断言天然绿允许）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js packages/brain/src/__tests__/golden-path-proposal-wiring.test.js
git commit -m "test(brain): dispatcher golden_path_proposal 三防线 failing test"
```

- [ ] **Step 4: dispatcher.js 四处**

:82 shouldApplyHarnessCap 改为：
```js
export function shouldApplyHarnessCap(candidate) {
  if (!candidate) return false;
  if (candidate.task_type !== 'harness_initiative'
      && candidate.task_type !== 'golden_path_proposal') return false;
  if (candidate.payload?.resume_from_checkpoint === true) return false;
  return true;
}
```
:470 cap 计数 SQL `WHERE task_type = 'harness_initiative'` 改为：
```sql
           WHERE task_type IN ('harness_initiative', 'golden_path_proposal')
```
:90-97 INITIATIVE_LOCK_TASK_TYPES 的 `'harness_initiative',` 后加：
```js
  'golden_path_proposal',
```
:598 改为：
```js
  const needsBridgeCheck = nextTask.task_type !== 'harness_initiative'
    && nextTask.task_type !== 'golden_path_proposal';
```

- [ ] **Step 5: 跑测试确认绿 + 回归**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-harness-concurrency-cap.test.js src/__tests__/golden-path-proposal-wiring.test.js src/__tests__/dispatcher.test.js src/__tests__/dispatcher-initiative-lock.test.js src/__tests__/dispatcher-circuit-harness-exempt.test.js`
Expected: 全 PASS

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/dispatcher.js
git commit -m "feat(brain): dispatcher 并发cap/initiative-lock/bridge豁免纳入 golden_path_proposal"
```

---

### Task 6: E2E smoke（DoD F2）+ 全量回归 + DevGate + version bump

**Files:**
- Modify: `packages/brain/src/__tests__/golden-path-proposal-wiring.test.js`（追加 E2E smoke describe）
- Modify: `packages/brain/package.json`（version minor bump）

- [ ] **Step 1: 追加 E2E smoke 用例（路由→校验→loadSkill 全链）**

`golden-path-proposal-wiring.test.js` 末尾追加：
```js
import { routeTaskCreate } from '../task-router.js';
import { spawnSkillRelaySession } from '../harness-skill-relay.js';
import { vi } from 'vitest';

describe('E2E smoke（DoD F2）：golden_path_proposal 路由→orchestrator校验→loadSkill 全链', () => {
  const gpTask = {
    id: 'aaaabbbb-cccc-dddd-eeee-ffff0000gp02',
    title: 'GP 提案 smoke',
    task_type: 'golden_path_proposal',
    payload: { orchestrator: 'skill-relay', sprint_dir: 'sprints/gp-smoke' },
  };

  it('task-router 路由通过（us + /golden-path-controller）', () => {
    const r = routeTaskCreate({ title: gpTask.title, task_type: gpTask.task_type });
    expect(r.location).toBe('us');
    expect(r.skill).toBe('/golden-path-controller');
  });

  it('relay spawn 全链通且 loadSkill 收到 golden-path-controller', async () => {
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid', dockerStdout: 'x' }),
      loadSkill: vi.fn().mockReturnValue('SKILL golden-path-controller 全文'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/gp-smoke'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-12T04:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
    };
    const r = await spawnSkillRelaySession(gpTask, deps);
    expect(r.ok).toBe(true);
    expect(deps.loadSkill).toHaveBeenCalledWith('golden-path-controller');
  });

  it('skill 未部署 → loadSkill throw → 硬失败不起半截 session（明确报错）', async () => {
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn(),
      loadSkill: vi.fn(() => { throw new Error('loadSkillContent: SKILL.md not found for golden-path-controller'); }),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/gp-smoke'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-12T04:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
    };
    const r = await spawnSkillRelaySession(gpTask, deps);
    expect(r.ok).toBe(false);
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });
});
```
注：若 import 与文件已有 import 重复，合并到顶部一处。

- [ ] **Step 2: 跑本文件确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/golden-path-proposal-wiring.test.js`
Expected: 全 PASS

- [ ] **Step 3: 分批全量回归（防环境级 OOM，见 memory fix-escalation 教训）**

Run: `cd packages/brain && npx vitest run src/__tests__/ --pool=forks --maxWorkers=2 2>&1 | tail -20`
Expected: 全 PASS（如 OOM 则按目录分批跑）

- [ ] **Step 4: DevGate 三闸**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全过。

- [ ] **Step 5: brain version bump（semver minor）**

`packages/brain/package.json` version 按现值 minor +1（如 1.253.x → 1.254.0；以当时实际现值为准），并跑 `bash scripts/check-version-sync.sh` 确认四处同步（如脚本报别处需同步，按报错补齐）。

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/__tests__/golden-path-proposal-wiring.test.js packages/brain/package.json
git commit -m "test(brain): golden_path_proposal E2E smoke（DoD F2）+ version bump"
```
