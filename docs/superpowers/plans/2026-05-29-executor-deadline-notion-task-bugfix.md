# Executor Deadline + Notion Task Bug Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复两个 Harness Pipeline 回归 bug：(1) watchdog 在 deadline 过期时错误触发 60s 倒计时；(2) `/notion/task` 因 AI Notes DB 无 Status property 返回 502。

**Architecture:** TDD 两段式 commit —— 每个 bug 先提交 failing test（commit-1），再提交实现让 test 变绿（commit-2）。Bug 1 通过提取纯函数 `computeDeadlineMs` 使逻辑可单元测试；Bug 2 通过从 Notion properties payload 移除 `Status`、改写入 page children 修复 400。

**Tech Stack:** Node.js ESM, Vitest, supertest, executor.js (LangGraph 路由层), routes/notes.js (Express), notionReq (Notion REST client)

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| Create | `packages/brain/src/__tests__/executor-deadline.test.js` | Bug 1 回归测试 |
| Modify | `packages/brain/src/executor.js` (第 2880-2883 行) | 提取并修复 `computeDeadlineMs` |
| Create | `packages/brain/src/__tests__/routes/notes-notion-task.test.js` | Bug 2 回归测试 |
| Modify | `packages/brain/src/routes/notes.js` (第 117 行) | 移除 Status property，写入 children |

---

## Task 1：Bug 1 Failing Test — computeDeadlineMs 回归测试

**Files:**
- Create: `packages/brain/src/__tests__/executor-deadline.test.js`

- [ ] **Step 1: 写 failing test**

```javascript
/**
 * Regression test: executor.js watchdog deadline 计算
 *
 * Bug: Math.max(60_000, negative) = 60_000 当 deadline 已过期
 * Fix: 过期或 null deadline → 6h fallback，未过期 → 剩余 ms
 */
import { describe, it, expect } from 'vitest';
import { computeDeadlineMs } from '../executor.js';

const SIX_HOURS_MS = 6 * 3600 * 1000;

describe('computeDeadlineMs', () => {
  it('null deadlineAt → 6h fallback', () => {
    expect(computeDeadlineMs(null)).toBe(SIX_HOURS_MS);
  });

  it('undefined deadlineAt → 6h fallback', () => {
    expect(computeDeadlineMs(undefined)).toBe(SIX_HOURS_MS);
  });

  it('过期的 deadlineAt → 6h fallback（Bug 1 回归）', () => {
    const pastDate = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 分钟前
    const result = computeDeadlineMs(pastDate);
    // Bug: Math.max(60_000, negative) = 60_000；Fix: 应返回 6h
    expect(result).toBe(SIX_HOURS_MS);
    // 确保不是 60_000（这是 bug 的表现）
    expect(result).not.toBe(60_000);
  });

  it('未来的 deadlineAt → 剩余 ms（正数，小于 6h）', () => {
    const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // 2h 后
    const result = computeDeadlineMs(futureDate);
    // 应在 [1h55m, 2h5m] 范围内（允许测试执行延迟）
    expect(result).toBeGreaterThan(1 * 3600 * 1000);
    expect(result).toBeLessThan(SIX_HOURS_MS);
  });

  it('deadline 恰好现在（边界）→ 6h fallback', () => {
    const nowish = new Date(Date.now() - 1).toISOString(); // 刚过期 1ms
    expect(computeDeadlineMs(nowish)).toBe(SIX_HOURS_MS);
  });
});
```

- [ ] **Step 2: 确认 test 报 import 错误（computeDeadlineMs 未导出）**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix/packages/brain
npx vitest run src/__tests__/executor-deadline.test.js 2>&1 | tail -20
```

期望输出含：`SyntaxError: The requested module '../executor.js' does not provide an export named 'computeDeadlineMs'` 或类似导入错误。

- [ ] **Step 3: commit-1（failing test）**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix
git add packages/brain/src/__tests__/executor-deadline.test.js
git commit -m "test(brain): failing regression — computeDeadlineMs 过期 deadline 返 6h 而非 60s"
```

---

## Task 2：Bug 1 Implementation — 提取并修复 computeDeadlineMs

**Files:**
- Modify: `packages/brain/src/executor.js` (第 2880-2883 行附近)

- [ ] **Step 1: 在 executor.js 中提取并导出 computeDeadlineMs 纯函数**

在 executor.js 文件顶部（`import` 块之后，第一个 `function` 或 `const` 之前）添加：

```javascript
/**
 * 计算 watchdog deadline 毫秒数。
 * 若 deadline 为 null/undefined 或已过期 → 返回 6h fallback。
 * 若 deadline 未来 → 返回剩余毫秒。
 * 导出供单元测试使用。
 */
export function computeDeadlineMs(deadlineAt) {
  if (!deadlineAt) return 6 * 3600 * 1000;
  const remaining = new Date(deadlineAt).getTime() - Date.now();
  return remaining > 0 ? remaining : 6 * 3600 * 1000;
}
```

- [ ] **Step 2: 替换第 2880-2883 行的 inline 逻辑**

找到：
```javascript
  const deadlineAt = deadlineRow.rows[0]?.deadline_at;
  const deadlineMs = deadlineAt
    ? Math.max(60_000, new Date(deadlineAt).getTime() - Date.now())  // 至少 1min
    : 6 * 3600 * 1000;  // fallback 6h
```

替换为：
```javascript
  const deadlineAt = deadlineRow.rows[0]?.deadline_at;
  const deadlineMs = computeDeadlineMs(deadlineAt);
```

- [ ] **Step 3: 运行 test 确认变绿**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix/packages/brain
npx vitest run src/__tests__/executor-deadline.test.js 2>&1 | tail -20
```

期望输出：`5 passed`，无 failed。

- [ ] **Step 4: 运行完整 test suite 确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix/packages/brain
NODE_OPTIONS="--max-old-space-size=3072" npx vitest run 2>&1 | tail -10
```

期望输出：无新增 failed test（之前通过的仍通过）。

- [ ] **Step 5: commit-2（implementation）**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix
git add packages/brain/src/executor.js
git commit -m "fix(brain): computeDeadlineMs — 过期 deadline 返 6h fallback，不触发 60s watchdog"
```

---

## Task 3：Bug 2 Failing Test — notion/task Status property 回归测试

**Files:**
- Create: `packages/brain/src/__tests__/routes/notes-notion-task.test.js`

- [ ] **Step 1: 写 failing test**

```javascript
/**
 * Regression test: POST /api/brain/notion/task
 *
 * Bug: TASKS_DB = AI_NOTES_DB，AI Notes DB 无 Status property，
 *      handler 往 Notion properties 写 Status → Notion 400 → API 502
 * Fix: 从 properties 移除 Status，写入 page children body 段落
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 必须在 import router 前 mock notionReq
const mockNotionReq = vi.fn();
const mockGetToken = vi.fn(() => 'test-notion-token');

vi.mock('../../recurring-notion-sync.js', () => ({
  notionReq: (...args) => mockNotionReq(...args),
  getToken: () => mockGetToken(),
}));

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/notes.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('POST /notion/task', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockNotionReq.mockResolvedValue({ id: 'page-123', url: 'https://notion.so/page-123' });
  });

  it('不带 status 时返回 201', async () => {
    const res = await request(app)
      .post('/notion/task')
      .send({ title: 'WS1 — feat: some feature' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('page-123');
  });

  it('带 status 时 Notion properties 中不含 Status 字段（Bug 2 回归）', async () => {
    await request(app)
      .post('/notion/task')
      .send({ title: 'WS1 — feat: some feature', status: 'Done' });

    expect(mockNotionReq).toHaveBeenCalledOnce();
    const callArgs = mockNotionReq.mock.calls[0];
    // callArgs = [token, '/pages', 'POST', body]
    const notionBody = callArgs[3];
    // properties 中不能有 Status（AI Notes DB 无此 property）
    expect(notionBody.properties).not.toHaveProperty('Status');
  });

  it('带 status 时 status 值出现在 children paragraph 中', async () => {
    await request(app)
      .post('/notion/task')
      .send({ title: 'WS1 — feat: some feature', status: 'Done' });

    const callArgs = mockNotionReq.mock.calls[0];
    const notionBody = callArgs[3];
    // children 应包含含有 status 文本的段落
    const children = notionBody.children || [];
    const allText = children
      .map(b => b.paragraph?.rich_text?.map(rt => rt.text?.content).join('') || '')
      .join(' ');
    expect(allText).toContain('Done');
  });

  it('缺少 title 返回 400', async () => {
    const res = await request(app)
      .post('/notion/task')
      .send({ status: 'Done' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 确认 test 失败（Status 在 properties 中存在）**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix/packages/brain
npx vitest run src/__tests__/routes/notes-notion-task.test.js 2>&1 | tail -20
```

期望输出：`带 status 时 Notion properties 中不含 Status 字段` 这条 test FAIL（当前代码会把 Status 放进 properties）。

- [ ] **Step 3: commit-1（failing test）**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix
git add packages/brain/src/__tests__/routes/notes-notion-task.test.js
git commit -m "test(brain): failing regression — notion/task Status property 不应在 AI Notes DB properties 中"
```

---

## Task 4：Bug 2 Implementation — 移除 notion/task Status property

**Files:**
- Modify: `packages/brain/src/routes/notes.js` (第 112-122 行)

- [ ] **Step 1: 修改 /notion/task 处理器**

找到当前代码（约第 112-122 行）：
```javascript
  try {
    const token = getToken();
    const properties = {
      Title: { title: [{ text: { content: fullTitle } }] },
    };
    if (status) properties.Status = { select: { name: status } };

    const page = await notionReq(token, '/pages', 'POST', {
      parent: { database_id: TASKS_DB },
      properties,
    });
```

替换为：
```javascript
  try {
    const token = getToken();
    const properties = {
      Title: { title: [{ text: { content: fullTitle } }] },
    };

    const page = await notionReq(token, '/pages', 'POST', {
      parent: { database_id: TASKS_DB },
      properties,
      ...(status && {
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: buildRichText(`Status: ${status}`) },
        }],
      }),
    });
```

- [ ] **Step 2: 运行 test 确认变绿**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix/packages/brain
npx vitest run src/__tests__/routes/notes-notion-task.test.js 2>&1 | tail -20
```

期望输出：`4 passed`，无 failed。

- [ ] **Step 3: 运行完整 test suite 确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix/packages/brain
NODE_OPTIONS="--max-old-space-size=3072" npx vitest run 2>&1 | tail -10
```

期望输出：无新增 failed test。

- [ ] **Step 4: commit-2（implementation）**

```bash
cd /Users/administrator/worktrees/cecelia/executor-deadline-notion-task-bugfix
git add packages/brain/src/routes/notes.js
git commit -m "fix(brain): notion/task — 移除 Status property（AI Notes DB 无此字段），改写入 children body"
```

---

## 执行后验证

- [ ] 确认 4 个 commit 按顺序：failing-test-1 → fix-1 → failing-test-2 → fix-2
- [ ] `git log --oneline -4` 确认顺序正确
