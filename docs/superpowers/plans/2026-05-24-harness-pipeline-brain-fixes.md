# Harness Pipeline Brain Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 harness pipeline 三处断链：harness_evaluate 路由缺失、Planner 不透传 PrepPRD、reportNode 不派 harness_report 子任务。

**Architecture:** 纯代码级修复，改动 2 个文件（task-router.js + harness-initiative.graph.js）。TDD：先写 3 个 failing test，再写实现让测试通过。

**Tech Stack:** Node.js ESM, vitest, PostgreSQL (pg pool), LangGraph

---

## 文件结构

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/brain/src/task-router.js` | 修改（行 55 + 行 271） | 添加 harness_evaluate 到 VALID_TASK_TYPES 和 LOCATION_MAP |
| `packages/brain/src/workflows/harness-initiative.graph.js` | 修改（行 578-585 + 行 592-597 + 行 1266） | Planner 注入 prep_prd_body/CECELIA_JOURNEY_ID；reportNode 派子任务 |
| `packages/brain/src/__tests__/task-router-initiative.test.js` | 修改（追加 2 个 test case） | Fix 1 的 unit test |
| `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js` | 修改（追加 2 个 test case） | Fix 2 + Fix 3 的 unit test |

---

## Task 1：写 3 个 failing tests（commit-1 TDD 红灯）

**Files:**
- Modify: `packages/brain/src/__tests__/task-router-initiative.test.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`

- [ ] **Step 1：在 task-router-initiative.test.js 末尾追加 Fix 1 test**

打开 `packages/brain/src/__tests__/task-router-initiative.test.js`，在最后一个 `});` **之前**（describe 块内）追加：

```js
  it('harness_evaluate 在 VALID_TASK_TYPES 中', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('harness_evaluate')).toBe(true);
  });

  it('harness_evaluate 在 LOCATION_MAP 中且路由到 us', async () => {
    const mod = await import('../task-router.js');
    expect(mod.LOCATION_MAP['harness_evaluate']).toBe('us');
    expect(mod.getTaskLocation('harness_evaluate')).toBe('us');
  });
```

- [ ] **Step 2：在 harness-initiative.graph.full.test.js 的 `runPlannerNode` import 行后追加 Fix 2 test**

注意：该文件第 91-98 行 import 区域只导入了 `fanoutSubTasksNode` 等，未导入 `runPlannerNode`。  
先在 import 语句中添加 `runPlannerNode`：

```js
import {
  fanoutSubTasksNode,
  joinSubTasksNode,
  finalE2eNode,
  reportNode,
  buildHarnessFullGraph,
  inferTaskPlanNode,
  runPlannerNode,   // ← 新增
} from '../harness-initiative.graph.js';
```

然后在 `describe('reportNode', () => {` **之前**插入新的 describe 块：

```js
describe('runPlannerNode — prep_prd_body 注入', () => {
  it('prompt 含 prep_prd_body 内容', async () => {
    const capturedArgs = [];
    mockSpawn.mockImplementation(async (taskArg) => {
      capturedArgs.push(taskArg);
      return { exit_code: 0, stdout: 'plannerOutput', stderr: '' };
    });
    mockResolveTok.mockResolvedValue('gh-token');
    mockEnsureWt.mockResolvedValue('/wt');
    mockReadFile.mockRejectedValue(new Error('no file'));

    await runPlannerNode({
      task: {
        id: 'task-1',
        title: 'test feature',
        description: 'test desc',
        payload: {
          sprint_dir: 'sprints/test',
          prep_prd_body: '# PrepPRD\n## Journey 当前状态\n- ✅ Step A',
          journey_id: 'journey-uuid-123',
        },
      },
      initiativeId: 'init-1',
      worktreePath: '/wt',
      githubToken: 'gh-token',
    });

    expect(capturedArgs.length).toBeGreaterThan(0);
    const prompt = capturedArgs[0].prompt;
    expect(prompt).toContain('PrepPRD');
    expect(prompt).toContain('Journey 当前状态');
  });

  it('env 含 CECELIA_JOURNEY_ID', async () => {
    const capturedArgs = [];
    mockSpawn.mockImplementation(async (taskArg) => {
      capturedArgs.push(taskArg);
      return { exit_code: 0, stdout: 'plannerOutput', stderr: '' };
    });
    mockResolveTok.mockResolvedValue('gh-token');
    mockEnsureWt.mockResolvedValue('/wt');
    mockReadFile.mockRejectedValue(new Error('no file'));

    await runPlannerNode({
      task: {
        id: 'task-1',
        title: 'test',
        description: 'test',
        payload: {
          sprint_dir: 'sprints/test',
          journey_id: 'journey-uuid-456',
        },
      },
      initiativeId: 'init-1',
      worktreePath: '/wt',
      githubToken: 'gh-token',
    });

    const env = capturedArgs[0].env;
    expect(env.CECELIA_JOURNEY_ID).toBe('journey-uuid-456');
  });
});
```

- [ ] **Step 3：在 harness-initiative.graph.full.test.js 的 reportNode describe 块末尾追加 Fix 3 test**

在 `describe('reportNode', () => {` 块中，`it('已 idempotent ...' ` 测试之后，`});` **之前**追加：

```js
  it('PASS → 第 3 次 query 是 INSERT INTO tasks (harness_report spawn)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await reportNode({
      initiativeId: 'i-spawn',
      sub_tasks: [{ id: 's1', cost_usd: 0.1 }],
      final_e2e_verdict: 'PASS',
      sprintDir: 'sprints/test',
      task: {
        title: 'test feature',
        payload: { journey_id: 'j1', feature_id: 'f1' },
      },
    });
    expect(mockPool.query).toHaveBeenCalledTimes(3);
    const insertCall = mockPool.query.mock.calls[2];
    expect(insertCall[0]).toMatch(/INSERT INTO tasks/i);
    expect(insertCall[0]).toContain('harness_report');
  });
```

- [ ] **Step 4：运行测试，确认 5 个新 case 全部 FAIL**

```bash
cd packages/brain && npx vitest run src/__tests__/task-router-initiative.test.js src/workflows/__tests__/harness-initiative.graph.full.test.js 2>&1 | tail -30
```

期望：出现 5 个新 test 的失败信息（`harness_evaluate` 相关 2 个 + runPlannerNode 2 个 + reportNode INSERT 1 个）。

- [ ] **Step 5：commit（failing tests）**

```bash
git add packages/brain/src/__tests__/task-router-initiative.test.js \
        packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
git commit -m "test(brain): add failing tests for harness_evaluate routing, prep_prd_body injection, reportNode spawn"
```

---

## Task 2：实现 Fix 1 — harness_evaluate 双写 task-router.js

**Files:**
- Modify: `packages/brain/src/task-router.js:55,271`

- [ ] **Step 1：在 VALID_TASK_TYPES 中添加 harness_evaluate**

打开 `packages/brain/src/task-router.js`，在第 55 行 `'harness_final_e2e',` 之后添加：

```js
  'harness_evaluate',    // Evaluator 对抗性功能验收（已在 SKILL_WHITELIST）
```

- [ ] **Step 2：在 LOCATION_MAP 中添加 harness_evaluate**

在第 271 行 `'harness_final_e2e': 'us',` 之后添加：

```js
  'harness_evaluate': 'us',      // Layer 3e: Evaluator 对抗性功能验收 → US
```

- [ ] **Step 3：运行 Fix 1 相关测试，确认通过**

```bash
cd packages/brain && npx vitest run src/__tests__/task-router-initiative.test.js 2>&1 | tail -20
```

期望：所有 test 通过，包括新增的 2 个 harness_evaluate case。

---

## Task 3：实现 Fix 2 — Planner 注入 prep_prd_body + CECELIA_JOURNEY_ID

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:568-598`

- [ ] **Step 1：修改 runPlannerNode 的 prompt 构建（约第 579-585 行）**

找到以下代码段：

```js
## 任务描述
${state.task.description || state.task.title || ''}

## 输出要求（v2）
```

改为：

```js
## 任务描述
${state.task.description || state.task.title || ''}

## PrepPRD（产品语言，用户确认过的需求文档）
${state.task?.payload?.prep_prd_body || '（未提供，Planner 从 sprint-prd.md 推断）'}

## 输出要求（v2）
```

- [ ] **Step 2：修改 runPlannerNode 的 env 构建（约第 592-597 行）**

找到以下代码段：

```js
      env: {
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'planner',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: state.initiativeId,
        GITHUB_TOKEN: state.githubToken,
      },
```

改为：

```js
      env: {
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'planner',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: state.initiativeId,
        CECELIA_JOURNEY_ID: state.task?.payload?.journey_id || '',
        GITHUB_TOKEN: state.githubToken,
      },
```

- [ ] **Step 3：运行 Fix 2 相关测试，确认通过**

```bash
cd packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js -t "prep_prd_body|CECELIA_JOURNEY_ID" 2>&1 | tail -20
```

期望：2 个 runPlannerNode test 通过。

---

## Task 4：实现 Fix 3 — reportNode 派 harness_report 子任务

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:1265`

- [ ] **Step 0：更新现有 B1 tests 以适应新的 3 次 query**

Fix 3 实现后 reportNode 会调用 query 3 次（2 个 UPDATE + 1 个 INSERT）。
现有两个 B1 tests 断言 `toHaveBeenCalledTimes(2)` 会失败，需更新：

在 `harness-initiative.graph.full.test.js` 的 `describe('reportNode')`  中：

**更新 `'PASS → 同时 UPDATE tasks SET status=completed (B1)'`**：
```js
// 改：mockPool.query.mockResolvedValueOnce × 2 → × 3
mockPool.query.mockResolvedValueOnce({ rows: [] });
mockPool.query.mockResolvedValueOnce({ rows: [] });
mockPool.query.mockResolvedValueOnce({ rows: [] }); // ← 新增：INSERT harness_report
// 改：toHaveBeenCalledTimes(2) → toHaveBeenCalledTimes(3)
expect(mockPool.query).toHaveBeenCalledTimes(3);
```

**更新 `'FAIL → 同时 UPDATE tasks SET status=failed (B1)'`**：
```js
// 改：mockPool.query.mockResolvedValueOnce × 2 → × 3
mockPool.query.mockResolvedValueOnce({ rows: [] });
mockPool.query.mockResolvedValueOnce({ rows: [] });
mockPool.query.mockResolvedValueOnce({ rows: [] }); // ← 新增
// 改：toHaveBeenCalledTimes(2) → toHaveBeenCalledTimes(3)
expect(mockPool.query).toHaveBeenCalledTimes(3);
```

- [ ] **Step 1：在 reportNode 的两个 DB 写完后追加 spawn 逻辑**

找到 reportNode 函数中以下代码段（约第 1260-1270 行）：

```js
    await dbPool.query(
      `UPDATE tasks SET status=$2::text, completed_at=NOW(), updated_at=NOW(),
        error_message=CASE WHEN $2::text='failed' THEN $3::text ELSE error_message END
       WHERE id=$1::uuid`,
      [state.initiativeId, taskStatus, reason]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode db update failed: ${err.message}`);
  }
  return { report_path: reportContent };
```

改为：

```js
    await dbPool.query(
      `UPDATE tasks SET status=$2::text, completed_at=NOW(), updated_at=NOW(),
        error_message=CASE WHEN $2::text='failed' THEN $3::text ELSE error_message END
       WHERE id=$1::uuid`,
      [state.initiativeId, taskStatus, reason]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode db update failed: ${err.message}`);
  }
  // 派 harness_report 子任务（6 步交付：Notion / 飞书 / harness-report.md）
  try {
    await dbPool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       VALUES ($1, $2, 'harness_report', 'queued', 'P2', $3::jsonb)`,
      [
        `[Harness Report] ${state.task?.title || state.initiativeId}`,
        `Auto-spawned by reportNode for initiative ${state.initiativeId}`,
        JSON.stringify({
          initiative_id: state.initiativeId,
          final_e2e_verdict: state.final_e2e_verdict,
          sprint_dir: state.sprintDir,
          journey_id: state.task?.payload?.journey_id,
          feature_id: state.task?.payload?.feature_id,
          sub_tasks: state.sub_tasks || [],
        }),
      ]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode spawn harness_report failed: ${err.message}`);
  }
  return { report_path: reportContent };
```

- [ ] **Step 2：运行 Fix 3 相关测试，确认通过**

```bash
cd packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js -t "harness_report spawn" 2>&1 | tail -20
```

期望：`PASS → 第 3 次 query 是 INSERT INTO tasks (harness_report spawn)` 通过。

---

## Task 5：全量测试验证 + commit

- [ ] **Step 1：全量运行修改过的测试文件**

```bash
cd packages/brain && npx vitest run src/__tests__/task-router-initiative.test.js src/__tests__/task-router.test.js src/workflows/__tests__/harness-initiative.graph.full.test.js 2>&1 | tail -40
```

期望：所有 test 通过，无 FAIL。

- [ ] **Step 2：运行整个 brain 测试套件确认无回归**

```bash
cd packages/brain && npx vitest run 2>&1 | tail -20
```

期望：全部通过（或仅有预先存在的 skip/flaky）。

- [ ] **Step 3：commit 实现**

```bash
git add packages/brain/src/task-router.js \
        packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(brain): add harness_evaluate to routing tables, inject prep_prd_body in planner, spawn harness_report from reportNode"
```

---

## Task 6：PRD、DoD 和 Learning 文件

- [ ] **Step 1：写 PRD 文件**

创建 `sprints/cp-0524153048-fix-harness-pipeline-brain-4issues/sprint-prd.md`：

```bash
mkdir -p sprints/cp-0524153048-fix-harness-pipeline-brain-4issues
```

内容：

```markdown
# Sprint PRD — Harness Pipeline Brain Fixes

## 目标
修复 harness pipeline 三处断链，保障 Walking Skeleton → Harness 端到端流程可用。

## 修复清单

### Fix 1：harness_evaluate 路由双写
- VALID_TASK_TYPES 添加 harness_evaluate
- LOCATION_MAP 添加 harness_evaluate → us

### Fix 2：Planner 透传上下文
- runPlannerNode prompt 追加 ## PrepPRD 章节（来自 payload.prep_prd_body）
- env 追加 CECELIA_JOURNEY_ID（来自 payload.journey_id）

### Fix 3：reportNode 派 harness_report 子任务
- 两个 DB 写完后 INSERT INTO tasks（task_type='harness_report', status='queued'）
- payload 含 initiative_id / final_e2e_verdict / sprint_dir / journey_id / feature_id

## 成功标准

- `isValidTaskType('harness_evaluate')` 返回 true
- `getTaskLocation('harness_evaluate')` 返回 'us'
- runPlannerNode 生成的 prompt 包含 PrepPRD 全文
- reportNode 执行后 tasks 表有新的 harness_report 任务（status=queued）
```

- [ ] **Step 2：写 DoD 文件**

创建 `sprints/cp-0524153048-fix-harness-pipeline-brain-4issues/dod.md`：

```markdown
# DoD — Harness Pipeline Brain Fixes

- [x] [ARTIFACT] `packages/brain/src/task-router.js` 包含 harness_evaluate 同时在 VALID_TASK_TYPES 和 LOCATION_MAP 中
- [x] [BEHAVIOR] Fix 1 unit test 通过：`manual:node -e "import('./packages/brain/src/task-router.js').then(m=>{if(!m.isValidTaskType('harness_evaluate'))process.exit(1);if(m.getTaskLocation('harness_evaluate')!=='us')process.exit(1);console.log('ok')})"`
- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` runPlannerNode prompt 含 PrepPRD 章节，env 含 CECELIA_JOURNEY_ID
- [x] [BEHAVIOR] Fix 2+3 unit tests 通过（harness-initiative.graph.full.test.js 5 个新 case 全绿）：`tests:packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`
```

- [ ] **Step 3：写 Learning 文件**

创建 `docs/learnings/cp-0524153048-fix-harness-pipeline-brain-4issues.md`：

```markdown
# Learning — cp-0524153048-fix-harness-pipeline-brain-4issues

### 根本原因

task-router.js 有两张独立的路由表（VALID_TASK_TYPES + LOCATION_MAP），两者互不自动同步。harness_evaluate 在 SKILL_WHITELIST 中已注册，但因未双写另两张表导致路由校验失败。

### 下次预防

- [ ] 新增任务类型时，必须同时写 3 处：VALID_TASK_TYPES + LOCATION_MAP + SKILL_WHITELIST
- [ ] Planner 节点接收的 payload 字段必须在 runPlannerNode 中显式透传到 prompt/env，不能假设 agent 会自行查 Notion
- [ ] reportNode 只做状态回写不足以触发完整交付流程，必须派 harness_report 子任务走 6 步交付
```

- [ ] **Step 4：commit**

```bash
git add sprints/ docs/learnings/
git commit -m "docs: add sprint prd, dod, learning for harness pipeline brain fixes"
```

---

## Task 7：Push 和创建 PR

- [ ] **Step 1：Push 分支**

```bash
git push -u origin cp-0524153048-fix-harness-pipeline-brain-4issues
```

- [ ] **Step 2：创建 PR**

```bash
gh pr create \
  --title "fix(brain): harness_evaluate routing, prep_prd_body injection, reportNode spawn" \
  --body "$(cat <<'EOF'
## Summary
- 修复 harness_evaluate 缺失 VALID_TASK_TYPES 和 LOCATION_MAP 导致路由校验失败
- Planner 节点注入 prep_prd_body（PrepPRD 全文）和 CECELIA_JOURNEY_ID（来自 payload）
- reportNode 在 DB 状态回写后派 harness_report 子任务（status=queued），触发完整 6 步交付

## Test plan
- [ ] task-router-initiative.test.js：新增 2 个 harness_evaluate case 通过
- [ ] harness-initiative.graph.full.test.js：新增 3 个 case（runPlannerNode×2 + reportNode×1）通过
- [ ] 全量 packages/brain vitest run 无新 FAIL

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
