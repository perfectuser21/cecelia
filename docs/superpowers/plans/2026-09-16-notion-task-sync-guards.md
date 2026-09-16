# Notion 双向同步链守卫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已自愈的 Notion 双向同步链补两个 CI 回归守卫，防止调度器再次静默孤儿化 / pull 被重构摘除。

**Architecture:** 不改任何生产行为。扩充既有 vitest 测试文件 `packages/brain/src/__tests__/legacy-notion-push-scheduler.test.js`：T1 源码文本断言 server.js 接线；T2 vi.mock 行为断言默认 run 并联 push+pull。守卫对现状为绿，故用 mutation 验红（proven-to-fire）代替常规 failing-test 首 commit。

**Tech Stack:** vitest（vi.mock ESM 模块工厂）、node:fs 源码断言。

**背景速览（执行者零上下文需知）:** `packages/brain/server.js:969` 动态 `import('./src/legacy-notion-push-scheduler.js')` 并调用 `scheduleLegacyNotionPush(pool)`；该 scheduler 默认参数 `run = runPushAndPull`，`runPushAndPull` 顺序 await `runNotionPushSync(pool)` 与 `runNotionTaskPull(pool)`（均 import 自 `./notion-push-sync.js`）。历史事故：调度入口被重构孤儿化导致同步静默停摆（2026-09-08 ops 四库、2026-09-16 本任务误诊）。

---

### Task 1: T1 接线守卫（server.js 必须调用 scheduleLegacyNotionPush）

**Files:**
- Modify: `packages/brain/src/__tests__/legacy-notion-push-scheduler.test.js`

- [ ] **Step 1: 在测试文件追加 T1 测试**

在现有 `describe('legacy Notion push scheduler', ...)` 内追加（文件顶部补 `import { readFileSync } from 'node:fs';`）：

```js
  it('server.js 必须接线 scheduleLegacyNotionPush——调度入口孤儿化即红（2026-09-08/09-16 先例）', () => {
    const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(src).toContain("import('./src/legacy-notion-push-scheduler.js')");
    expect(src).toMatch(/scheduleLegacyNotionPush\(pool\)/);
  });
```

- [ ] **Step 2: 跑测试确认现状为绿**

Run: `cd packages/brain && npx vitest run src/__tests__/legacy-notion-push-scheduler.test.js`
Expected: 全部 PASS（守卫对现状是绿的，红的证明在下一步 mutation）

- [ ] **Step 3: mutation 验红（proven-to-fire）**

```bash
cd packages/brain
sed -i '' 's/scheduleLegacyNotionPush(pool);/\/\* MUTATION \*\//' server.js
npx vitest run src/__tests__/legacy-notion-push-scheduler.test.js
```

Expected: T1 FAIL（`scheduleLegacyNotionPush\(pool\)` 断言不匹配）。

- [ ] **Step 4: 恢复 mutation，确认回绿**

```bash
git checkout -- packages/brain/server.js
cd packages/brain && npx vitest run src/__tests__/legacy-notion-push-scheduler.test.js
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/__tests__/legacy-notion-push-scheduler.test.js
git commit -m "test(brain): 守卫——server.js 必须接线 scheduleLegacyNotionPush（防调度孤儿化）"
```

---

### Task 2: T2 默认并联守卫（默认 run 必须同时跑 push 与 pull）

**Files:**
- Modify: `packages/brain/src/__tests__/legacy-notion-push-scheduler.test.js`

- [ ] **Step 1: 追加 vi.mock 与 T2 测试**

文件顶部（import 区）追加：

```js
import { runNotionPushSync, runNotionTaskPull } from '../notion-push-sync.js';

vi.mock('../notion-push-sync.js', () => ({
  runNotionPushSync: vi.fn().mockResolvedValue(undefined),
  runNotionTaskPull: vi.fn().mockResolvedValue(undefined),
}));
```

describe 内追加：

```js
  it('默认 run 并联 push 与 pull——pull 被摘出默认链即红（2026-09-14 并联拍板）', async () => {
    const pool = { query: vi.fn() };
    const setIntervalFn = vi.fn(() => ({ unref: vi.fn() }));
    const logger = { log: vi.fn(), warn: vi.fn() };

    scheduleLegacyNotionPush(pool, {
      env: { NOTION_LEGACY_PUSH_ENABLED: 'true' },
      setIntervalFn,
      logger,
      // 故意不注入 run：守卫默认值 runPushAndPull
    });
    await setIntervalFn.mock.calls[0][0]();
    expect(runNotionPushSync).toHaveBeenCalledWith(pool);
    expect(runNotionTaskPull).toHaveBeenCalledWith(pool);
  });
```

- [ ] **Step 2: 跑测试确认现状为绿**

Run: `cd packages/brain && npx vitest run src/__tests__/legacy-notion-push-scheduler.test.js`
Expected: 全部 PASS（含既有 1 个 it）。

- [ ] **Step 3: mutation 验红（proven-to-fire）**

```bash
cd packages/brain
sed -i '' 's/^  await runNotionTaskPull(pool);$/  \/\* MUTATION \*\//' src/legacy-notion-push-scheduler.js
npx vitest run src/__tests__/legacy-notion-push-scheduler.test.js
```

Expected: T2 FAIL（`runNotionTaskPull` 未被调用）。

- [ ] **Step 4: 恢复 mutation，确认回绿**

```bash
git checkout -- packages/brain/src/legacy-notion-push-scheduler.js
cd packages/brain && npx vitest run src/__tests__/legacy-notion-push-scheduler.test.js
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/__tests__/legacy-notion-push-scheduler.test.js
git commit -m "test(brain): 守卫——默认 run 必须并联 runNotionPushSync+runNotionTaskPull"
```

---

### Task 3: DevGate + 收尾验证

**Files:** 无新改动（验证步骤）

- [ ] **Step 1: DevGate 三连（repo 规矩：涉 brain 变更必过）**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```

Expected: 三个全部通过（本 PR 只增测试文件，不动事实源）。

- [ ] **Step 2: 全量 brain 测试**

```bash
cd packages/brain && npm test
```

Expected: 全绿（或既有与本 PR 无关的失败保持基线一致——若有失败先比对 origin/main 基线确认非本 PR 引入）。

- [ ] **Step 3: 确认工作区干净**

Run: `git status -s`
Expected: 无未提交改动（spec/plan 文档已各自 commit）。
