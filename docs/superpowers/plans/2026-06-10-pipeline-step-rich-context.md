# Pipeline Step Rich Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/pipeline/:id/step/:stepIndex` 页面对每个 LangGraph 节点显示完整执行上下文（system prompt、skill 内容、user input、DB context、output），替代现在的"暂无数据"。

**Architecture:** 后端在 `buildLangGraphInfo()` 里为每个 step 异步读取 skill 文件 + sprint dir 产物文件，填充 6 个新字段。前端 StepPage 重写为五栏叠加布局（Lucide 图标），DetailPage 在 GAN round 展开区域加"查看详情"导航链接。

**Tech Stack:** Node.js ESM, Express, PostgreSQL, React 18, TypeScript, Lucide React, Vitest + @testing-library/react

---

## File Map

| 文件 | 操作 | 改什么 |
|------|------|--------|
| `packages/brain/src/routes/harness.js` | 修改 | 新增 4 个常量 + 2 个辅助函数 + 在 `buildLangGraphInfo()` 加 task query + 改 step map 为 async |
| `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` | 修改 | `LangGraphSection` / `LangGraphRoundList` / `LangGraphRoundCard` 接收 `pipelineId`，展开区加导航链接 |
| `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx` | 重写 | 扩展接口，改数据查找逻辑，重写渲染为五栏 `ContextBlock` |
| `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.test.tsx` | 新建 | 渲染测试：验证五栏正确渲染 + 无数据时不渲染空壳 |

---

### Task 1：后端 — 新增常量和辅助函数

**Files:**
- Modify: `packages/brain/src/routes/harness.js`（在 `getSystemPromptContent` 函数前，约第 786 行）

- [ ] **Step 1：在 `getSystemPromptContent` 函数定义之前插入以下常量和函数**

在 `packages/brain/src/routes/harness.js` 第 786 行 `async function getSystemPromptContent(taskType)` 之前，插入：

```js
const NODE_TO_SKILL = {
  planner: 'harness-planner',
  proposer: 'harness-contract-proposer',
  reviewer: 'harness-contract-reviewer',
  generator: 'harness-generator',
  run_sub_task: 'harness-generator',
  report: 'harness-report',
};

const NODE_SYSTEM_PROMPTS = {
  planner: '你是 harness-planner agent。按下面 SKILL 指令工作。',
  proposer: '你是 harness-contract-proposer agent。按下面 SKILL 指令工作。',
  reviewer: '你是 harness-contract-reviewer agent。按下面 SKILL 指令工作。',
  generator: '你是 harness-generator agent。按下面 SKILL 指令工作。',
  run_sub_task: '你是 harness-generator agent。按下面 SKILL 指令工作。',
  report: '你是 harness-report agent。按下面 SKILL 指令工作。',
};

const NODE_INPUT_FILE = {
  proposer: 'sprint-prd.md',
  reviewer: 'contract-draft.md',
  generator: 'task-plan.json',
  run_sub_task: 'task-plan.json',
};

const NODE_OUTPUT_FILE = {
  planner: 'sprint-prd.md',
  proposer: 'contract-draft.md',
  report: 'harness-report.md',
};

async function readSkillFile(skillName) {
  if (!skillName) return null;
  try {
    return await readFile(join(homedir(), '.claude-account1', 'skills', skillName, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
}

async function readSprintFile(sprintDir, filename) {
  if (!sprintDir || !filename) return null;
  try {
    return await readFile(join(REPO_ROOT, sprintDir, filename), 'utf8');
  } catch {
    return null;
  }
}
```

- [ ] **Step 2：验证语法**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
node --input-type=module < packages/brain/src/routes/harness.js 2>&1 | head -5
```

期望：无语法错误（可能有运行时错误如 "pool not found"，属正常）

- [ ] **Step 3：Commit**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
git add packages/brain/src/routes/harness.js
git commit -m "feat(brain): add NODE_TO_SKILL constants and readSkillFile/readSprintFile helpers"
```

---

### Task 2：后端 — 在 `buildLangGraphInfo()` 中 enrich 每个 step

**Files:**
- Modify: `packages/brain/src/routes/harness.js`（`buildLangGraphInfo()` 函数内，约第 940-967 行）

- [ ] **Step 1：在 checkpoints 查询块之后，`if (events.length === 0)` 判断之前，插入 task 查询**

找到以下代码块（约第 930-942 行）：
```js
  const checkpoints = {
    count: checkpointRows.length,
    latest_checkpoint_id: checkpointRows[0]?.checkpoint_id || null,
    state_available: checkpointRows.length > 0,
  };

  if (events.length === 0) {
```

在 `if (events.length === 0)` **之前**插入：

```js
  // Fetch task data for DB context and sprint_dir
  let taskData = null;
  let sprintDir = null;
  try {
    const { rows: taskRows } = await pool.query(
      `SELECT title, description, payload, journey_id FROM tasks WHERE id = $1::uuid`,
      [taskId]
    );
    if (taskRows[0]) {
      taskData = taskRows[0];
      sprintDir = taskRows[0].payload?.sprint_dir || null;
    }
  } catch (err) {
    console.warn(`[buildLangGraphInfo] task query failed: ${err.message}`);
  }
```

- [ ] **Step 2：将同步 `events.map(...)` 替换为 `await Promise.all(events.map(async ...))`**

找到（约第 944-967 行）：
```js
  // 把每条事件 normalize 成 step
  const steps = events.map((row, idx) => {
    const p = row.payload || {};
    // 从 review_verdict / evaluator_verdict 里取一个作为 verdict
    const verdict = p.review_verdict || p.evaluator_verdict || null;
    return {
      step_index: typeof p.step_index === 'number' ? p.step_index : idx + 1,
      node: p.node || 'unknown',
      verdict,
      review_round: p.review_round ?? null,
      eval_round: p.eval_round ?? null,
      review_verdict: p.review_verdict || null,
      evaluator_verdict: p.evaluator_verdict || null,
      pr_url: p.pr_url || null,
      // 多 WS 快照（用于前端每步展开时查看本步的多 PR 情况）
      workstreams: Array.isArray(p.workstreams) ? p.workstreams : null,
      pr_urls: Array.isArray(p.pr_urls) ? p.pr_urls : null,
      ws_verdicts: Array.isArray(p.ws_verdicts) ? p.ws_verdicts : null,
      error: p.error || null,
      timestamp: row.created_at,
      state_snapshot: p,
    };
  });
```

替换为：
```js
  // 把每条事件 normalize 成 step（async 以便并发读 skill/sprint 文件）
  const steps = await Promise.all(events.map(async (row, idx) => {
    const p = row.payload || {};
    const nodeName = p.node || 'unknown';
    // 从 review_verdict / evaluator_verdict 里取一个作为 verdict
    const verdict = p.review_verdict || p.evaluator_verdict || null;
    const skillName = NODE_TO_SKILL[nodeName] || null;
    const [skillContent, inputContent, outputContent] = await Promise.all([
      readSkillFile(skillName),
      readSprintFile(sprintDir, NODE_INPUT_FILE[nodeName]),
      readSprintFile(sprintDir, NODE_OUTPUT_FILE[nodeName]),
    ]);
    return {
      step_index: typeof p.step_index === 'number' ? p.step_index : idx + 1,
      node: nodeName,
      verdict,
      review_round: p.review_round ?? null,
      eval_round: p.eval_round ?? null,
      review_verdict: p.review_verdict || null,
      evaluator_verdict: p.evaluator_verdict || null,
      pr_url: p.pr_url || null,
      // 多 WS 快照（用于前端每步展开时查看本步的多 PR 情况）
      workstreams: Array.isArray(p.workstreams) ? p.workstreams : null,
      pr_urls: Array.isArray(p.pr_urls) ? p.pr_urls : null,
      ws_verdicts: Array.isArray(p.ws_verdicts) ? p.ws_verdicts : null,
      error: p.error || null,
      timestamp: row.created_at,
      state_snapshot: p,
      // Enriched context fields
      skill_name: skillName,
      system_prompt: NODE_SYSTEM_PROMPTS[nodeName] || null,
      skill_content: skillContent,
      input_content: inputContent,
      output_content: outputContent,
      db_context: taskData ? {
        task_id: taskId,
        title: taskData.title,
        description: (taskData.description || '').slice(0, 500),
        journey_id: taskData.journey_id,
        sprint_dir: sprintDir,
      } : null,
    };
  }));
```

- [ ] **Step 3：验证 API 返回新字段**

Brain 需要运行中。用有历史 run 的 task_id 验证：

```bash
curl -s "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=b249b808-9c18-4b0b-9fa8-1a52712dcef2" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const steps=d.langgraph?.steps||[];
console.log('steps count:', steps.length);
steps.forEach(s=>console.log(s.node,'| skill_name:',s.skill_name,'| system_prompt:',s.system_prompt?.slice(0,30),'| skill_content len:',s.skill_content?.length||0,'| input_content len:',s.input_content?.length||0,'| output_content len:',s.output_content?.length||0,'| db_context:',!!s.db_context));
"
```

期望：每个 step 的 `skill_name` 非 null，`skill_content` 长度 > 0，proposer/reviewer 的 `input_content` 长度 > 0。

- [ ] **Step 4：Commit**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
git add packages/brain/src/routes/harness.js
git commit -m "feat(brain): enrich LangGraph step with skill/input/output/db_context fields"
```

---

### Task 3：前端 DetailPage — 在 GAN round 展开区加"查看详情"链接

**Files:**
- Modify: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`

**目标：** 给 `LangGraphRoundCard` 加 `pipelineId` prop，在展开区的 proposer/reviewer 行各加一个链接。

- [ ] **Step 1：给 `LangGraphRoundCard` 加 `pipelineId` prop**

找到（约第 371-390 行）：
```tsx
function LangGraphRoundCard({
  roundLabel,
  firstNode,
  secondNode,
  first,
  second,
}: {
  roundLabel: string;
  firstNode: string;
  secondNode: string;
  first: LangGraphStep | null | undefined;
  second: LangGraphStep | null | undefined;
}) {
```

替换为：
```tsx
function LangGraphRoundCard({
  roundLabel,
  firstNode,
  secondNode,
  first,
  second,
  pipelineId,
}: {
  roundLabel: string;
  firstNode: string;
  secondNode: string;
  first: LangGraphStep | null | undefined;
  second: LangGraphStep | null | undefined;
  pipelineId: string;
}) {
```

同时在函数体开头（`const [expanded, setExpanded] = useState(false);` 之前）确保有 `useNavigate`：
```tsx
  const navigate = useNavigate();
```

（检查文件顶部是否已导入 `useNavigate`，若已有则跳过导入步骤）

- [ ] **Step 2：在展开区的 step 行加"查看详情"链接**

找到展开区（约第 430-445 行）：
```tsx
        <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-2">
          <div>
            <span className="font-semibold">{firstNode} step #{first?.step_index ?? '?'}</span>
            <span className="ml-2 text-slate-400">{formatTime(first?.timestamp || null)}</span>
            {first?.error && <pre className="mt-1 text-red-500 whitespace-pre-wrap">{first.error}</pre>}
          </div>
          <div>
            <span className="font-semibold">{secondNode} step #{second?.step_index ?? '?'}</span>
            <span className="ml-2 text-slate-400">{formatTime(second?.timestamp || null)}</span>
            {second?.error && <pre className="mt-1 text-red-500 whitespace-pre-wrap">{second.error}</pre>}
          </div>
        </div>
```

替换为：
```tsx
        <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{firstNode} step #{first?.step_index ?? '?'}</span>
            <span className="text-slate-400">{formatTime(first?.timestamp || null)}</span>
            {first?.step_index != null && (
              <button
                onClick={() => navigate(`/pipeline/${pipelineId}/step/${first.step_index}`)}
                className="ml-auto text-blue-600 dark:text-blue-400 hover:underline"
              >
                查看详情 →
              </button>
            )}
            {first?.error && <pre className="mt-1 text-red-500 whitespace-pre-wrap w-full">{first.error}</pre>}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{secondNode} step #{second?.step_index ?? '?'}</span>
            <span className="text-slate-400">{formatTime(second?.timestamp || null)}</span>
            {second?.step_index != null && (
              <button
                onClick={() => navigate(`/pipeline/${pipelineId}/step/${second.step_index}`)}
                className="ml-auto text-blue-600 dark:text-blue-400 hover:underline"
              >
                查看详情 →
              </button>
            )}
            {second?.error && <pre className="mt-1 text-red-500 whitespace-pre-wrap w-full">{second.error}</pre>}
          </div>
        </div>
```

- [ ] **Step 3：给 `LangGraphRoundList` 传 `pipelineId`，再传到 `LangGraphRoundCard`**

找到 `LangGraphRoundList` 函数签名（约第 456-462 行）：
```tsx
function LangGraphRoundList({
  title,
  rounds,
  nodePair,
}: {
  title: string;
  rounds: LangGraphRound[];
  nodePair: [string, string];
}) {
```

替换为：
```tsx
function LangGraphRoundList({
  title,
  rounds,
  nodePair,
  pipelineId,
}: {
  title: string;
  rounds: LangGraphRound[];
  nodePair: [string, string];
  pipelineId: string;
}) {
```

找到 `LangGraphRoundCard` 调用（约第 473-482 行）：
```tsx
            <LangGraphRoundCard
              key={`${title}-${r.round}-${i}`}
              roundLabel={`${title.split(' ')[0]} R${r.round}`}
              firstNode={nodePair[0]}
              secondNode={nodePair[1]}
              first={first}
              second={second}
            />
```

替换为：
```tsx
            <LangGraphRoundCard
              key={`${title}-${r.round}-${i}`}
              roundLabel={`${title.split(' ')[0]} R${r.round}`}
              firstNode={nodePair[0]}
              secondNode={nodePair[1]}
              first={first}
              second={second}
              pipelineId={pipelineId}
            />
```

- [ ] **Step 4：给 `LangGraphSection` 加 `pipelineId` prop，并传给 `LangGraphRoundList`**

找到（约第 641 行）：
```tsx
function LangGraphSection({ info }: { info: LangGraphInfo }) {
```

替换为：
```tsx
function LangGraphSection({ info, pipelineId }: { info: LangGraphInfo; pipelineId: string }) {
```

找到 `LangGraphRoundList` 调用（两处，GAN 对抗 + Fix 循环），各加 `pipelineId={pipelineId}`：
```tsx
      <LangGraphRoundList
        title="GAN 对抗"
        rounds={info.gan_rounds}
        nodePair={['proposer', 'reviewer']}
        pipelineId={pipelineId}
      />
```

（Fix 循环的 `LangGraphRoundList` 同样加 `pipelineId={pipelineId}`）

- [ ] **Step 5：在调用 `LangGraphSection` 处传入 `pipelineId`**

找到（约第 975 行）：
```tsx
          {data.langgraph?.enabled && <LangGraphSection info={data.langgraph} />}
```

替换为：
```tsx
          {data.langgraph?.enabled && <LangGraphSection info={data.langgraph} pipelineId={id!} />}
```

- [ ] **Step 6：TypeScript 编译检查**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
npx tsc --noEmit -p apps/dashboard/tsconfig.json 2>&1 | grep -E "error TS" | head -10
```

期望：0 个 error TS 错误。

- [ ] **Step 7：Commit**

```bash
git add apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx
git commit -m "feat(dashboard): add 查看详情 links to GAN round cards in LangGraph section"
```

---

### Task 4：前端 StepPage — 重写为五栏布局

**Files:**
- Modify: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx`（完整重写）
- Create: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.test.tsx`

- [ ] **Step 1：写失败测试（先 commit 为 failing）**

创建 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock fetch
function mockFetch(data: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  }) as any;
}

const MOCK_DETAIL = {
  planner_task_id: 'task-123',
  title: '测试 Sprint',
  steps: [],
  langgraph: {
    enabled: true,
    steps: [
      {
        step_index: 1,
        node: 'proposer',
        skill_name: 'harness-contract-proposer',
        system_prompt: '你是 harness-contract-proposer agent。按下面 SKILL 指令工作。',
        skill_content: '# SKILL: harness-contract-proposer\n测试内容',
        input_content: '# Sprint PRD\n测试 PRD 内容',
        output_content: '# Contract Draft\n测试合同内容',
        db_context: {
          task_id: 'task-123',
          title: '测试 Sprint',
          description: '测试描述',
          journey_id: null,
          sprint_dir: 'sprints/test',
        },
        verdict: null,
        review_round: 1,
        timestamp: '2026-06-10T10:00:00Z',
      },
    ],
    gan_rounds: [],
    fix_rounds: [],
  },
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderStepPage(taskId: string, stepIndex: number) {
  return render(
    <MemoryRouter initialEntries={[`/pipeline/${taskId}/step/${stepIndex}`]}>
      <Routes>
        <Route path="/pipeline/:id/step/:step" element={<HarnessPipelineStepPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// import after mock setup
import HarnessPipelineStepPage from './HarnessPipelineStepPage';

describe('HarnessPipelineStepPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders five context sections for LangGraph step', async () => {
    mockFetch(MOCK_DETAIL);
    renderStepPage('task-123', 1);
    // Wait for data
    expect(await screen.findByText('System Prompt')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('User Input')).toBeInTheDocument();
    expect(screen.getByText('DB Context')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('renders system prompt content', async () => {
    mockFetch(MOCK_DETAIL);
    renderStepPage('task-123', 1);
    expect(await screen.findByText(/你是 harness-contract-proposer agent/)).toBeInTheDocument();
  });

  it('does not render sections when content is null', async () => {
    const emptyStep = {
      ...MOCK_DETAIL,
      langgraph: {
        ...MOCK_DETAIL.langgraph,
        steps: [{
          ...MOCK_DETAIL.langgraph.steps[0],
          input_content: null,
          output_content: null,
          db_context: null,
        }],
      },
    };
    mockFetch(emptyStep);
    renderStepPage('task-123', 1);
    await screen.findByText('System Prompt');
    expect(screen.queryByText('User Input')).not.toBeInTheDocument();
    expect(screen.queryByText('DB Context')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2：运行测试确认 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
cd apps/dashboard && npx vitest run src/pages/harness-pipeline/HarnessPipelineStepPage.test.tsx 2>&1 | tail -20
```

期望：FAIL（HarnessPipelineStepPage 还没有五栏结构）

- [ ] **Step 3：Commit failing test**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
git add apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.test.tsx
git commit -m "test(dashboard): failing test for StepPage five-section layout"
```

- [ ] **Step 4：完整重写 `HarnessPipelineStepPage.tsx`**

用以下内容完全替换 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx`：

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Terminal,
  BookOpen,
  ArrowDownToLine,
  Database,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbContext {
  task_id: string;
  title: string;
  description: string;
  journey_id: string | null;
  sprint_dir: string | null;
}

interface LangGraphStep {
  step_index: number;
  node: string;
  skill_name: string | null;
  system_prompt: string | null;
  skill_content: string | null;
  input_content: string | null;
  output_content: string | null;
  db_context: DbContext | null;
  verdict: string | null;
  review_round: number | null;
  review_verdict: string | null;
  timestamp: string;
}

interface LegacyStep {
  step: number;
  label: string;
  status: string;
  input_content: string | null;
  system_prompt_content: string | null;
  output_content: string | null;
}

interface PipelineDetail {
  planner_task_id: string;
  title: string;
  steps: LegacyStep[];
  langgraph?: {
    enabled: boolean;
    steps: LangGraphStep[];
  };
}

// ─── ContextBlock ─────────────────────────────────────────────────────────────

interface ContextBlockProps {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  content: string | null;
  collapsible?: boolean;
  skillName?: string | null;
}

function ContextBlock({ title, icon: Icon, content, collapsible = false, skillName }: ContextBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 ${collapsible ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800' : ''}`}
        onClick={collapsible ? () => setExpanded(v => !v) : undefined}
      >
        <Icon size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          {title}
        </span>
        {skillName && (
          <span className="ml-2 text-xs font-mono text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 px-1.5 py-0.5 rounded">
            {skillName}
          </span>
        )}
        {collapsible && (
          <span className="ml-auto text-slate-400">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </div>

      {/* Body */}
      {(!collapsible || expanded) && (
        <div className="p-4 bg-white dark:bg-slate-900/30 max-h-[60vh] overflow-auto">
          <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── DbContextBlock ───────────────────────────────────────────────────────────

function DbContextBlock({ ctx }: { ctx: DbContext }) {
  const rows: [string, string | null][] = [
    ['task_id', ctx.task_id],
    ['title', ctx.title],
    ['description', ctx.description || null],
    ['journey_id', ctx.journey_id],
    ['sprint_dir', ctx.sprint_dir],
  ];

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
        <Database size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          DB Context
        </span>
      </div>
      <div className="p-4 bg-white dark:bg-slate-900/30">
        <table className="w-full text-xs font-mono">
          <tbody>
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <tr key={k} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-1.5 pr-4 text-slate-500 dark:text-slate-400 whitespace-nowrap w-28 align-top">{k}</td>
                <td className="py-1.5 text-slate-700 dark:text-slate-300 break-all">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HarnessPipelineStepPage() {
  const { id, step } = useParams<{ id: string; step: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PipelineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/brain/harness/pipeline-detail?planner_task_id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const stepNum = step ? parseInt(step, 10) : null;

  // Resolve step data: prefer LangGraph steps, fall back to legacy steps
  const lgStep: LangGraphStep | null =
    data?.langgraph?.enabled && stepNum != null
      ? (data.langgraph.steps.find(s => s.step_index === stepNum) ?? null)
      : null;

  const legacyStep: LegacyStep | null =
    !lgStep && stepNum != null
      ? (data?.steps.find(s => s.step === stepNum) ?? null)
      : null;

  // Normalise to display fields
  const systemPrompt = lgStep?.system_prompt ?? null;
  const skillName = lgStep?.skill_name ?? null;
  const skillContent = lgStep?.skill_content ?? null;
  const inputContent = lgStep?.input_content ?? legacyStep?.input_content ?? null;
  const outputContent = lgStep?.output_content ?? legacyStep?.output_content ?? null;
  const dbCtx = lgStep?.db_context ?? null;
  const nodeLabel = lgStep ? `${lgStep.node}${lgStep.review_round ? ` R${lgStep.review_round}` : ''}` : legacyStep?.label ?? '未知步骤';

  if (loading && !data) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500 dark:text-slate-400">加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button onClick={fetchDetail} className="mt-2 text-xs text-red-500 hover:underline">重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* 返回 */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate(`/pipeline/${id}`)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          ← 返回 Pipeline 详情
        </button>
      </div>

      {/* 标题 */}
      <div className="mb-5">
        <h1 className="text-base font-bold text-slate-900 dark:text-white">
          Step #{step} — {nodeLabel}
        </h1>
        {data?.title && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{data.title}</p>
        )}
      </div>

      {/* 五栏 */}
      <div className="flex flex-col gap-4">
        <ContextBlock
          title="System Prompt"
          icon={Terminal}
          content={systemPrompt}
        />
        <ContextBlock
          title="Skills"
          icon={BookOpen}
          content={skillContent}
          collapsible
          skillName={skillName}
        />
        <ContextBlock
          title="User Input"
          icon={ArrowDownToLine}
          content={inputContent}
        />
        {dbCtx && <DbContextBlock ctx={dbCtx} />}
        <ContextBlock
          title="Output"
          icon={ArrowUpFromLine}
          content={outputContent ?? (lgStep?.verdict ? `verdict: ${lgStep.verdict}` : null)}
        />
      </div>

      {!lgStep && !legacyStep && !loading && (
        <div className="text-sm text-slate-400 dark:text-slate-500 py-12 text-center">
          未找到 Step #{step} 的数据
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5：运行测试确认 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context/apps/dashboard
npx vitest run src/pages/harness-pipeline/HarnessPipelineStepPage.test.tsx 2>&1 | tail -20
```

期望：3 tests passed

- [ ] **Step 6：TypeScript 编译检查**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
npx tsc --noEmit -p apps/dashboard/tsconfig.json 2>&1 | grep "error TS" | head -10
```

期望：0 errors

- [ ] **Step 7：Commit**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
git add apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx
git commit -m "feat(dashboard): rewrite StepPage with 5-section context layout (Lucide icons, skills expandable)"
```

---

### Task 5：Learning 文档 + Push + PR

**Files:**
- Create: `docs/learnings/cp-06101044-pipeline-step-rich-context.md`

- [ ] **Step 1：写 Learning 文档**

创建 `docs/learnings/cp-06101044-pipeline-step-rich-context.md`：

```markdown
# Learning: Pipeline 步骤详情页执行上下文可见性

## 根本原因

`buildLangGraphInfo()` 的 step map 是同步的，只存了最少的事件 payload 字段（node名+verdict），
没有读取 skill 文件内容和 sprint dir 产物文件。前端 StepPage 有三栏 UI 骨架但数据全空。

## 下次预防

- [ ] LangGraph step 的 `emitLangGraphStep` 只保存事件标识，丰富的上下文（skill 内容、文件）应在 **API 层**按需读取，不要存进 events 表（避免 JSONB 行过大）
- [ ] 新增 `buildLangGraphInfo()` 字段时，要同步更新 `pipeline-detail-langgraph.integration.test.js` 的期望字段列表
- [ ] 前端组件"暂无数据"是信号：有 UI 骨架但没有数据流——优先检查 API 是否返回空字段
```

- [ ] **Step 2：Commit learning**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
git add docs/learnings/cp-06101044-pipeline-step-rich-context.md
git commit -m "docs(learning): Pipeline 步骤详情页执行上下文可见性"
```

- [ ] **Step 3：Push 并开 PR**

```bash
cd /Users/administrator/worktrees/cecelia/cp-06101044-pipeline-step-rich-context
git push -u origin cp-0610104533-cp-06101044-pipeline-step-rich-context
gh pr create \
  --title "feat(dashboard+brain): Pipeline 步骤详情页五栏执行上下文展示" \
  --body "$(cat <<'EOF'
## Summary
- 后端 `buildLangGraphInfo()` 为每个 LangGraph step 异步填充 skill_name / system_prompt / skill_content / input_content / output_content / db_context 六个字段
- 前端 StepPage 重写为五栏叠加布局（Terminal / BookOpen / ArrowDownToLine / Database / ArrowUpFromLine），Skills 区块默认折叠可展开
- DetailPage GAN round 展开区加"查看详情 →"导航链接

## Test plan
- [ ] 打开 `http://perfect21:5211/pipeline/b249b808-9c18-4b0b-9fa8-1a52712dcef2`
- [ ] 展开 GAN R3，点击"查看详情 →"进入 proposer step 详情页
- [ ] 验证：System Prompt / Skills / User Input / DB Context / Output 五栏有真实内容
- [ ] Skills 区块默认折叠，点击可展开

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4：等 CI 通过后 merge**

```bash
# 等 CI
sleep 30
gh pr checks --watch

# CI 全绿后 merge
gh pr merge --squash --auto
```
