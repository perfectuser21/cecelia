# DBOS Durable 底座（第一步）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 DBOS 作为 brain durable 底座引入，flag 门控（默认关=行为零变化），把 daily-report 包成崩溃可恢复的 durable workflow。

**Architecture:** 新增 `dbos-runtime.js`（DBOS 生命周期，env 门控）+ `daily-report-durable.js`（复用 daily-report 既有 step 函数包成 DBOS workflow）；`server.js`/`tick-runner.js` 两处 flag 门控接线（initDurable 必 try/catch degrade）。DBOS 系统表落 cecelia 库的 `dbos` schema，不碰 149 业务表。

**Tech Stack:** Node ESM, `@dbos-inc/dbos-sdk` 4.x, Postgres, vitest。

---

## 文件结构
- Create: `packages/brain/src/durable/dbos-runtime.js` — DBOS 生命周期（isDurableEnabled/initDurable/shutdownDurable）
- Create: `packages/brain/src/durable/daily-report-durable.js` — durable 版日报 workflow
- Create: `packages/brain/src/durable/__tests__/dbos-runtime.test.js` — 门控单测
- Create: `packages/brain/src/durable/__tests__/daily-report-durable.test.js` — 崩溃恢复 + exactly-once
- Modify: `packages/brain/package.json` — 加依赖
- Modify: `packages/brain/src/daily-report-generator.js` — 导出既有 step 函数（复用，零重写）
- Modify: `packages/brain/server.js` — boot 序列加 try/catch initDurable
- Modify: `packages/brain/src/tick-runner.js:1633` — flag 门控路由

---

### Task 1: 加 DBOS 依赖

**Files:** Modify `packages/brain/package.json`

- [ ] **Step 1:** 在 dependencies 加 `"@dbos-inc/dbos-sdk": "^4.20.0"`（紧挨现有 `"pg"` 行）
- [ ] **Step 2:** 在 worktree 跑 `cd packages/brain && npm install @dbos-inc/dbos-sdk` 验证装上
- [ ] **Step 3:** Commit `chore(brain): 加 @dbos-inc/dbos-sdk 依赖`

---

### Task 2: 重构 daily-report-generator.js 导出 step 函数（复用基础）

**Files:** Modify `packages/brain/src/daily-report-generator.js`；Test `packages/brain/src/__tests__/daily-report-generator.test.js`

- [ ] **Step 1（先跑回归基线）:** `cd packages/brain && npx vitest run src/__tests__/daily-report-generator.test.js` → 记录当前 PASS（这是回归锚）
- [ ] **Step 2:** 给以下私有函数加 `export`（仅加关键字，逻辑一字不改）：`hasTodayReport`、`markTodayDone`、`fetchYesterdayContentOutput`、`fetchYesterdayPublishStats`、`fetchYesterdayEngagementData`、`fetchYesterdayFailureCount`、`buildReportText`、`saveReportToWorkingMemory`、`getYesterdayString`
- [ ] **Step 3:** 重跑 Step 1 命令 → 仍全 PASS（行为零变化）
- [ ] **Step 4:** Commit `refactor(brain): daily-report 导出 step 函数供 durable 复用（逻辑不变）`

---

### Task 3: dbos-runtime.js（DBOS 生命周期 + 门控）

**Files:** Create `packages/brain/src/durable/dbos-runtime.js` + `__tests__/dbos-runtime.test.js`

- [ ] **Step 1: 写失败测试** `packages/brain/src/durable/__tests__/dbos-runtime.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { isDurableEnabled } from '../dbos-runtime.js';

describe('dbos-runtime 门控', () => {
  it('默认（无 env）返回 false', () => {
    delete process.env.DBOS_DURABLE_ENABLED;
    expect(isDurableEnabled()).toBe(false);
  });
  it('DBOS_DURABLE_ENABLED=true 才 true', () => {
    process.env.DBOS_DURABLE_ENABLED = 'true';
    expect(isDurableEnabled()).toBe(true);
    process.env.DBOS_DURABLE_ENABLED = 'false';
    expect(isDurableEnabled()).toBe(false);
    delete process.env.DBOS_DURABLE_ENABLED;
  });
});
```
- [ ] **Step 2:** 跑 `npx vitest run src/durable/__tests__/dbos-runtime.test.js` → FAIL（模块不存在）
- [ ] **Step 3: 实现** `packages/brain/src/durable/dbos-runtime.js`:
```js
import { DBOS } from '@dbos-inc/dbos-sdk';
import pg from 'pg';

let _launched = false;

export function isDurableEnabled() {
  return process.env.DBOS_DURABLE_ENABLED === 'true';
}

function ceceliaUrl() {
  return process.env.DATABASE_URL
    || `postgresql://${process.env.DB_USER||'cecelia'}:${process.env.DB_PASSWORD||'cecelia'}@${process.env.DB_HOST||'host.docker.internal'}:${process.env.DB_PORT||5432}/${process.env.DB_NAME||'cecelia'}`;
}

// 仅当 enabled 调用。失败 throw，由 caller try/catch degrade。
export async function initDurable() {
  if (_launched) return;
  const url = ceceliaUrl();
  const sysPool = new pg.Pool({ connectionString: url, max: 5 });
  DBOS.setConfig({
    name: 'cecelia-brain',
    systemDatabaseUrl: url,
    systemDatabaseSchemaName: 'dbos',
    systemDatabasePool: sysPool,
    systemDatabasePoolSize: 5,
  });
  await DBOS.launch();
  _launched = true;
}

export async function shutdownDurable() {
  if (!_launched) return;
  await DBOS.shutdown();
  _launched = false;
}
```
- [ ] **Step 4:** 重跑 Step 2 命令 → PASS
- [ ] **Step 5:** Commit `feat(brain): dbos-runtime 生命周期模块（env 门控，默认关）`

---

### Task 4: daily-report-durable.js（durable workflow + 崩溃恢复测试）

**Files:** Create `packages/brain/src/durable/daily-report-durable.js` + `__tests__/daily-report-durable.test.js`

> 实现要点：复用 Task 2 导出的 step 函数，各包一层 `DBOS.registerStep`，组合成 `DBOS.registerWorkflow`。workflow 内部用注入的 pool。崩溃恢复测试需真 Postgres（测试库），断言 ① step 不重跑 ② sendFeishu 恰好一次。sendFeishu 在测试中 mock 成计数器。

- [ ] **Step 1: 写失败测试** `__tests__/daily-report-durable.test.js`（崩溃→recover→exactly-once；用测试库 + dbos schema；参照已验证 spike `/tmp/cecelia-orchestrator-spike/daily-report-durable.ts` 的断言形态：step_trace 计数 + feishu_sends 计数=1）。测试若依赖真 DB，用 `describe.skipIf(!process.env.TEST_PG)` 守卫，保证 CI 无 DB 时不挂、有 DB 时验真。
- [ ] **Step 2:** 跑测试 → FAIL（模块不存在）
- [ ] **Step 3: 实现** `daily-report-durable.js`：import Task2 的 step 函数 + DBOS，registerStep 包每步，registerWorkflow 组合，导出 `durableDailyReport(pool)`。生成步用 `buildReportText`，存库用 `saveReportToWorkingMemory`，发飞书复用现有 sendFeishu。
- [ ] **Step 4:** 跑测试（带 TEST_PG 指向测试库）→ PASS（step1-N 不重跑、飞书=1）
- [ ] **Step 5:** Commit `feat(brain): daily-report durable workflow（崩溃可恢复，复用既有 step）`

---

### Task 5: server.js 接线（try/catch degrade）

**Files:** Modify `packages/brain/server.js`

- [ ] **Step 1:** 在 boot 序列、`listenWithRetry`/`server.listen` **之前**，加：
```js
import { isDurableEnabled, initDurable } from './src/durable/dbos-runtime.js';
// ...boot 序列内（listen 之前）：
try {
  if (isDurableEnabled()) { await initDurable(); console.log('[startup] DBOS durable 已启动'); }
} catch (e) {
  console.error('[startup] DBOS initDurable 失败，degrade 到非 durable：', e.message);
}
```
- [ ] **Step 2:** flag 关启动验证：`DBOS_DURABLE_ENABLED` 未设时 `node -e "import('./server.js')"` 不应有 DBOS 初始化日志、不报错（手动 smoke 或现有启动测试覆盖）
- [ ] **Step 3:** Commit `feat(brain): server boot 接 DBOS（flag门控+try/catch degrade）`

---

### Task 6: tick-runner.js 路由（flag 门控）

**Files:** Modify `packages/brain/src/tick-runner.js:1633`

- [ ] **Step 1:** 把 `Promise.resolve().then(() => generateDailyReport(pool))` 改为门控路由：
```js
Promise.resolve().then(async () => {
  const { isDurableEnabled } = await import('./durable/dbos-runtime.js');
  if (isDurableEnabled()) {
    const { durableDailyReport } = await import('./durable/daily-report-durable.js');
    return durableDailyReport(pool);
  }
  return generateDailyReport(pool);
}).catch(e => console.warn('[tick] 每日内容日报失败:', e.message));
```
- [ ] **Step 2:** flag 关回归：`npx vitest run src/__tests__/daily-report-generator.test.js` + tick 相关测试 → 全 PASS（走原路径）
- [ ] **Step 3:** Commit `feat(brain): tick 日报 flag门控路由（关=原路径，开=durable）`

---

### Task 7: 全量回归 + DoD 勾选

- [ ] **Step 1:** `cd packages/brain && npx vitest run`（或 CI 等价）→ 全绿（flag 关，行为零变化）
- [ ] **Step 2:** facts-check + version-sync（如 brain DevGate 要求）：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`
- [ ] **Step 3:** 勾选 spec 验收标准 4 条，Commit `test(brain): DBOS durable 第一步全量回归绿`
