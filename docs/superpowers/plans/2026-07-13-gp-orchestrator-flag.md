# golden_path_proposal orchestrator 字段修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/select` 与 `/approve` 建 `golden_path_proposal` 任务时 payload 补 `orchestrator: 'skill-relay'`，让任务不再被 executor 的硬校验判 `missing_orchestrator_flag` terminal failed。

**Architecture:** 纯字段补齐，不改状态机、不改校验逻辑。两处 `INSERT INTO tasks` 的 payload JSON 对象各加一个键值对。

**Tech Stack:** Node.js / Express / pg，测试用 Vitest + supertest，真实 PostgreSQL 集成测试（现有 `golden-path.integration.test.js` Path 4 套件）。

---

### Task 1: 补 select/approve 集成测试断言（先写 failing test）

**Files:**
- Modify: `packages/brain/src/__tests__/integration/golden-path.integration.test.js:582-585`（select 用例）
- Modify: `packages/brain/src/__tests__/integration/golden-path.integration.test.js:643-651`（approve 用例）

- [ ] **Step 1: 在 select 用例里加 orchestrator 断言**

在 `golden-path.integration.test.js` 第 582-585 行（`/select` 用例里查 tasks 表那段）后面，紧接着加一行断言：

```javascript
      // DB: tasks 存在且 task_type=golden_path_proposal
      const taskRow = await testPool.query('SELECT task_type, status, payload FROM tasks WHERE id = $1', [proposalTaskId]);
      expect(taskRow.rows[0].task_type).toBe('golden_path_proposal');
      expect(taskRow.rows[0].status).toBe('queued');
      expect(taskRow.rows[0].payload.orchestrator).toBe('skill-relay');
    });
```

注意：原 SQL 是 `SELECT task_type, status FROM tasks ...`，改成 `SELECT task_type, status, payload FROM tasks ...`（补 `payload` 列，否则读不到 `payload.orchestrator`）。

- [ ] **Step 2: 在 approve 用例里加 orchestrator 断言**

在 `golden-path.integration.test.js` 第 643-651 行（`/approve` 用例里查 harness task 那段）里加一行断言：

```javascript
      // DB: harness tasks(task_type=golden_path_proposal, payload 含 phase=implement)
      const harnessRow = await testPool.query(
        'SELECT task_type, status, payload FROM tasks WHERE id = $1',
        [harnessTaskId],
      );
      expect(harnessRow.rows[0].task_type).toBe('golden_path_proposal');
      expect(harnessRow.rows[0].status).toBe('queued');
      expect(harnessRow.rows[0].payload.phase).toBe('implement');
      expect(harnessRow.rows[0].payload.golden_path_id).toBe(gpId);
      expect(harnessRow.rows[0].payload.orchestrator).toBe('skill-relay');
    });
```

（这里已经 `SELECT ... payload`，只加断言行，不用改 SQL。）

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/golden-path.integration.test.js -t "Path 4"`

Expected: FAIL — `expect(taskRow.rows[0].payload.orchestrator).toBe('skill-relay')` 和 `expect(harnessRow.rows[0].payload.orchestrator).toBe('skill-relay')` 两处报 `expected undefined to be 'skill-relay'`（需要本机 PostgreSQL 可连，用现有 CI/本地测试库配置，`DB_DEFAULTS` 已在测试文件里 import）。

- [ ] **Step 4: Commit（红）**

```bash
git add packages/brain/src/__tests__/integration/golden-path.integration.test.js
git commit -m "test: golden_path_proposal payload 应含 orchestrator=skill-relay（red）"
```

---

### Task 2: 修复 golden-paths.js 两处 payload

**Files:**
- Modify: `packages/brain/src/routes/golden-paths.js:171`（select）
- Modify: `packages/brain/src/routes/golden-paths.js:240-247`（approve）

- [ ] **Step 1: /select 补字段**

第 171 行原文：

```javascript
        JSON.stringify({ golden_path_id: id, title: gp.title, one_liner: gp.one_liner }),
```

改成：

```javascript
        JSON.stringify({ golden_path_id: id, title: gp.title, one_liner: gp.one_liner, orchestrator: 'skill-relay' }),
```

- [ ] **Step 2: /approve 补字段**

第 240-247 行原文：

```javascript
        JSON.stringify({
          golden_path_id: id,
          title: gp.title,
          one_liner: gp.one_liner,
          proposal_doc: frozenDoc,
          judgment_decision_id: judgmentId,
          phase: 'implement',
        }),
```

改成：

```javascript
        JSON.stringify({
          golden_path_id: id,
          title: gp.title,
          one_liner: gp.one_liner,
          proposal_doc: frozenDoc,
          judgment_decision_id: judgmentId,
          phase: 'implement',
          orchestrator: 'skill-relay',
        }),
```

- [ ] **Step 3: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/golden-path.integration.test.js -t "Path 4"`

Expected: PASS（全部 Path 4 用例，含新加的两条 orchestrator 断言）

- [ ] **Step 4: 跑一遍完整 golden-path 相关测试文件确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/golden-path-proposal-wiring.test.js src/__tests__/golden-path-decisions.test.ts src/__tests__/task-router-golden-path-proposal.test.js src/__tests__/integration/golden-path.integration.test.js`

Expected: 全部 PASS

- [ ] **Step 5: Commit（绿）**

```bash
git add packages/brain/src/routes/golden-paths.js
git commit -m "fix(brain): golden_path_proposal 任务补 orchestrator=skill-relay，修复 /select /approve 后 terminal failed"
```

---

### Task 3: 手动验证真实修复（不写代码，只验证）

- [ ] **Step 1: 用本次真实触发的候选记录验证**

修复合并部署后，运行：

```bash
curl -s "localhost:5221/api/brain/tasks/8405972e-3084-4940-84e7-6c01a2025cd0" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status'])"
```

这条历史失败任务不会自动重跑（已 terminal failed），仅作为记录不需要处理。真正的验证方式是：新建一条 candidate 走一次 `/select`，确认新任务不再落 `missing_orchestrator_flag`。这一步在部署后由 PR watchdog / 下次真实 GP 圈选自然验证，不需要本 Task 额外操作。
