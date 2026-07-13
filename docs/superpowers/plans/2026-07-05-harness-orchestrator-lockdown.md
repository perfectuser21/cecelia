# Harness 点火路径隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `packages/brain/src/executor.js` 的 `_driveHarnessInitiative` 加硬校验，`payload.orchestrator !== 'skill-relay'` 时直接拒绝任务，不再默认降级走 LangGraph 图（`compileHarnessFullGraph`）。

**Architecture:** 在现有 if 分支前插入一个新的守卫分支，复用既有的 `markInitiativeTerminalFailed` 失败模式，返回值形状与调用方既有契约（`{ok, error, terminal}`）保持一致，零改动调用方。LangGraph 图代码本身不删除、不修改。

**Tech Stack:** Node.js, vitest（mock 模式照抄 `harness-max-fresh-starts.test.js`）

## Global Constraints

- 返回值形状必须严格是 `{ ok: false, error: string, terminal: true }`（外层 `executeTask` 按 `result.ok` 三态处理，见 `executor.js:3254-3282`）
- `markInitiativeTerminalFailed` 的签名固定为 `(dbPool, taskId, failureClass, errorMessage)`，不可更改
- `compileHarnessFullGraph` 相关 import/调用本次不删除，只让它变成不可达代码
- 新分支必须放在 `_driveHarnessInitiative` 函数体最前面（`executor.js:2887` 函数声明之后），早于现有的 `skill-relay` if 判断（第 2895 行），确保任何非法 payload 都先被拦下
- 测试必须照抄 `packages/brain/src/__tests__/harness-max-fresh-starts.test.js` 的 mock 骨架（同一份 vi.mock 列表），不得引入新的 mock 策略

## 范围扩展记录（Task 3 执行中发现，2026-07-05）

Task 1 的 brief（Step 5）只预料了 4 个既有测试文件的回归检查，遗漏了另外 5 个同样通过
`runHarnessInitiativeRouter`（无 orchestrator flag）测试 LangGraph 图路径具体行为的既有
regression test 文件。用基线对比（改动前 commit `45b93518e` vs 改动后）确认：这 5 个文件
的失败是本次改动的真实、直接副作用（不是环境/DB 问题——环境类失败在两次跑里数量一致）：

- `../../tests/integration/harness-stream-events.test.js`（W4 streamMode events）
- `../../tests/integration/harness-thread-id-versioning.test.js`（W1 thread_id 版本化）
- `../../tests/integration/harness-watchdog.test.js`（W3 AbortSignal watchdog）
- `src/__tests__/harness-initiative-executor-writeback.test.js`
- `src/__tests__/harness-resume-checkpoint-error-state.test.js`

处理原则与 `harness-max-fresh-starts.test.js` 一致：这些测试测的行为现在都是永久不可达代码
（硬校验在到达这些逻辑之前就 return 了），不是测试本身写错。追加 **Task 4** 处理。

---

### Task 1: executor.js 硬校验 + regression test

**Files:**
- Modify: `packages/brain/src/executor.js:2887-2901`（`_driveHarnessInitiative` 函数体开头）
- Test: `packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js`（新建）

**Interfaces:**
- Consumes：`markInitiativeTerminalFailed(dbPool, taskId, failureClass, errorMessage)`（已存在，`executor.js:2820`，无需改动签名）
- Produces：`_driveHarnessInitiative` 对非法 payload 的新返回值 `{ ok: false, error: 'missing_orchestrator_flag', terminal: true }`；此形状被 Task 2 的 smoke 脚本更新间接依赖（不直接调用，仅需保证行为一致）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js`，完整复制 `harness-max-fresh-starts.test.js` 第 1-243 行的所有 `vi.mock` 声明和 `beforeEach`/`makeTask` 骨架（保持一致的 mock 依赖列表，避免遗漏任何一个 executor.js 的外部依赖导致真实 import 报错），只改测试用例部分：

```javascript
/**
 * Regression test — harness_initiative 点火路径隔离（硬校验）
 *
 * 背景：2026-07-04 主理人拍板全面转向 skill-relay 接力模式。
 * 之前 payload.orchestrator !== 'skill-relay' 时会默认 fallthrough 到
 * LangGraph 图路径（compileHarnessFullGraph），30 天基线成功率仅 21.7%，
 * 且这个降级是隐式的——忘记带 flag 不会报错，只会悄悄跑更差的路径。
 *
 * 修复：_driveHarnessInitiative 顶部加硬校验。
 * - payload.orchestrator !== 'skill-relay' → 立即 markInitiativeTerminalFailed
 *   (failure_class='missing_orchestrator_flag')，返回
 *   { ok:false, error:'missing_orchestrator_flag', terminal:true }，
 *   不 import/调用 compileHarnessFullGraph。
 * - payload.orchestrator === 'skill-relay' → 行为不变，走 spawnSkillRelaySession。
 *
 * SC-201: orchestrator 缺失 → 拒绝，不 invoke LangGraph 图，task 标 failed
 * SC-202: orchestrator='langgraph'（非法值）→ 同样拒绝
 * SC-203: orchestrator='skill-relay' → 正常调用 spawnSkillRelaySession，行为不变
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 所有 executor.js 的外部依赖（与 harness-max-fresh-starts.test.js 完全一致）──

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

const mockUpdateTaskStatus = vi.fn();
vi.mock('../task-updater.js', () => ({
  updateTaskStatus: (...args) => mockUpdateTaskStatus(...args),
  updateTaskProgress: vi.fn(),
}));

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));

vi.mock('../task-type-config-cache.js', () => ({
  loadCache: vi.fn(),
  getCachedLocation: vi.fn(() => null),
  getCachedConfig: vi.fn(() => null),
  refreshCache: vi.fn(),
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  })),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { FAILED: 'failed', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US_VPS: 'us' },
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn(),
}));

vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn(),
  evaluateAlertness: vi.fn().mockResolvedValue({ level: 0, levelName: 'CALM' }),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
  canDispatch: vi.fn().mockReturnValue(true),
  canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1),
  ALERTNESS_LEVELS: { ALERT: 3 },
  LEVEL_NAMES: {},
}));

vi.mock('../alertness/metrics.js', () => ({
  recordTickTime: vi.fn(),
  recordOperation: vi.fn(),
}));

vi.mock('../alertness/healing.js', () => ({
  getRecoveryStatus: vi.fn().mockReturnValue({ isRecovering: false }),
}));

vi.mock('../platform-utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listProcessesWithPpid: vi.fn(() => []),
    listProcessesWithElapsed: vi.fn(() => []),
    getMacOSMemoryPressure: vi.fn(() => 0),
    getAvailableMemoryMB: vi.fn(() => 8000),
    calculatePhysicalCapacity: vi.fn(() => 4),
    countClaudeProcesses: vi.fn(() => 0),
    sampleCpuUsage: vi.fn(() => 0),
    getSwapUsedPct: vi.fn(() => 0),
    getDmesgInfo: vi.fn(() => ''),
    evaluateMemoryHealth: vi.fn(() => ({
      brain_memory_ok: true, system_memory_ok: true, action: 'proceed',
      reason: 'mock', brain_rss_mb: 200, system_available_mb: 8000,
      system_threshold_mb: 600, brain_rss_danger_mb: 1500, brain_rss_warn_mb: 1000,
    })),
    getBrainRssMB: vi.fn(() => 200),
    IS_DARWIN: false,
  };
});

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn().mockResolvedValue({ accountId: 'account1', model: 'sonnet' }),
  selectBestAccountForHaiku: vi.fn().mockResolvedValue('account1'),
  getAccountUsage: vi.fn().mockResolvedValue({}),
  markSpendingCap: vi.fn(),
  isSpendingCapped: vi.fn().mockReturnValue(false),
  isAllAccountsSpendingCapped: vi.fn().mockReturnValue(false),
  getSpendingCapStatus: vi.fn().mockReturnValue([]),
  loadSpendingCapsFromDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn().mockResolvedValue(null),
  FALLBACK_PROFILE: {
    id: 'profile-anthropic',
    name: 'mock',
    config: {
      thalamus: { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001', fallbacks: [] },
      cortex:   { provider: 'anthropic-api', model: 'claude-sonnet-4-6' },
      executor: {
        default_provider: 'anthropic',
        model_map: {
          dev:                { anthropic: 'claude-sonnet-4-6', minimax: null },
          harness_initiative: { anthropic: 'claude-sonnet-4-6', minimax: null },
        },
        fixed_provider: {},
      },
    },
  },
  getModelForTaskType: vi.fn(() => 'claude-sonnet-4-6'),
}));

vi.mock('../learning-retriever.js', () => ({
  buildLearningContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('../decisions-context.js', () => ({
  getDecisionsSummary: vi.fn().mockResolvedValue(null),
}));

vi.mock('../dopamine.js', () => ({
  recordExpectedReward: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../docker-executor.js', () => ({
  writeDockerCallback: vi.fn(),
  resolveResourceTier: vi.fn(() => 'standard'),
  isDockerAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock('../spawn/index.js', () => ({
  spawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => ''),
  exec: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0'),
  readdirSync: vi.fn(() => []),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

vi.mock('../auto-learning.js', () => ({
  processExecutionAutoLearning: vi.fn().mockResolvedValue(undefined),
}));

// ── mock harness graph 动态导入 ─────────────────────────────────

let streamCallCount = 0;

const mockCompiled = {
  stream: vi.fn(async function* (input) {
    streamCallCount++;
    yield { dbUpsert: { sub_tasks: [] } };
  }),
};

const mockCompileHarnessFullGraph = vi.fn().mockResolvedValue(mockCompiled);
vi.mock('../workflows/harness-initiative.graph.js', () => ({
  compileHarnessFullGraph: (...args) => mockCompileHarnessFullGraph(...args),
}));

vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('../events/taskEvents.js', () => ({
  emitGraphNodeUpdate: vi.fn().mockResolvedValue(undefined),
}));

// mock spawnSkillRelaySession（skill-relay 分支依赖，验证 SC-203 时需要它被调用）
const mockSpawnSkillRelaySession = vi.fn().mockResolvedValue({ ok: true, relay: true });
vi.mock('../harness-skill-relay.js', () => ({
  spawnSkillRelaySession: (...args) => mockSpawnSkillRelaySession(...args),
}));

// ── 被测函数 ──────────────────────────────────────────────────

let runHarnessInitiativeRouter;

beforeEach(async () => {
  vi.clearAllMocks();
  streamCallCount = 0;
  mockQuery.mockResolvedValue({ rows: [] });
  mockUpdateTaskStatus.mockResolvedValue(undefined);
  mockSpawnSkillRelaySession.mockResolvedValue({ ok: true, relay: true });
  vi.resetModules();
  const mod = await import('../executor.js');
  runHarnessInitiativeRouter = mod.runHarnessInitiativeRouter;
});

function makeTask(orchestrator) {
  return {
    id: 'task-orch-lockdown-1',
    task_type: 'harness_initiative',
    title: 'harness init orchestrator lockdown test',
    payload: {
      initiative_id: 'init-orch-lockdown-001',
      ...(orchestrator !== undefined ? { orchestrator } : {}),
    },
    status: 'in_progress',
    retry_count: 0,
    execution_attempts: 0,
  };
}

describe('_driveHarnessInitiative — orchestrator 硬校验', () => {

  it('SC-201: orchestrator 缺失 → 拒绝，不 invoke LangGraph 图，task 标 failed', async () => {
    const task = makeTask(undefined);

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockCompileHarnessFullGraph).not.toHaveBeenCalled();
    expect(streamCallCount).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toBe('missing_orchestrator_flag');

    const failCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' &&
        /UPDATE tasks SET[\s\S]*status\s*=\s*'failed'/.test(call[0]) &&
        Array.isArray(call[1]) &&
        call[1].includes(task.id) &&
        call[1].some((p) => String(p).includes('missing_orchestrator_flag'))
    );
    expect(failCall).toBeTruthy();
  });

  it('SC-202: orchestrator 为非法值（如遗留的 "langgraph"）→ 同样拒绝', async () => {
    const task = makeTask('langgraph');

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockCompileHarnessFullGraph).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toBe('missing_orchestrator_flag');
  });

  it('SC-203: orchestrator="skill-relay" → 正常调用 spawnSkillRelaySession，行为不变', async () => {
    const task = makeTask('skill-relay');

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockSpawnSkillRelaySession).toHaveBeenCalledTimes(1);
    expect(mockCompileHarnessFullGraph).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, relay: true });
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-orchestrator-lockdown.test.js`
Expected: SC-201/SC-202 FAIL（因为当前代码没有硬校验，`orchestrator` 缺失/非法时会 fallthrough 到 `compileHarnessFullGraph`，`mockCompileHarnessFullGraph` 会被调用，断言 `not.toHaveBeenCalled()` 失败）；SC-203 应该已经 PASS（现有代码本身就正确处理 skill-relay 分支）

- [ ] **Step 3: 实现硬校验**

修改 `packages/brain/src/executor.js`，在 `_driveHarnessInitiative` 函数体开头（第 2887-2888 行之后，第 2890 行现有注释之前）插入新校验，把原有 if 改造成 else 分支：

将原第 2887-2899 行：

```javascript
async function _driveHarnessInitiative(task, opts = {}) {
  const dbPool = opts.pool || pool;

  // N3 skill-relay 双轨分支（主理人 2026-07-04 拍板）：payload.orchestrator==='skill-relay'
  // → spawn 单 claude session 跑 harness-controller skill，不 compile / 不 invoke 图。
  // flag 缺省 → 走下方原 LangGraph 路径，零行为变化。
  // 注意：flag 判断内联、动态 import 只在命中时发生——v1 路径不多一次模块加载
  //（fake-timer 集成测试对 v1 路径的时序敏感，CI 实证：harness-watchdog W3 用例）。
  if (task?.payload?.orchestrator === 'skill-relay') {
    const { spawnSkillRelaySession } = await import('./harness-skill-relay.js');
    const relayDeps = { pool: dbPool, ...(opts.skillRelayDeps || {}) };
    return await spawnSkillRelaySession(task, relayDeps);
  }
```

替换为：

```javascript
async function _driveHarnessInitiative(task, opts = {}) {
  const dbPool = opts.pool || pool;

  // N4 orchestrator 硬校验（主理人 2026-07-05 拍板，见 memory harness-skill-relay-pivot）：
  // skill-relay 已验证优于 LangGraph 图（3/3~4/4 merged vs 旧图 30 天基线 21.7%），
  // 不再允许 orchestrator 缺省时隐式降级到 LangGraph 图——必须显式声明 skill-relay，
  // 否则直接 terminal failed。LangGraph 图代码本次保留（观察期后再物理删除）。
  if (task?.payload?.orchestrator !== 'skill-relay') {
    await markInitiativeTerminalFailed(
      dbPool,
      task.id,
      'missing_orchestrator_flag',
      `harness_initiative requires payload.orchestrator==='skill-relay'; got: ${task?.payload?.orchestrator ?? '(missing)'}`
    );
    console.error(
      `[executor] task=${task.id} 缺少/非法 orchestrator flag（值=${task?.payload?.orchestrator ?? '(missing)'}），标 terminal failed（不再降级走 LangGraph 图）`
    );
    return { ok: false, error: 'missing_orchestrator_flag', terminal: true };
  }

  // N3 skill-relay 分支（主理人 2026-07-04 拍板）：spawn 单 claude session 跑
  // harness-controller skill，不 compile / 不 invoke 图。
  {
    const { spawnSkillRelaySession } = await import('./harness-skill-relay.js');
    const relayDeps = { pool: dbPool, ...(opts.skillRelayDeps || {}) };
    return await spawnSkillRelaySession(task, relayDeps);
  }
```

保持第 2901 行之后的 `compileHarnessFullGraph` 及其后所有代码原样不动（已不可达，本次不删除）。

- [ ] **Step 4: 跑测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-orchestrator-lockdown.test.js`
Expected: 全部 3 个用例 PASS

- [ ] **Step 5: 跑既有 harness 相关测试确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-max-fresh-starts.test.js src/__tests__/executor-harness-initiative-default-fullgraph.test.js src/__tests__/executor-harness-initiative-ok.test.js src/__tests__/harness-skill-relay.test.js`
Expected: 全部 PASS（若 `executor-harness-initiative-default-fullgraph.test.js` 因为断言"某些默认路径字符串还在"而失败，需要打开该文件确认断言内容是否需要跟随本次改动更新——若其断言的是"存在默认 fallthrough 到 compileHarnessFullGraph 的代码路径"这类语义，需要按 Step 6 处理）

- [ ] **Step 6: 视 Step 5 结果决定是否需要更新 `executor-harness-initiative-default-fullgraph.test.js`**

若 Step 5 中该测试因为静态断言不再成立而 FAIL：打开文件查看具体断言的正则/字符串，判断其原意图是否与本次改动冲突（例如若断言"默认路径存在" `expect(SRC).toMatch(...)`，需要改成断言"默认路径已被硬校验拦截"）。按实际断言内容调整，不臆造具体 diff。若 Step 5 全部 PASS 无需改动，跳过本 step。

- [ ] **Step 7: Commit**

```bash
git add packages/brain/src/executor.js packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js
git commit -m "feat(brain): harness_initiative 强制 orchestrator=skill-relay，废弃 LangGraph 图隐式兜底

主理人已拍板全面转向单 session skill-relay 接力（3/3~4/4 merged vs 旧图
30天基线21.7%成功率）。非法/缺失 orchestrator 不再默认降级走 LangGraph
图，直接 terminal failed，堵住忘记带 flag 就悄悄跑更差路径的隐患。"
```

（若 Step 6 有额外改动，一并 add 到本 commit 或按需拆分为独立 commit，视改动大小判断。）

---

### Task 2: 更新 harness-pipeline-lifecycle-smoke.sh payload

**Files:**
- Modify: `packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh:51-60`

**Interfaces:**
- Consumes：Task 1 完成后的新硬校验行为（无 orchestrator 会被 terminal failed）
- Produces：无（脚本本身不被其他任务消费）

**背景**：此脚本设计用来手动/定时跑通完整 90 分钟 pipeline（`[[ "${CI:-}" == "true" ]] && skip`，不进 CI 强制门禁），当前 POST payload 缺少 `orchestrator` 字段。Task 1 落地后，这个 payload 会被新硬校验直接拒绝（task 立即 `failed`），而脚本的判定逻辑是"completed 或 failed 均视为 PASS（验证不卡死）"——技术上仍会"通过"，但完全不再测试真实 pipeline 执行，失去这个 smoke 脚本的意义。必须补上 flag。

- [ ] **Step 1: 修改 payload**

将 `harness-pipeline-lifecycle-smoke.sh` 第 51-60 行：

```bash
TASK_JSON=$(curl -sf -m 10 -X POST "${BRAIN_URL}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"task_type\": \"harness_initiative\",
    \"title\": \"[smoke] harness-pipeline-lifecycle $(date +%Y%m%d-%H%M%S)\",
    \"payload\": {
      \"sprint_dir\": \"${SPRINT_DIR}\",
      \"smoke_test\": true
    }
  }" 2>/dev/null) || fail "POST /api/brain/tasks 失败"
```

替换为：

```bash
TASK_JSON=$(curl -sf -m 10 -X POST "${BRAIN_URL}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"task_type\": \"harness_initiative\",
    \"title\": \"[smoke] harness-pipeline-lifecycle $(date +%Y%m%d-%H%M%S)\",
    \"payload\": {
      \"sprint_dir\": \"${SPRINT_DIR}\",
      \"smoke_test\": true,
      \"orchestrator\": \"skill-relay\"
    }
  }" 2>/dev/null) || fail "POST /api/brain/tasks 失败"
```

- [ ] **Step 2: 静态验证 JSON 合法**

Run: `node -e "const s='sprints/w19-playground-sum'; const j=JSON.parse(\`{\"task_type\":\"harness_initiative\",\"title\":\"x\",\"payload\":{\"sprint_dir\":\"\${s}\",\"smoke_test\":true,\"orchestrator\":\"skill-relay\"}}\`.replace('\${s}', s)); console.log(j.payload.orchestrator)"`
Expected: 输出 `skill-relay`（验证改动后的 heredoc 拼接出的 JSON 结构合法，`orchestrator` 字段位置正确）

- [ ] **Step 3: Commit**

```bash
git add packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh
git commit -m "fix(smoke): harness-pipeline-lifecycle-smoke 补 orchestrator=skill-relay

Task 1 加了硬校验后，缺 orchestrator 字段的任务会被立即 terminal failed，
该 smoke 脚本会误判为 PASS（completed/failed 均算过）但实际没测到真实
pipeline 执行，需要补上 flag 才能继续验证完整流程。"
```

---

### Task 3: 跑完整 CI 相关测试 + 文档更新提醒

**Files:**
- 无新文件；仅执行验证

- [ ] **Step 1: 跑全量 brain 单测**

Run: `cd packages/brain && npx vitest run`
Expected: 全部 PASS，无新增失败

- [ ] **Step 2: 跑 DevGate 三件套**

Run:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三者均通过（本次改动不涉及 DEFINITION.md 描述的事实、不涉及版本号、DoD 映射见下方 PrepPRD 验收标准已含 [BEHAVIOR] test）

- [ ] **Step 3: 记录 zenithjoy-skills 侧待办（不在本 PR 范围内，仅书面提醒）**

不需要写代码，仅在 PR description 里注明：`packages/engine/skills/dev/SKILL.md` 是 legacy 拷贝，真正 SSOT 在 `perfect21/zenithjoy-skills` 仓库的 `dev/SKILL.md`（第 305-322 行路径 C 点火 curl 模板），当前该模板缺少 `orchestrator` 字段。本次 cecelia 侧硬校验合并后，`/dev` 路径 C 若不同步更新该模板会被新校验拦下。这个更新必须走 `skill-creator` skill 在 zenithjoy-skills 仓库单独开 PR，不属于本次 /dev 流程范围，需要作为紧接着的下一个动作单独处理（会话内继续，不等待本 PR 合并）。

---

### Task 4（范围扩展）：修复另外 5 个因 orchestrator 硬校验而回归的既有测试文件

**Files:**
- Modify: `packages/brain/tests/integration/harness-stream-events.test.js`
- Modify: `packages/brain/tests/integration/harness-thread-id-versioning.test.js`
- Modify: `packages/brain/tests/integration/harness-watchdog.test.js`
- Modify: `packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js`
- Modify: `packages/brain/src/__tests__/harness-resume-checkpoint-error-state.test.js`

**Interfaces:**
- Consumes：Task 1 的硬校验行为（`_driveHarnessInitiative` 对缺 orchestrator 的任务立即 `{ok:false, error:'missing_orchestrator_flag', terminal:true}`）
- Produces：无（纯测试修复，不影响其他任务）

**背景**：这 5 个文件都是通过 `runHarnessInitiativeRouter(task, opts)` 调用、task 不带 `orchestrator` 字段来测试 LangGraph 图路径的具体行为（W1 thread_id 版本化 / W3 AbortSignal watchdog / W4 streamMode events / executor writeback / checkpoint resume 坏检测）。Task 1 落地后，这些 task 会在到达被测逻辑之前就被硬校验拦截，导致断言全部落空。已用基线对比（改动前 commit `45b93518e` vs 改动后）确认这是本次改动的直接副作用，不是环境问题（两次跑环境类失败数量一致）。

**处理原则**：与已经修过的 `harness-max-fresh-starts.test.js` 一致——不删除测试文件，而是：
1. 在每个文件顶部文档注释追加说明：2026-07-05 起 `_driveHarnessInitiative` 加了 orchestrator 硬校验，本文件测的场景（task 不带 orchestrator 时仍能到达 LangGraph 图内部逻辑）已不可能发生，这段代码路径变成永久不可达（保留待观察期后物理清理），故以下用例改为 `it.skip` 并说明原因
2. 把每个文件里所有依赖"task 不带 orchestrator 也能到达图内部逻辑"这个前提的 `it(...)` 用例改成 `it.skip(...)`，标题追加"（2026-07-05 orchestrator 硬校验后已不可达，skip）"这类说明，**不删除测试体**（保留骨架待 fresh-starts/W1/W3/W4 这些保护逻辑如果未来迁移到 skill-relay 路径时复用）
3. 如果文件里有些用例本来就不依赖这个前提（比如纯粹测试某个不涉及 orchestrator 判断的辅助函数），不要动，只改真正因为硬校验而不可达的那些
4. 每个文件改完后，在其顶部文档注释里加一句指向本次 lockdown 改动的说明（可以照抄 `harness-max-fresh-starts.test.js` 顶部注释的类似措辞，保持项目内一致性）

**这不是要重新设计 W1/W3/W4 保护逻辑迁移到 skill-relay 路径**——那是一个更大的独立问题（已经在 Task 1 里把 relay-watchdog 覆盖面窄的问题记录为 Notion Issue `1ea53e09-b088-4d2a-b03a-ad8c976bbc6c`）。本任务只负责让测试套件如实反映"这些具体保护逻辑测试的代码已不可达"这个事实，不引入新设计。

- [ ] **Step 1: 逐文件确认当前失败断言**

对 5 个文件各跑一次单文件测试，记录当前失败的具体用例列表：
```bash
cd packages/brain
npx vitest run tests/integration/harness-stream-events.test.js
npx vitest run tests/integration/harness-thread-id-versioning.test.js
npx vitest run tests/integration/harness-watchdog.test.js
npx vitest run src/__tests__/harness-initiative-executor-writeback.test.js
npx vitest run src/__tests__/harness-resume-checkpoint-error-state.test.js
```
Expected: 每个文件都有部分或全部用例 FAIL，具体失败原因应该是"expected X to be called/expected Y" 之类的断言失败（不是 import/语法错误）——如果发现语法错误或 import 报错，说明不是本任务预期的回归类型，需要先报告，不要直接动手改。

- [ ] **Step 2: 逐文件按处理原则修改**

对每个文件应用上面"处理原则"里的 1-4 步。每个文件里具体哪些 `it(...)` 需要改成 `it.skip(...)`，需要根据 Step 1 跑出来的实际 FAIL 列表逐一核对（不要凭猜测判断哪些用例受影响，以实跑结果为准）。

- [ ] **Step 3: 跑 5 个文件确认全部 PASS（含 skip）**

```bash
cd packages/brain
npx vitest run tests/integration/harness-stream-events.test.js tests/integration/harness-thread-id-versioning.test.js tests/integration/harness-watchdog.test.js src/__tests__/harness-initiative-executor-writeback.test.js src/__tests__/harness-resume-checkpoint-error-state.test.js
```
Expected: 全部 PASS 或 skipped，0 failed。

- [ ] **Step 4: 跑一次全量 brain 测试套件，和基线（改动前 commit `45b93518e`）比对，确认失败文件数不再增加**

```bash
cd packages/brain && npx vitest run --pool=forks --poolOptions.forks.maxForks=2
```
Expected: 失败的测试文件集合应该和改动前 baseline（11 个失败文件，主要是需要真实 PostgreSQL/DB 的 integration test 和 schema version selfcheck 类，这些是环境问题、与本次改动无关）一致或更少，不应该再多出任何和 harness_initiative/orchestrator 相关的新增失败。

- [ ] **Step 5: Commit**

```bash
git add packages/brain/tests/integration/harness-stream-events.test.js \
        packages/brain/tests/integration/harness-thread-id-versioning.test.js \
        packages/brain/tests/integration/harness-watchdog.test.js \
        packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js \
        packages/brain/src/__tests__/harness-resume-checkpoint-error-state.test.js
git commit -m "test(brain): 修复 orchestrator 硬校验导致的 5 个既有测试文件回归

W1/W3/W4 三个 integration test + writeback + resume-checkpoint 测试的都是
LangGraph 图路径内部行为（task 不带 orchestrator）。硬校验落地后这些场景
永久不可达，与 harness-max-fresh-starts.test.js 同样处理：受影响用例改
it.skip 并说明原因，不删除，保留骨架待未来保护逻辑迁移到 skill-relay 路径
时复用。基线对比（commit 45b93518e vs 本分支）确认这是本次改动的直接
副作用而非环境问题。"
```
