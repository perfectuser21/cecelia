# muted toggle 测试补强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两个测试文件——LiveMonitor toggle 静态 grep + muted HTTP E2E integration（照抄 consciousness 版改名），补齐 CI 防线。

**Architecture:** 纯新建两个测试文件，复用现有 workspace-test + brain-integration CI job。不改生产代码。

**Tech Stack:** vitest + supertest + pg

---

## File Structure

| 文件 | 动作 |
|---|---|
| `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx` | Create（~40 行 grep 级）|
| `packages/brain/src/__tests__/integration/muted-toggle-e2e.integration.test.js` | Create（~100 行，照抄 consciousness 版）|

---

## Task 1: LiveMonitor 静态 grep 测试

**Files:**
- Create: `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx`

- [ ] **Step 1.1: 创建测试文件**

完整内容（照抄）：

```tsx
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * LiveMonitorPage.test.tsx — grep 级回归防线
 *
 * 不渲染整个 LiveMonitorPage（1700+ 行，mock 成本高）。
 * 用 fs readFileSync + regex 检查 muted toggle 关键行为锚点，
 * 防止"有人误删/重构 toggle 逻辑"这类回归。
 *
 * 不挡"逻辑错误"，只挡"代码被删"。深度验证走 SettingsPage.test.tsx
 * （组件级）+ muted-toggle-e2e.integration.test.js（HTTP 级）。
 */
describe('LiveMonitorPage muted toggle — 静态锚点检查', () => {
  const SRC = readFileSync(
    resolve(__dirname, 'LiveMonitorPage.tsx'),
    'utf8'
  );

  it('含 GET /api/brain/settings/muted（初始加载）', () => {
    expect(SRC).toMatch(/fetch\(['"]\/api\/brain\/settings\/muted['"]\)/);
  });

  it('含 PATCH /api/brain/settings/muted（点击切换）', () => {
    expect(SRC).toMatch(/method:\s*['"]PATCH['"]/);
    expect(SRC).toMatch(/['"]\/api\/brain\/settings\/muted['"][\s\S]*?PATCH|PATCH[\s\S]*?['"]\/api\/brain\/settings\/muted['"]/);
  });

  it('env_override 时 button disabled', () => {
    expect(SRC).toMatch(/env_override/);
    expect(SRC).toMatch(/disabled[\s\S]*?env_override|env_override[\s\S]*?disabled/);
  });

  it("两个 UI 状态文案 '飞书: 静默中' 和 '飞书: 发送中'", () => {
    expect(SRC).toContain('飞书: 静默中');
    expect(SRC).toContain('飞书: 发送中');
  });

  it('PATCH body 含 JSON.stringify({enabled: ...})', () => {
    expect(SRC).toMatch(/JSON\.stringify\(\s*\{\s*enabled:/);
  });
});
```

- [ ] **Step 1.2: 跑测试确认绿**

```bash
cd /Users/administrator/worktrees/cecelia/muted-test-coverage/apps/dashboard
npx vitest run src/pages/live-monitor/LiveMonitorPage.test.tsx --no-coverage 2>&1 | tail -8
```

**预期**：5 passed。

**若某条 red**：
- 说明 LiveMonitor 的 muted 逻辑不符合锚点（可能被改过）。此时**不改测试**，先确认 LiveMonitor 是不是真坏了（读 L1234 / L1244 / L1527 附近）。若是生产代码坏了 → 修代码；若是锚点过严 → 放宽 regex 但保留意图。

- [ ] **Step 1.3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/muted-test-coverage
git add apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx
git commit -m "test(dashboard)[CONFIG]: LiveMonitorPage muted toggle 静态 grep 回归

5 个锚点防 LiveMonitor 快捷 toggle 被误删/重构：
- GET /api/brain/settings/muted 加载
- PATCH /api/brain/settings/muted 切换
- env_override 时 disabled
- 文案 '飞书: 静默中' / '飞书: 发送中'
- JSON.stringify body

不渲染整页（1700 行 mock 成本高），grep 级够挡代码被删。深度验证由
SettingsPage.test.tsx 和 muted-toggle-e2e.integration.test.js 负责。
进 workspace-test CI job 自动跑。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: muted HTTP E2E integration test

**Files:**
- Create: `packages/brain/src/__tests__/integration/muted-toggle-e2e.integration.test.js`

**参考**：`packages/brain/src/__tests__/integration/consciousness-toggle-e2e.integration.test.js`（100 行完整模板，已验证在 brain-integration CI job 绿）

- [ ] **Step 2.1: 创建测试文件**

完整内容（照抄 consciousness 版改名）：

```javascript
/**
 * Muted Toggle HTTP E2E Integration Test
 *
 * 用 supertest + Express app 挂载真实 settings 路由 + 真 PG 做端到端链路：
 *   GET → PATCH → GET → 断言 DB 持久化 + guard cache write-through + toggle 对称。
 * 照抄 consciousness-toggle-e2e.integration.test.js，改名为 muted 版。
 *
 * 挡：API 路由挂、initMutedGuard 初始化断、notifier gate 反逻辑等真实故障。
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  initMutedGuard,
  isMuted,
  _resetCacheForTest,
} from '../../muted-guard.js';
import settingsRoutes from '../../routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_242 = path.resolve(__dirname, '../../../migrations/242_brain_muted_setting.sql');
const MEMORY_KEY = 'brain_muted';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/settings', settingsRoutes);
  return app;
}

describe('muted toggle HTTP E2E (supertest + real PG)', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
    const sql = fs.readFileSync(MIGRATION_242, 'utf8');
    await pool.query(sql);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM working_memory WHERE key = $1', [MEMORY_KEY]);
    const sql = fs.readFileSync(MIGRATION_242, 'utf8');
    await pool.query(sql);
    _resetCacheForTest();
    await initMutedGuard(pool);
    delete process.env.BRAIN_MUTED;
  });

  afterEach(() => {
    delete process.env.BRAIN_MUTED;
  });

  test('full HTTP chain: GET → PATCH → GET persists + cache + DB', async () => {
    const app = makeApp();

    // GET 默认状态（enabled=false, env_override=false）
    const r1 = await request(app).get('/api/brain/settings/muted');
    expect(r1.status).toBe(200);
    expect(r1.body.enabled).toBe(false);
    expect(r1.body.env_override).toBe(false);

    // PATCH enabled=true
    const r2 = await request(app)
      .patch('/api/brain/settings/muted')
      .send({ enabled: true });
    expect(r2.status).toBe(200);
    expect(r2.body.enabled).toBe(true);
    expect(r2.body.last_toggled_at).toBeTruthy();
    const toggledAt = r2.body.last_toggled_at;

    // GET 持久化 + 同 last_toggled_at
    const r3 = await request(app).get('/api/brain/settings/muted');
    expect(r3.body.enabled).toBe(true);
    expect(r3.body.last_toggled_at).toBe(toggledAt);

    // DB working_memory 真写入
    const db = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    expect(db.rows[0].value_json.enabled).toBe(true);
    expect(db.rows[0].value_json.last_toggled_at).toBe(toggledAt);

    // guard cache write-through
    expect(isMuted()).toBe(true);

    // PATCH enabled=false（对称）
    const r4 = await request(app)
      .patch('/api/brain/settings/muted')
      .send({ enabled: false });
    expect(r4.body.enabled).toBe(false);
    expect(isMuted()).toBe(false);
  });
});
```

- [ ] **Step 2.2: 本地跑（需要 postgres 跑着）**

```bash
cd /Users/administrator/worktrees/cecelia/muted-test-coverage/packages/brain
npx vitest run src/__tests__/integration/muted-toggle-e2e.integration.test.js --no-coverage 2>&1 | tail -10
```

**预期**：1 passed。

**若 DB 连接错**：参考 consciousness-toggle-e2e 怎么本地跑（它已验证能跑）。DB_DEFAULTS 从 `db-config.js` 读默认，本地 `cecelia` DB 应该连得上。如果本地连 `cecelia_test` 失败，可以只靠 CI 上跑（brain-integration job 有 postgres service）。

- [ ] **Step 2.3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/muted-test-coverage
git add packages/brain/src/__tests__/integration/muted-toggle-e2e.integration.test.js
git commit -m "test(brain)[CONFIG]: muted toggle HTTP E2E integration（supertest + 真 pg）

照抄 consciousness-toggle-e2e.integration.test.js 改名为 muted 版：
- supertest 真起 Express + settings routes
- 真 pg pool + 真跑 migration 242
- GET → PATCH → GET → 断言 DB 持久化 + cache write-through + toggle 对称

挡：API 路由挂、initMutedGuard 初始化断、notifier gate 反逻辑等真实故障
（单元测试的 mock fetch / mock pool 挡不住的层）。

进 brain-integration CI job 自动跑（现有配置 include src/__tests__/integration/）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: DoD + Learning（精简）

**Files:**
- Create: `.dod`
- Create: `docs/learnings/cp-0422094645-muted-test-coverage.md`

- [ ] **Step 3.1: 写 .dod + Learning（bash heredoc）**

```bash
cd /Users/administrator/worktrees/cecelia/muted-test-coverage
cat > .dod <<'DOD_EOF'
# DoD — muted test coverage

- [x] [ARTIFACT] LiveMonitorPage.test.tsx 新文件含 5 锚点
      Test: manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx','utf8');const m=(c.match(/\\bit\\(/g)||[]).length;if(m<5)process.exit(1);console.log('锚点数='+m)"
- [x] [ARTIFACT] muted-toggle-e2e.integration.test.js 新文件
      Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/muted-toggle-e2e.integration.test.js')"
- [x] [BEHAVIOR] LiveMonitorPage.test.tsx 本地跑绿
      Test: tests/dashboard/LiveMonitorPage.test.tsx
- [x] [BEHAVIOR] muted-toggle-e2e integration 本地跑绿（需 pg）
      Test: tests/brain/integration/muted-toggle-e2e.integration.test.js
- [x] [ARTIFACT] 设计文档 + Learning 已提交
      Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-muted-test-coverage-design.md');require('fs').accessSync('docs/learnings/cp-0422094645-muted-test-coverage.md')"
DOD_EOF

mkdir -p docs/learnings
cat > docs/learnings/cp-0422094645-muted-test-coverage.md <<'LEARN_EOF'
# Learning — muted toggle 测试补强

分支：cp-0422094645-muted-test-coverage
日期：2026-04-22
Task：3c359029-059a-4b3a-b858-e7ddbad23da4

## 背景

Alex 问："这两个开关有没有写进 E2E test？有没有进 CI？别他妈到时候又坏了。"

实况盘点后发现两个缺口：
- LiveMonitor 的 muted toggle（#2511 加的）**无测试**
- 无真 pg + 真 HTTP 的 muted E2E（所有测试都 mock fetch / mock pool）

## 本次解法

### A. LiveMonitor 静态 grep 测试
不渲染整页（1700+ 行 mock 成本高）。fs.readFileSync + regex 检查 5 个
关键锚点（GET / PATCH / env_override disabled / 文案 / body）。
薄防线，挡"代码被删"不挡"逻辑错"。深度验证由其他层覆盖。

### B. muted HTTP E2E integration test
照抄 consciousness-toggle-e2e.integration.test.js 改名 muted 版。
supertest 真起 Express + 真 pg pool + 真跑 migration 242。
验证 GET → PATCH → GET → DB 持久化 + cache write-through + toggle 对称。

### 复用而非复造
consciousness-toggle-e2e 已跑在 brain-integration CI job 绿，直接照抄
改名是最快路径。这是本项目的"谁是第一"（consciousness）+"后来加的都照抄"
（muted）工作模式的延续。

## 下次预防

- [ ] 每个"用户可操作开关"必须有三层测试：unit（guard）+ 组件（UI）+
      integration（真 HTTP）。缺哪层哪层都可能漏
- [ ] 1000+ 行大组件加新交互时，先考虑提取子组件（方便单测）；不提取
      至少做 grep 级锚点回归（防止新逻辑被误删）
- [ ] 新开关复用现成模板（consciousness-guard + consciousness-toggle-e2e），
      不要从零写

## 关键 PR

- 本 PR（待合并）: muted 测试补强
- 前置: #2511（runtime BRAIN_MUTED + LiveMonitor UI）/ #2513（SettingsPage）
LEARN_EOF
ls .dod docs/learnings/cp-0422094645-muted-test-coverage.md
```

- [ ] **Step 3.2: 全量 DoD 验证**

```bash
cd /Users/administrator/worktrees/cecelia/muted-test-coverage && \
  node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx','utf8');const m=(c.match(/\\bit\\(/g)||[]).length;if(m<5)process.exit(1);console.log('anchors='+m)" && \
  node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/muted-toggle-e2e.integration.test.js');console.log('e2e OK')" && \
  node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-muted-test-coverage-design.md');require('fs').accessSync('docs/learnings/cp-0422094645-muted-test-coverage.md');console.log('docs OK')" && \
  cd apps/dashboard && \
  npx vitest run src/pages/live-monitor/LiveMonitorPage.test.tsx --no-coverage 2>&1 | tail -5
```

**预期**：3 OK + LiveMonitor 5 passed。

**integration test 本地可选跑**（需要 pg 连上）；CI 上 brain-integration job 会真跑。

- [ ] **Step 3.3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/muted-test-coverage
git add .dod docs/learnings/cp-0422094645-muted-test-coverage.md
git commit -m "docs[CONFIG]: DoD + Learning for muted test coverage

5 条 DoD 全勾选。Learning 记录 3 层测试缺谁都漏 + 大组件提子组件或
grep 锚点的预防规则 + 复用现成模板的工作模式。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- [x] **Spec 覆盖**：A 静态 grep（T1）+ B 真 HTTP E2E（T2）+ docs（T3）
- [x] **Placeholder 扫描**：无 TBD；所有代码完整
- [x] **Type 一致性**：`MEMORY_KEY='brain_muted'` / `isMuted()` / `initMutedGuard` / `MIGRATION_242` 全文一致
- [x] **CI 集成**：T1 → workspace-test 自动扫描，T2 → brain-integration 自动 include integration/
- [x] **Learning 规则**：per-branch 文件名 + 根本原因 + 下次预防 checklist
