# Pipeline Step Rich Context — Design Spec

## 目标

让 `/pipeline/:id/step/:stepIndex` 页面对每个 LangGraph 节点显示完整执行上下文：system prompt、skills（可展开）、user input、DB context、output。现状全是"暂无数据"。

## 改动范围（3 个文件）

### 1. `packages/brain/src/routes/harness.js`

**改动位置**：`buildLangGraphInfo()` 函数

新增常量（函数外部）：
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
```

**`buildLangGraphInfo()` 内部**，在 `events` 和 `checkpoints` 查询后，新增一次 tasks 查询：

```js
let taskData = null;
let sprintDir = null;
try {
  const { rows } = await pool.query(
    `SELECT title, description, payload, journey_id FROM tasks WHERE id = $1::uuid`,
    [taskId]
  );
  if (rows[0]) { taskData = rows[0]; sprintDir = rows[0].payload?.sprint_dir; }
} catch (err) {
  console.warn(`[buildLangGraphInfo] task query failed: ${err.message}`);
}
```

step 构建从同步 `.map()` 改为 `await Promise.all(events.map(async (row, idx) => {...})))`，每个 step 增加：

```js
skill_name: NODE_TO_SKILL[nodeName] || null,
system_prompt: NODE_SYSTEM_PROMPTS[nodeName] || null,
skill_content: await readSkillFile(NODE_TO_SKILL[nodeName]),   // 读 ~/.claude-account1/skills/<skill>/SKILL.md
input_content: await readSprintFile(sprintDir, NODE_INPUT_FILE[nodeName]),
output_content: await readSprintFile(sprintDir, NODE_OUTPUT_FILE[nodeName]),
db_context: taskData ? {
  task_id: taskId,
  title: taskData.title,
  description: (taskData.description || '').slice(0, 500),
  journey_id: taskData.journey_id,
  sprint_dir: sprintDir,
} : null,
```

两个辅助函数（模块级）：
- `readSkillFile(skillName)` → 读 `~/.claude-account1/skills/<skillName>/SKILL.md`，失败返回 null
- `readSprintFile(sprintDir, filename)` → 读 `REPO_ROOT/<sprintDir>/<filename>`，失败返回 null

### 2. `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`

**改动位置**：`GanRoundCard` 组件展开区块

为 `first`（proposer）和 `second`（reviewer）各加一个"查看详情 →"按钮：

```tsx
<button
  onClick={() => navigate(`/pipeline/${pipelineId}/step/${step.step_index}`)}
  className="text-xs text-blue-600 hover:underline"
>
  查看详情 →
</button>
```

需要：
- `GanRoundCard` 接收 `pipelineId` prop（从父组件传入）
- 在展开区块的 step 行末尾加链接

### 3. `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx`

**完整重写渲染层**（接口扩展 + 五栏 UI）

**接口扩展**：

```ts
interface LangGraphStep {
  step_index: number;
  node: string;
  skill_name: string | null;
  system_prompt: string | null;
  skill_content: string | null;
  input_content: string | null;
  output_content: string | null;
  db_context: {
    task_id: string;
    title: string;
    description: string;
    journey_id: string | null;
    sprint_dir: string | null;
  } | null;
  verdict: string | null;
  review_round: number | null;
  timestamp: string;
}

interface PipelineDetail {
  planner_task_id: string;
  title: string;
  steps: PipelineStep[];
  langgraph?: {
    enabled: boolean;
    steps: LangGraphStep[];
  };
}
```

**数据查找逻辑**：
- 若 `data.langgraph?.enabled`，从 `langgraph.steps` 找 `step_index === stepNum`
- 否则从 `steps` 找 `step === stepNum`（兼容旧路径）

**五栏组件 `ContextBlock`**：

```
props: title, icon (Lucide component), content, collapsible?, defaultExpanded?
```

- `collapsible=false`（默认）：直接显示内容
- `collapsible=true`：显示 skill 名 + 展开/收起按钮，展开后显示全文
- 无内容 → 不渲染（条件渲染）
- 内容区：`max-h-[60vh] overflow-auto`，`pre` + monospace + `whitespace-pre-wrap`

**页面布局（从上到下）**：

```
1. [Terminal]         System Prompt      → system_prompt
2. [BookOpen]         Skills             → skill_name + skill_content（collapsible, 默认折叠）
3. [ArrowDownToLine]  User Input         → input_content
4. [Database]         DB Context         → db_context（格式化为键值对）
5. [ArrowUpFromLine]  Output             → output_content 或 verdict 文字
```

顶部保留：返回按钮 + 页面标题（节点名 + round 信息）。

## 数据流

```
task_id (URL param)
  → GET /api/brain/harness/pipeline-detail?planner_task_id=<id>
  → data.langgraph.steps[step_index - 1]
  → 五栏渲染
```

## 不包含

- 不改 `emitLangGraphStep` emit 内容（无需改 emit，从 sprint dir 读文件即可）
- 不新增 DB 表或字段
- 不改旧 task-based steps 路径

## 验收

1. `langgraph.steps[].skill_content` 对 proposer/reviewer 非 null
2. `langgraph.steps[].input_content` 对 proposer 非 null（sprint-prd.md 存在时）
3. `/pipeline/:id/step/:stepIndex` 页面五栏正确渲染
4. Skills 区块可展开/折叠
5. CI 全绿
