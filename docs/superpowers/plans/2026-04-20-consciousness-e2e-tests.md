# Consciousness E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** 补两个 integration test 覆盖 consciousness toggle 的 tick runtime + HTTP 端到端链路。

**Architecture:** Tick test 用真 `executeTick()` + 全量 mock 重模块；E2E 用 supertest makeApp 范式（不装 Playwright）。两文件都放 `integration/` 目录，CI brain-integration 自动扫。

**Tech Stack:** Vitest / vi.mock / pg / supertest / Node ESM

**Spec:** `docs/superpowers/specs/2026-04-20-consciousness-e2e-tests-design.md`

---

## File Structure

**新建**：
- `packages/brain/src/__tests__/integration/consciousness-tick-runtime.integration.test.js`
- `packages/brain/src/__tests__/integration/consciousness-toggle-e2e.integration.test.js`

**修改**：无

---

## Task 1: Tick-level runtime integration test

**Files:**
- Create: `packages/brain/src/__tests__/integration/consciousness-tick-runtime.integration.test.js`

- [ ] **Step 1.1: 先 grep 探测 tick.js 里 import 哪些模块需要 mock**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-e2e-tests
grep "^import .* from '\." packages/brain/src/tick.js | head -70
```

记录：所有相对路径 import（`./rumination.js` / `./planner.js` 等），下一步逐一 mock。

- [ ] **Step 1.2: 写测试文件骨架（先写 describe + mock，跑一次看缺什么）**

Create `packages/brain/src/__tests__/integration/consciousness-tick-runtime.integration.test.js`:

```js
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DB_DEFAULTS } from '../../db-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_240 = path.resolve(__dirname, '../../../migrations/240_consciousness_setting.sql');
const MEMORY_KEY = 'consciousness_enabled';

// ========== 意识模块 mocks（需要断言调用次数）==========
vi.mock('../../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue({ accumulator: 0 }) }));
vi.mock('../../diary-scheduler.js', () => ({ generateDailyDiaryIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../conversation-digest.js', () => ({ runConversationDigest: vi.fn().mockResolvedValue({}) }));
vi.mock('../../capture-digestion.js', () => ({ runCaptureDigestion: vi.fn().mockResolvedValue({}) }));
vi.mock('../../suggestion-cycle.js', () => ({ runSuggestionCycle: vi.fn().mockResolvedValue({}) }));
vi.mock('../../conversation-consolidator.js', () => ({ runConversationConsolidator: vi.fn().mockResolvedValue({}) }));
vi.mock('../../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../self-report-collector.js', () => ({ collectSelfReport: vi.fn().mockResolvedValue({}) }));
vi.mock('../../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn().mockResolvedValue({}),
  synthesizeEvolutionIfNeeded: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../desire/index.js', () => ({ runDesireSystem: vi.fn().mockResolvedValue({}) }));
vi.mock('../../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn().mockResolvedValue({ triggered: 0, skipped: 0, results: [] }) }));

// ========== 其它重依赖 mocks（noop，防副作用）==========
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: false, reason: 'test-skip' }),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
  getActiveProcessCount: vi.fn().mockResolvedValue(0),
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockResolvedValue({ cpu: 50, mem: 50 }),
  probeTaskLiveness: vi.fn(),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 3,
  INTERACTIVE_RESERVE: 1,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));
vi.mock('../../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue({}),
  generateDecision: vi.fn().mockResolvedValue({ action: 'noop' }),
  executeDecision: vi.fn().mockResolvedValue({}),
  splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], unsafe: [] }),
}));
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ decisions: [] }),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: 'mock' }),
}));
vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue({}),
  expireStaleProposals: vi.fn(),
}));

// Import 真实模块（consciousness-guard + executeTick + db）
import { executeTick } from '../../tick.js';
import {
  initConsciousnessGuard,
  setConsciousnessEnabled,
  _resetCacheForTest,
} from '../../consciousness-guard.js';

// Mock 引用
import { runRumination } from '../../rumination.js';
import { generateDailyDiaryIfNeeded } from '../../diary-scheduler.js';
import { runDesireSystem } from '../../desire/index.js';
import { scanEvolutionIfNeeded } from '../../evolution-scanner.js';

const CONSCIOUSNESS_MOCKS = [runRumination, generateDailyDiaryIfNeeded, runDesireSystem, scanEvolutionIfNeeded];

describe('consciousness tick runtime (real executeTick + mocked 意识模块)', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // 清理 memory + 重跑 migration seed
    await pool.query('DELETE FROM working_memory WHERE key = $1', [MEMORY_KEY]);
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
    _resetCacheForTest();
    // 清所有 mock 计数
    CONSCIOUSNESS_MOCKS.forEach((m) => m.mockClear());
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  afterEach(() => {
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  test('memory=true baseline: executeTick triggers at least one consciousness module', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, true);

    await executeTick();

    // 至少一个意识 mock 被调过
    const totalCalls = CONSCIOUSNESS_MOCKS.reduce((sum, m) => sum + m.mock.calls.length, 0);
    expect(totalCalls).toBeGreaterThan(0);
  });

  test('memory=false: executeTick skips all consciousness modules', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, false);

    await executeTick();

    // 所有意识 mock 调用次数 = 0
    for (const m of CONSCIOUSNESS_MOCKS) {
      expect(m).toHaveBeenCalledTimes(0);
    }
  });

  test('env override beats memory: env=false + memory=true → modules skipped', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, true);
    process.env.CONSCIOUSNESS_ENABLED = 'false';

    await executeTick();

    for (const m of CONSCIOUSNESS_MOCKS) {
      expect(m).toHaveBeenCalledTimes(0);
    }
  });
});
```

- [ ] **Step 1.3: 跑测试，补缺失的 mock**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-e2e-tests/packages/brain
npx vitest run src/__tests__/integration/consciousness-tick-runtime.integration.test.js 2>&1 | tail -40
```

如果报 `XXX is not a function` 或 `Cannot find module`，根据错误补 `vi.mock('../../xxx.js', () => ({ funcName: vi.fn() }))`。循环 3-5 次直到 3 tests 全绿。

如果报真数据库错（比如 table 不存在），说明 `executeTick` 访问了其它表。按错误信息加 migration 或 noop-mock 相关模块。

**放弃条件**：如果补 mock 超过 30 个仍跑不通，说明 `executeTick` 耦合过重，**降级为轻量方案**：不调 executeTick，只断言 `isConsciousnessEnabled()` 在各情况下的返回值（写为 Part A-lite）。报告 DONE_WITH_CONCERNS 注明降级。

- [ ] **Step 1.4: 防回归手工验证**

如 Step 1.3 通过，临时把 consciousness-guard.js 里 `isConsciousnessEnabled` 改成 `return true`（强制开）：

```bash
sed -i '' 's|if (process\.env\.CONSCIOUSNESS_ENABLED === .false.) return false;|// DISABLED_FOR_TEST|' packages/brain/src/consciousness-guard.js
npx vitest run src/__tests__/integration/consciousness-tick-runtime.integration.test.js 2>&1 | tail -10
# Expected: test #2 和 #3 爆红（memory=false / env=false 的场景，guard 失效了意识模块仍被调用）
git checkout packages/brain/src/consciousness-guard.js
```

如果 test 没爆红，说明 Part A 没真跑 executeTick 的逻辑，需强化断言。

- [ ] **Step 1.5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-e2e-tests
git add packages/brain/src/__tests__/integration/consciousness-tick-runtime.integration.test.js
git commit -m "$(cat <<'EOF'
test(brain): add consciousness tick runtime integration test

- 3 tests: baseline (memory=true 触发意识) / memory=false (静音) / env override
- 真 executeTick + mock 20+ 重依赖（意识模块 + executor + planner + decision + thalamus）
- 防回归：把 isConsciousnessEnabled 改成永返 true 时 test #2/#3 爆红

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: HTTP E2E integration test (supertest makeApp)

**Files:**
- Create: `packages/brain/src/__tests__/integration/consciousness-toggle-e2e.integration.test.js`

- [ ] **Step 2.1: 参考现有 makeApp pattern**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-e2e-tests
head -60 packages/brain/src/__tests__/integration/critical-routes.integration.test.js
```

记录：`makeApp()` 怎么构造、怎么挂 routes、supertest 调用风格。

- [ ] **Step 2.2: 写 E2E test**

Create `packages/brain/src/__tests__/integration/consciousness-toggle-e2e.integration.test.js`:

```js
import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  initConsciousnessGuard,
  isConsciousnessEnabled,
  _resetCacheForTest,
} from '../../consciousness-guard.js';
import settingsRoutes from '../../routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_240 = path.resolve(__dirname, '../../../migrations/240_consciousness_setting.sql');
const MEMORY_KEY = 'consciousness_enabled';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/settings', settingsRoutes);
  return app;
}

describe('consciousness toggle HTTP E2E (supertest + real PG)', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM working_memory WHERE key = $1', [MEMORY_KEY]);
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
    _resetCacheForTest();
    await initConsciousnessGuard(pool);
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  afterEach(() => {
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  test('full HTTP chain: GET → PATCH → GET persists + cache updates + DB落盘', async () => {
    const app = makeApp();

    // 1. 初始 GET 应该是 enabled=true（migration seed）
    const r1 = await request(app).get('/api/brain/settings/consciousness');
    expect(r1.status).toBe(200);
    expect(r1.body.enabled).toBe(true);
    expect(r1.body.env_override).toBe(false);

    // 2. PATCH 切到 false
    const r2 = await request(app)
      .patch('/api/brain/settings/consciousness')
      .send({ enabled: false });
    expect(r2.status).toBe(200);
    expect(r2.body.enabled).toBe(false);
    expect(r2.body.last_toggled_at).toBeTruthy();
    const toggledAt = r2.body.last_toggled_at;

    // 3. 再 GET 验证持久化（last_toggled_at 一致）
    const r3 = await request(app).get('/api/brain/settings/consciousness');
    expect(r3.body.enabled).toBe(false);
    expect(r3.body.last_toggled_at).toBe(toggledAt);

    // 4. DB 落盘验证
    const db = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    expect(db.rows[0].value_json.enabled).toBe(false);
    expect(db.rows[0].value_json.last_toggled_at).toBe(toggledAt);

    // 5. cache write-through：直接调 isConsciousnessEnabled() 也是 false
    expect(isConsciousnessEnabled()).toBe(false);

    // 6. PATCH 回 true 验证 toggle 对称
    const r4 = await request(app)
      .patch('/api/brain/settings/consciousness')
      .send({ enabled: true });
    expect(r4.body.enabled).toBe(true);
    expect(isConsciousnessEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2.3: 跑测试**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-e2e-tests/packages/brain
npx vitest run src/__tests__/integration/consciousness-toggle-e2e.integration.test.js 2>&1 | tail -15
```

Expected: 1 test passed（6 个链路断言全部生效）。

如 supertest 没装：`cd packages/brain && npm install --save-dev supertest`（PR #2464 时已装，应该已有）。

- [ ] **Step 2.4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-e2e-tests
git add packages/brain/src/__tests__/integration/consciousness-toggle-e2e.integration.test.js
git commit -m "$(cat <<'EOF'
test(brain): add consciousness toggle HTTP E2E integration

- 1 test 串起 GET → PATCH → GET 链路 + DB 持久化 + cache write-through + toggle 对称
- supertest + makeApp 范式（不装 Playwright，降级方案）
- 与 PR #2464 的 integration test 互补：#2464 验证 API 内部；本 test 验证外部 HTTP 链路

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- [x] Spec Part A (tick runtime 3 tests) → Task 1 ✓
- [x] Spec Part B (E2E 1 test + 6 链路断言) → Task 2 ✓
- [x] Spec "mock 重依赖不真跑 LLM" → Task 1 Step 1.2 全面 mock 列表 ✓
- [x] Spec "supertest makeApp 不装 Playwright" → Task 2 ✓
- [x] Spec "放弃条件"降级 → Task 1 Step 1.3 注明 ✓
- [x] Spec "防回归验证" → Task 1 Step 1.4 ✓
- [x] 两文件都在 `integration/` 目录 CI 自动扫 ✓
- [x] 无 placeholder，所有代码完整

---

Plan 完成。进 subagent-driven-development。
