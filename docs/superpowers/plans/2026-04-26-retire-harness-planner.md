# Retire harness_planner Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `harness_initiative` 成为唯一 harness pipeline 入口 — 抽 3 个共享函数到 `harness-shared.js`，删 6 个文件（`harness-graph.js` / `harness-graph-runner.js` + 4 stub），收紧 `executor.js` 路由把 `harness_planner` 归入 retired，清 routes 层 + task-router。

**Architecture:** 主要是文件删除 + import 路径切换 + 路由收紧。`harness-initiative` full graph 主路径不动；`harness-final-e2e.js` 工具集保留（finalE2eNode 在用）。

**Tech Stack:** Node.js / vitest / LangGraph / Postgres

---

## File Structure

| 改/删 | 文件 | 用途 |
|---|---|---|
| 新建 | `packages/brain/src/harness-shared.js` | 抽出 3 共享函数（parseDockerOutput / extractField / loadSkillContent） |
| 修改 | `packages/brain/src/docker-executor.js:56` | import 路径切到 harness-shared |
| 修改 | `packages/brain/src/workflows/harness-initiative.graph.js:30` | 同上 |
| 修改 | `packages/brain/src/workflows/harness-task.graph.js:33` | 同上 |
| 修改 | `packages/brain/src/executor.js:2841` | 删 harness_planner 路由分支，加入 _RETIRED_HARNESS_TYPES |
| 修改 | `packages/brain/src/task-router.js` | VALID_TASK_TYPES + LOCATION_MAP 移除 harness_planner |
| 修改 | `packages/brain/src/routes/goals.js:89` | 删 harness_planner SQL |
| 修改 | `packages/brain/src/routes/status.js:518` | 同上 |
| 修改 | `packages/brain/src/routes/harness.js:104,729,738,767` | 删/改 harness_planner 引用 |
| 删 | `packages/brain/src/harness-graph.js` (43KB) | 6 节点 GAN graph 主实现 |
| 删 | `packages/brain/src/harness-graph-runner.js` (5KB) | runHarnessPipeline 入口 |
| 删 | `packages/brain/src/harness-watcher.js` | PR #2640 stub |
| 删 | `packages/brain/src/harness-phase-advancer.js` | PR #2640 stub |
| 删 | `packages/brain/src/harness-initiative-runner.js` | v2 Phase C4 shim |
| 删 | `packages/brain/src/harness-task-dispatch.js` (6.9KB) | dead code (harness_task retired) |
| 删 | `packages/brain/src/__tests__/harness-graph.test.js` | graph 已删 |
| 删 | `packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js` | runner 已删 |
| 删 | `packages/brain/src/__tests__/executor-default-langgraph.test.js` | PR #2652 加的 harness_planner LangGraph 路由测试 |
| 删 | `packages/brain/src/__tests__/harness-task-dispatch.test.js` (如存在) | dispatch 已删 |
| 修改 | `packages/brain/src/__tests__/harness-pipelines-list.test.js` | 删 harness_planner stage 用例 |
| 修改 | `packages/brain/src/__tests__/harness-pipeline-steps.test.js` | 同上 |
| 新建 | `packages/brain/src/__tests__/harness-shared.test.js` | 覆盖 3 共享函数 |
| 新建 | `packages/brain/src/__tests__/executor-harness-planner-retired.test.js` | 验证 harness_planner → terminal_failure |
| 修改 | `packages/brain/package.json` + `package-lock.json` | 1.224.0 → 1.225.0 |
| 修改 | `.brain-versions` + `DEFINITION.md` | 同步 |
| 新建 | `cp-0426202418-retire-harness-planner.dod.md` | per-branch DoD |
| 新建 | `docs/learnings/cp-0426202418-retire-harness-planner.md` | Learning |

---

### Task 1: Pre-cleanup — cancel queued/in_progress harness_planner tasks

**Files:** （只跑 SQL，不改代码）

- [ ] **Step 1: Cancel zombie harness_planner tasks**

Run:
```bash
PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "UPDATE tasks SET status='canceled', completed_at=NOW(), error_message='superseded by harness_initiative; manually canceled before retirement PR merge' WHERE task_type='harness_planner' AND status IN ('queued','in_progress') RETURNING id, status;"
```
Expected: returns 0+ rows of canceled task ids（含我之前 80bbb616 那个 manual 测试 task）

- [ ] **Step 2: Confirm zero remaining**

Run:
```bash
PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -t -c "SELECT COUNT(*) FROM tasks WHERE task_type='harness_planner' AND status IN ('queued','in_progress');"
```
Expected: `0`

---

### Task 2: 新建 harness-shared.test.js (RED)

**Files:**
- Create: `packages/brain/src/__tests__/harness-shared.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
/**
 * 验证：harness-shared.js export 3 个共享函数（搬自 harness-graph.js）。
 * 函数语义不变，仅 module 路径切换。
 */
import { describe, it, expect } from 'vitest';

describe('harness-shared module', () => {
  it('exports parseDockerOutput / extractField / loadSkillContent', async () => {
    const mod = await import('../harness-shared.js');
    expect(typeof mod.parseDockerOutput).toBe('function');
    expect(typeof mod.extractField).toBe('function');
    expect(typeof mod.loadSkillContent).toBe('function');
  });

  it('parseDockerOutput 抽 claude --output-format json 末尾 result 段', async () => {
    const { parseDockerOutput } = await import('../harness-shared.js');
    const stdout = `some preamble\n{"result":"final-output-content","other":"x"}\n`;
    const out = parseDockerOutput(stdout);
    expect(out).toContain('final-output-content');
  });

  it('extractField 兼容 pr_url: <URL> 字面量 + JSON', async () => {
    const { extractField } = await import('../harness-shared.js');
    expect(extractField('pr_url: https://github.com/x/y/pull/1', 'pr_url')).toBe('https://github.com/x/y/pull/1');
    expect(extractField('"pr_url":"https://github.com/x/y/pull/2"', 'pr_url')).toBe('https://github.com/x/y/pull/2');
    expect(extractField('pr_url: null', 'pr_url')).toBeNull();
    expect(extractField('pr_url: FAILED', 'pr_url')).toBeNull();
  });

  it('loadSkillContent 读 skill 文件返回字符串', async () => {
    const { loadSkillContent } = await import('../harness-shared.js');
    // 选个稳定存在的 skill，与 harness-graph.js:46 实现一致
    const content = loadSkillContent('harness-planner');
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npx vitest run src/__tests__/harness-shared.test.js`
Expected: 全失败（harness-shared.js 文件还不存在）

---

### Task 3: 新建 executor-harness-planner-retired.test.js (RED)

**Files:**
- Create: `packages/brain/src/__tests__/executor-harness-planner-retired.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
/**
 * 验证：executor.js 不再有 harness_planner LangGraph 路由分支；
 * harness_planner task_type 被归入 _RETIRED_HARNESS_TYPES，标 terminal_failure。
 *
 * 使用源码静态断言（避免启动 executor 大模块的副作用）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('executor.js harness_planner retired', () => {
  const SRC = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');

  it('不再含 harness_planner 路由到 LangGraph Pipeline 的分支', () => {
    // 旧代码：if (task.task_type === 'harness_planner') { ... runHarnessPipeline ... }
    expect(SRC).not.toMatch(/task\.task_type\s*===\s*['"]harness_planner['"][^\n]*\{[\s\S]{0,200}runHarnessPipeline/);
  });

  it('不再 import runHarnessPipeline / harness-graph-runner', () => {
    expect(SRC).not.toMatch(/runHarnessPipeline/);
    expect(SRC).not.toMatch(/harness-graph-runner/);
  });

  it('_RETIRED_HARNESS_TYPES 包含 harness_planner', () => {
    const m = SRC.match(/_RETIRED_HARNESS_TYPES\s*=\s*new Set\(\[([\s\S]+?)\]/);
    expect(m, '_RETIRED_HARNESS_TYPES Set 存在').not.toBeNull();
    expect(m[1]).toMatch(/['"]harness_planner['"]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npx vitest run src/__tests__/executor-harness-planner-retired.test.js`
Expected: 3 个 it 全失败

---

### Task 4: 新建 harness-shared.js（实现 3 函数）

**Files:**
- Create: `packages/brain/src/harness-shared.js`

- [ ] **Step 1: 读 harness-graph.js 拿到 3 函数源码**

Read `packages/brain/src/harness-graph.js` line 40-230 区域，准确抓取这 3 个 export：
- `loadSkillContent` (line 46)
- `parseDockerOutput` (line 154)
- `extractField` (line 209)

包含它们各自上方的 JSDoc 注释（如有）。

- [ ] **Step 2: 创建 harness-shared.js**

文件头：
```javascript
/**
 * harness-shared.js — 跨模块共享的 docker output parsing 工具。
 *
 * 这 3 个函数原定义在 harness-graph.js（6 节点 GAN pipeline 主文件）。
 * 该 pipeline 已退役（PR retire-harness-planner），但 docker-executor /
 * harness-initiative.graph / harness-task.graph 仍依赖这 3 个纯函数解析
 * Claude `--output-format json` 容器输出，故抽到本模块独立保留。
 *
 * 函数语义与 harness-graph.js 原版完全一致，仅 module 路径切换。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === 把 harness-graph.js 的 loadSkillContent / parseDockerOutput / extractField
//     的完整实现（含 JSDoc）粘贴到这里 ===
```

实现细节按 Step 1 抓到的源码原样粘贴。如果 loadSkillContent 用到了 `__dirname` 或 path resolve 逻辑，确保新文件的 `__dirname` 也能正确解析（harness-shared.js 与 harness-graph.js 同级，path 不变）。

- [ ] **Step 3: 跑 Task 2 的 harness-shared.test.js → 应全 PASS**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npx vitest run src/__tests__/harness-shared.test.js`
Expected: 全 PASS

---

### Task 5: 切换 3 处生产 import 到 harness-shared

**Files:**
- Modify: `packages/brain/src/docker-executor.js:56`
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:30`
- Modify: `packages/brain/src/workflows/harness-task.graph.js:33`

- [ ] **Step 1: docker-executor.js**

Edit. Replace:
```javascript
import { parseDockerOutput, extractField } from './harness-graph.js';
```
With:
```javascript
import { parseDockerOutput, extractField } from './harness-shared.js';
```

- [ ] **Step 2: workflows/harness-initiative.graph.js**

Edit. Replace:
```javascript
import { parseDockerOutput, loadSkillContent } from '../harness-graph.js';
```
With:
```javascript
import { parseDockerOutput, loadSkillContent } from '../harness-shared.js';
```

- [ ] **Step 3: workflows/harness-task.graph.js**

Edit. Replace:
```javascript
import { parseDockerOutput, extractField } from '../harness-graph.js';
```
With:
```javascript
import { parseDockerOutput, extractField } from '../harness-shared.js';
```

- [ ] **Step 4: Verify**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner && grep -n "from.*harness-graph" packages/brain/src/docker-executor.js packages/brain/src/workflows/harness-initiative.graph.js packages/brain/src/workflows/harness-task.graph.js`
Expected: 3 个文件都已无 `harness-graph` import（只剩 harness-shared）

- [ ] **Step 5: 跑相关测试**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npx vitest run src/__tests__/docker-executor.test.js`
Expected: PASS（import 路径切换无破坏）

---

### Task 6: 更新 executor.js — 删 harness_planner 路由 + 加入 retired set

**Files:**
- Modify: `packages/brain/src/executor.js:2841-2870` (or 附近)

- [ ] **Step 1: 删 harness_planner 路由分支**

Read executor.js line 2885-2950 区域定位 `if (task.task_type === 'harness_planner')` 整段（包括 runHarnessPipeline 调用 + onStep 回调 + cecelia_events insert）。

Edit. 把整段（约 50 行）删除，包括上方 `// 2.9 LangGraph Pipeline ...` 注释段。

- [ ] **Step 2: 把 harness_planner 加入 _RETIRED_HARNESS_TYPES Set**

Read executor.js line 2855-2870 区域定位：
```javascript
const _RETIRED_HARNESS_TYPES = new Set([
  'harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e',
]);
```

Edit. 改为：
```javascript
const _RETIRED_HARNESS_TYPES = new Set([
  'harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e',
  'harness_planner',  // retired in PR retire-harness-planner; subsumed by harness_initiative full graph
]);
```

- [ ] **Step 3: 更新 retired type 的 error_message**

Find line `error_message=$2,` 附近的 message 模板：
```javascript
[task.id, `task_type ${task.task_type} retired in Sprint 1 (full-graph migration); see harness-initiative full graph sub-graph`]
```

改为：
```javascript
[task.id, `task_type ${task.task_type} retired (subsumed by harness_initiative full graph)`]
```

- [ ] **Step 4: 验证**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner && grep -nE "harness_planner|runHarnessPipeline" packages/brain/src/executor.js | head -5`
Expected: 仅剩 `_RETIRED_HARNESS_TYPES` Set 里的字符串那一行

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npx vitest run src/__tests__/executor-harness-planner-retired.test.js`
Expected: 3/3 PASS

---

### Task 7: 删 harness-graph.js + harness-graph-runner.js + 4 stub 文件

**Files:**
- Delete: `packages/brain/src/harness-graph.js`
- Delete: `packages/brain/src/harness-graph-runner.js`
- Delete: `packages/brain/src/harness-watcher.js`
- Delete: `packages/brain/src/harness-phase-advancer.js`
- Delete: `packages/brain/src/harness-initiative-runner.js`
- Delete: `packages/brain/src/harness-task-dispatch.js`

- [ ] **Step 1: 删除前最后 verify — 0 生产 import**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && \
grep -rn -E "from\s+['\"](\\./)+(workflows/)?harness-(graph|graph-runner|watcher|phase-advancer|initiative-runner|task-dispatch)['\"]" packages/brain/src --include='*.js' | grep -v __tests__
```
Expected: 0 行（如有任何行 → 说明还有遗漏 caller，停下排查）

- [ ] **Step 2: 删 6 个文件**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && \
git rm packages/brain/src/harness-graph.js \
       packages/brain/src/harness-graph-runner.js \
       packages/brain/src/harness-watcher.js \
       packages/brain/src/harness-phase-advancer.js \
       packages/brain/src/harness-initiative-runner.js \
       packages/brain/src/harness-task-dispatch.js
```
Expected: 6 个文件被 git stage 为 deleted

- [ ] **Step 3: Verify**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner && ls packages/brain/src/harness-{graph,graph-runner,watcher,phase-advancer,initiative-runner,task-dispatch}.js 2>&1 | head`
Expected: 全部 No such file or directory

---

### Task 8: 删过时测试文件

**Files:**
- Delete: `packages/brain/src/__tests__/harness-graph.test.js`
- Delete: `packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js`
- Delete: `packages/brain/src/__tests__/executor-default-langgraph.test.js`
- Delete: `packages/brain/src/__tests__/harness-task-dispatch.test.js` (如存在)

- [ ] **Step 1: 删测试文件**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && \
git rm packages/brain/src/__tests__/harness-graph.test.js \
       packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js \
       packages/brain/src/__tests__/executor-default-langgraph.test.js
```

- [ ] **Step 2: 检查 harness-task-dispatch.test.js 存在性**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner && ls packages/brain/src/__tests__/harness-task-dispatch.test.js 2>/dev/null && git rm packages/brain/src/__tests__/harness-task-dispatch.test.js`
Expected: 存在 → 删；不存在 → skip

- [ ] **Step 3: Verify**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner && git status --short | grep deleted`
Expected: 列出已 stage 删除的测试文件

---

### Task 9: 修 harness-pipelines-list.test.js + harness-pipeline-steps.test.js（删 harness_planner 用例）

**Files:**
- Modify: `packages/brain/src/__tests__/harness-pipelines-list.test.js`
- Modify: `packages/brain/src/__tests__/harness-pipeline-steps.test.js`

- [ ] **Step 1: 读 harness-pipelines-list.test.js**

Run: `cat /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain/src/__tests__/harness-pipelines-list.test.js | grep -n "harness_planner"`

如果文件含 `harness_planner` stage 用例 → 用 Edit 工具删除（删整个 it block 或 stage 字段）。如果是 fixture 数据有 harness_planner，删该字段。

- [ ] **Step 2: 同 Step 1 处理 harness-pipeline-steps.test.js**

Run: `cat /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain/src/__tests__/harness-pipeline-steps.test.js | grep -n "harness_planner"`

按需 Edit。

- [ ] **Step 3: 跑两个测试 → PASS**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npx vitest run src/__tests__/harness-pipelines-list.test.js src/__tests__/harness-pipeline-steps.test.js`
Expected: PASS

---

### Task 10: 清 routes 层（goals.js / status.js / harness.js）

**Files:**
- Modify: `packages/brain/src/routes/goals.js:89`
- Modify: `packages/brain/src/routes/status.js:518`
- Modify: `packages/brain/src/routes/harness.js:104,729,738,767`

- [ ] **Step 1: routes/goals.js 删 harness_planner SQL**

Read line 80-100 区域定位：
```javascript
pool.query("SELECT count(*)::integer AS cnt FROM tasks WHERE task_type='harness_planner' AND status='in_progress'"),
```

Edit. 删除该行 + 同步删除该 query 在 destructuring 里对应的变量名（避免后续访问 undefined）。

- [ ] **Step 2: routes/status.js 删 harness_planner SQL**

Read line 510-525 区域定位 `WHERE task_type = 'harness_planner'`。Edit 删除该行 / 该 query。如该 query 是某个 array 元素，记得同时删除上下游引用。

- [ ] **Step 3: routes/harness.js 4 处引用**

Read line 100-110 / 725-770 区域定位 `harness_planner` 4 处。

- line 104：`tasks.find(t => t.task_type === 'harness_planner' || t.task_type === 'sprint_planner')` 改为 `tasks.find(t => t.task_type === 'sprint_planner')`（保留 sprint_planner，删 harness_planner）
- line 729 / 738 / 767：3 处 `WHERE task_type = 'harness_planner'` SQL 评估每处实际语义后定夺：
  - 如果是"列出 harness_planner 任务"页面 → 删整行（页面不再有意义）
  - 如果是统计聚合 → 改 LIKE 'harness_initiative%' 或删

按 Read 实际上下文决定。务必 grep 确保无 reference 漏。

- [ ] **Step 4: Verify routes 层 0 残留**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && \
grep -n "harness_planner" packages/brain/src/routes/goals.js packages/brain/src/routes/status.js packages/brain/src/routes/harness.js
```
Expected: 0 行

- [ ] **Step 5: 跑 routes 相关测试**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npx vitest run src/__tests__/routes/ --reporter=basic 2>&1 | tail -10`
Expected: 全 PASS（如有 fail，可能是测试 fixture 含 harness_planner，对应修测试）

---

### Task 11: task-router.js 移除 harness_planner

**Files:**
- Modify: `packages/brain/src/task-router.js`

- [ ] **Step 1: 移除 VALID_TASK_TYPES 中的 harness_planner**

Read line 15-60 区域定位 `VALID_TASK_TYPES` Set/Array。Edit 删除 `'harness_planner'` 字符串。

- [ ] **Step 2: 移除 LOCATION_MAP 中的 'harness_planner': 'us'**

Read line 195-270 区域定位 `LOCATION_MAP`。Edit 删除 `'harness_planner': 'us',` 整行。

- [ ] **Step 3: 加注释说明**

在 LOCATION_MAP 末尾或文件头加：
```javascript
// harness_planner: retired in PR retire-harness-planner (2026-04-26);
// subsumed by harness_initiative full graph; falls into _RETIRED_HARNESS_TYPES
// terminal_failure path in executor.js
```

- [ ] **Step 4: Verify**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner && grep -n "harness_planner" packages/brain/src/task-router.js`
Expected: 仅剩注释行

---

### Task 12: 跑全 brain 测试套件 + lint + syntax smoke

**Files:** (无修改)

- [ ] **Step 1: 全 brain 测试套件**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npx vitest run --reporter=basic 2>&1 | tail -30
```
Expected: 7000+ tests PASS（pre-existing fail 与 PR #2652 时一致约 14 个）。新增 fail 必须修；不允许 skip 任何 test

- [ ] **Step 2: Brain lint**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner/packages/brain && npm run lint 2>&1 | tail -10`
Expected: 0 error

- [ ] **Step 3: Syntax smoke**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && \
node --check packages/brain/server.js && \
node --check packages/brain/src/dispatcher.js && \
node --check packages/brain/src/executor.js && \
node --check packages/brain/src/harness-shared.js && \
node --check packages/brain/src/docker-executor.js && \
node --check packages/brain/src/workflows/harness-initiative.graph.js && \
node --check packages/brain/src/workflows/harness-task.graph.js && \
node --check packages/brain/src/task-router.js && \
echo SYNTAX_OK
```
Expected: SYNTAX_OK

---

### Task 13: Brain 版本 bump 1.224.0 → 1.225.0 + DoD + Learning

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Create: `cp-0426202418-retire-harness-planner.dod.md`
- Create: `docs/learnings/cp-0426202418-retire-harness-planner.md`

- [ ] **Step 1: Bump brain version**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && \
ls scripts/bump-brain-version.sh 2>/dev/null && bash scripts/bump-brain-version.sh patch 2>&1 | tail -5
```

If no script:
- `packages/brain/package.json`: `"version": "1.224.0"` → `"version": "1.225.0"`
- `packages/brain/package-lock.json`: 两处 `"version": "1.224.0"` → `"1.225.0"`
- `.brain-versions`: `1.224.0` → `1.225.0`
- `DEFINITION.md`: 找 brain 版本字段 → 改

- [ ] **Step 2: Verify**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner && cat .brain-versions && grep '"version"' packages/brain/package.json`
Expected: `1.225.0` 一致

- [ ] **Step 3: Write DoD file**

Create `cp-0426202418-retire-harness-planner.dod.md`:

```markdown
# DoD: 退役 harness_planner pipeline + cleanup 4 stub 文件

- [x] [BEHAVIOR] executor.js: harness_planner task 路由到 _RETIRED_HARNESS_TYPES → terminal_failure
  Test: packages/brain/src/__tests__/executor-harness-planner-retired.test.js

- [x] [BEHAVIOR] harness-shared.js export 3 共享函数（parseDockerOutput / extractField / loadSkillContent）
  Test: packages/brain/src/__tests__/harness-shared.test.js

- [x] [ARTIFACT] 删 harness-graph.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-graph.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-graph-runner.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-graph-runner.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-watcher.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-watcher.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-phase-advancer.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-phase-advancer.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-initiative-runner.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-initiative-runner.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-task-dispatch.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-task-dispatch.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [BEHAVIOR] task-router.js VALID_TASK_TYPES 不含 harness_planner
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');const m=c.match(/VALID_TASK_TYPES[\\s\\S]+?\\]/);if(!m||m[0].includes(\"'harness_planner'\")||m[0].includes('\"harness_planner\"'))process.exit(1)"

- [x] [BEHAVIOR] routes/goals.js / status.js / harness.js 不再 SQL 查询 harness_planner
  Test: manual:node -e "['routes/goals.js','routes/status.js','routes/harness.js'].forEach(f=>{const c=require('fs').readFileSync('packages/brain/src/'+f,'utf8');if(c.match(/task_type\\s*=\\s*['\"]harness_planner['\"]/i))process.exit(1)});process.exit(0)"
```

- [ ] **Step 4: Write Learning file**

Create `docs/learnings/cp-0426202418-retire-harness-planner.md`:

```markdown
# Learning: 退役 harness_planner pipeline

## 上下文
PR #2640 投产 harness_initiative full graph (Phase A+B+C) 后，老的 harness_planner 6 节点 GAN pipeline 功能被覆盖。但没人接手清退役，留下 4 个 deprecation stub 文件 + executor 路由 + routes 层 SQL + task-router 字典。Audit 显示 14 天 0 真实 caller（仅 zombie task + 测试），可安全退役。

## 根本原因
- PR #2640 引入 full graph 时为安全过渡保留了老 pipeline 入口和 stub 文件，注释里写 "下个清理 PR 删"，但没注册 cleanup task → 被遗忘
- 同样的"留 stub 等下个 PR"在 PR #2652（flip default flag）也出现了 — Code Reviewer 当时建议注册 cleanup task，本 PR 一并执行

## 下次预防
- [ ] 任何"保留 N 天兜底/stub"代码必须在合并 PR 时**同时注册一个 cleanup task 到 Brain**（带具体过期日期）
- [ ] 退役一个 task_type 之前必须先 audit 真实 caller（grep 代码 + DB query 14-30 天派发记录），区分 zombie 和真用户
- [ ] 抽函数到新文件时务必 grep **整个 monorepo** 确认所有 caller，不能只看一个文件 — 第一轮 reviewer 就因这点 REJECT（loadSkillContent 漏了）
```

- [ ] **Step 5: Verify all files exist**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && \
ls -la cp-0426202418-retire-harness-planner.dod.md docs/learnings/cp-0426202418-retire-harness-planner.md packages/brain/package.json .brain-versions DEFINITION.md
```
Expected: 都存在

---

### Task 14: 一次性 commit + 不 push（finishing 接手）

**Files:** 全部已修改/删除文件

- [ ] **Step 1: Stage**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && git add -A
```

注意：因为 Task 7/8 已经用 `git rm` 处理了删除，加上 modified 和新建的文件，`git add -A` 是合适的。

- [ ] **Step 2: Verify staged**

Run: `cd /Users/administrator/worktrees/cecelia/retire-harness-planner && git diff --cached --stat`
Expected: 包含 6 个 deleted（harness-graph + harness-graph-runner + 4 stub）+ 3-4 个 deleted test + 多个 modified + 4 个新建（harness-shared.js + 2 test + DoD + Learning）

- [ ] **Step 3: Commit**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/retire-harness-planner && git commit -m "$(cat <<'EOF'
feat(brain): 退役 harness_planner pipeline + cleanup 4 stub 文件

让 harness_initiative 成为唯一 harness 入口（PR #2640 投产 full graph 之后的最后清理）。

抽出共享工具：
- 新建 harness-shared.js — parseDockerOutput / extractField / loadSkillContent
- 更新 docker-executor / harness-initiative.graph / harness-task.graph 3 处 import

删除（6 个生产文件 + 3-4 个测试）：
- harness-graph.js (43KB, 6 节点 GAN pipeline)
- harness-graph-runner.js (5KB, runHarnessPipeline 入口)
- harness-watcher.js / harness-phase-advancer.js / harness-initiative-runner.js (PR #2640 stub)
- harness-task-dispatch.js (Phase B dispatcher，dead code)

路由收紧：
- executor.js: 删 harness_planner LangGraph 路由分支，归入 _RETIRED_HARNESS_TYPES
- task-router.js: VALID_TASK_TYPES + LOCATION_MAP 移除 harness_planner
- routes/goals.js / status.js / harness.js: 删 SQL 查询

Brain 1.224.0 → 1.225.0
Brain Task: 10413e0d-0c22-4dee-8970-e32f98f33df6
Audit: 14 天 17 个 task 全是 zombie，0 真实 caller

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### Spec coverage
- ✅ 单元 A (harness-shared 抽函数 + 3 处 import 切换) → Task 4 + Task 5
- ✅ 单元 B (删 harness-graph + harness-graph-runner) → Task 7
- ✅ 单元 C (删 4 stub) → Task 7
- ✅ 单元 D (executor.js 路由收紧) → Task 6
- ✅ 单元 E (routes 清理) → Task 10
- ✅ 单元 F (task-router 规整) → Task 11
- ✅ 单元 G (版本 bump) → Task 13
- ✅ 测试更新（删过时 + 新增 2 个）→ Task 8/9 + Task 2/3
- ✅ Risk 缓解（pre-cancel zombie task）→ Task 1
- ✅ DoD + Learning → Task 13
- ✅ Commit → Task 14

### Placeholder scan
- 无 TBD/TODO
- 所有代码块给完整 before/after
- 命令行 + 期望 output 都明确

### Type consistency
- `harness-shared.js` 名字全文一致
- `_RETIRED_HARNESS_TYPES` Set 名字一致
- env / file 路径一致

Plan complete.
