# learnings-received 补 pushCaptureAtom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/brain/learnings-received` 路由在把 `next_steps_suggested` 写入 `learnings` 表后，为每条新插入的记录调用 `pushCaptureAtom`，补上统一收件箱漏掉的第四入口。

**Architecture:** 在 `packages/brain/src/routes/tasks.js` 顶部 import `pushCaptureAtom`（`../capture-inbox.js`），在现有 `for (const step of next_steps_suggested)` 循环里，`INSERT INTO learnings ... RETURNING id` 成功后紧接着调用一次 `pushCaptureAtom`，字段对齐 `learning.js:121-127` 的既有用法（`targetType: 'learning'`, `routedToTable: 'learnings'`, `routedToId: <新id>`）。

**Tech Stack:** Node.js / Express / vitest / supertest

---

### Task 1: 补 pushCaptureAtom 调用 + regression test

**Files:**
- Modify: `packages/brain/src/routes/tasks.js:1-13`（顶部 import 区）
- Modify: `packages/brain/src/routes/tasks.js:275-296`（`next_steps_suggested` 插入循环）
- Test: `packages/brain/src/__tests__/learnings-received.test.js`

- [ ] **Step 1: 写 failing test（真实挂载 router，而非既有测试里的内联复制逻辑）**

在 `packages/brain/src/__tests__/learnings-received.test.js` 顶部现有 mock 区（`vi.mock('fs', ...)` 之后）加一行 capture-inbox mock：

```js
// T12: mock capture-inbox（ESM export 无法 vi.spyOn，用工厂 mock；等价断言，与 handoff.test.js 手法一致）
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn().mockResolvedValue('atom-1') }));
```

在文件末尾（`describe('learnings-received: migration 151...')` 之后）新增一个 describe block，真实挂载路由（不复制内联逻辑）：

```js
// ── T12: capture_atoms 收件箱补线 ──────────────────────────

describe('learnings-received: T12 — capture_atoms 收件箱补线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('next_steps_suggested 插入 learnings 成功后应调用 pushCaptureAtom', async () => {
    const { pushCaptureAtom } = await import('../capture-inbox.js');
    const router = (await import('../routes/tasks.js')).default;

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'learning-capture-1' }] }) // learnings INSERT
      .mockResolvedValueOnce({ rows: [] }); // cecelia_events insert

    const app = express();
    app.use(express.json());
    app.use('/api/brain', router);

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({
        issues_found: [],
        next_steps_suggested: ['每次改 migration 前先 fetch main 确认最大号'],
        task_id: 'task-uuid-t12',
      });

    expect(response.status).toBe(200);
    expect(response.body.learnings_inserted).toBe(1);
    expect(pushCaptureAtom).toHaveBeenCalledTimes(1);
    const [, fields] = pushCaptureAtom.mock.calls[0];
    expect(fields.targetType).toBe('learning');
    expect(fields.routedToTable).toBe('learnings');
    expect(fields.routedToId).toBe('learning-capture-1');
  });

  it('pushCaptureAtom 抛错时不应影响 learnings-received 的成功响应', async () => {
    const { pushCaptureAtom } = await import('../capture-inbox.js');
    pushCaptureAtom.mockRejectedValueOnce(new Error('capture_atoms insert failed'));
    const router = (await import('../routes/tasks.js')).default;

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'learning-capture-2' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = express();
    app.use(express.json());
    app.use('/api/brain', router);

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({
        issues_found: [],
        next_steps_suggested: ['测试 pushCaptureAtom 失败不阻塞主流程'],
        task_id: 'task-uuid-t12b',
      });

    expect(response.status).toBe(200);
    expect(response.body.learnings_inserted).toBe(1);
  });
});
```

> 第二个用例覆盖"写入失败绝不抛"——但 `pushCaptureAtom` 本身已在 `capture-inbox.js` 内部 try/catch 吞错并返回 null，这里 mock 成 reject 是为了防止未来有人在调用处外面加一层不带 try/catch 的裸调用。如果调用处直接 `await pushCaptureAtom(...)` 不加额外 try/catch（复用其内部吞错语义），这条测试也应该通过；只有当调用处错误地在外面重新 throw 时才会失败。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/learnings-received.test.js -t "T12"`
Expected: FAIL — `expect(pushCaptureAtom).toHaveBeenCalledTimes(1)` 收到 0 次调用（路由尚未接线）

- [ ] **Step 3: 实现修复**

在 `packages/brain/src/routes/tasks.js` 顶部 import 区（第 13 行 `emit as emitEvent` 之后）新增：

```js
import { pushCaptureAtom } from '../capture-inbox.js';
```

在 `next_steps_suggested` 插入循环内（第 276-296 行），INSERT 成功分支里补上 `pushCaptureAtom` 调用：

```js
    const insertedItems = [];
    for (const step of next_steps_suggested) {
      if (!step || typeof step !== 'string') continue;
      try {
        const title = step.slice(0, 120);
        const { rows } = await pool.query(
          `INSERT INTO learnings
             (title, category, content, trigger_source, trigger_event, digested,
              source_branch, source_pr, repo, task_id, summary)
           VALUES ($1, 'dev_experience', $2, 'dev_workflow', 'learnings_received', false,
                   $3, $4, $5, $6, $7)
           RETURNING id`,
          [title, step, branch_name || null, pr_number ? String(pr_number) : null, repo, task_id || null, generateL0Summary(step)]
        );
        if (rows[0]?.id) {
          results.learnings_inserted.push(rows[0].id);
          insertedItems.push({ id: rows[0].id, content: step });

          // T12: 统一收件箱补线——dev workflow 标准出口，非 recordLearning() 那条 RCA 路径
          await pushCaptureAtom(pool, {
            content: `learning: ${title}\n${step}`,
            targetType: 'learning',
            targetSubtype: 'dev_experience',
            routedToTable: 'learnings',
            routedToId: rows[0].id,
          });
        }
      } catch (dbErr) {
        console.warn(`[learnings-received] learnings INSERT failed: ${dbErr.message}`);
      }
    }
```

（其余代码不变，`insertedItems` 后续仍用于异步 `classifyLearningType` 补填 `learning_type`。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/learnings-received.test.js`
Expected: PASS — 全部用例（含既有的 7 条 + 新增 2 条）通过

- [ ] **Step 5: 跑 DevGate 三件套确认代码没破坏其它约束**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh`
Expected: 两条都通过（本次改动不涉及 API/schema/版本，理论上不受影响；若涉及版本同步文件需按规则 bump）

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/routes/tasks.js packages/brain/src/__tests__/learnings-received.test.js
git commit -m "fix: learnings-received路由补pushCaptureAtom——统一收件箱第四入口通电（九要素T12）"
```
