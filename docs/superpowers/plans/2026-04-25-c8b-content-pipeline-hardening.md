# Brain v2 C8b — content-pipeline 真图加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已存在的 content-pipeline 6 节点真图加 3 个加固 — 6 节点幂等门 + PgCheckpointer 默认化 + stateHasError 短路（仅非 verdict 节点）。

**Architecture:** 不动现有 22 channels / NODE_CONFIGS / verdict 路由 / round>=3 兜底。在 `runDockerNode` 顶部注入幂等门（`cfg.outputs[0]` 兜底取 primary output）；`compileContentPipelineApp` 改 async 默认走 `getPgCheckpointer`；3 个非 verdict 节点的 plain edge 改 conditional edge 加 `stateHasError` 短路。verdict 节点（copy_review/image_review）完全不动，docker flake 由 round>=3 兜底承担。

**Tech Stack:** LangGraph JS（`@langchain/langgraph` StateGraph + Annotation + checkpoint）、PostgresSaver（`getPgCheckpointer` 单例，C7 已建立）、vitest（mock pg + mock executor）。复用 C8a (PR #2621) 模式：参照 `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js` 的 mock 模板。

**Spec:** `docs/superpowers/specs/2026-04-25-c8b-content-pipeline-hardening-design.md`
**Brain task:** `d5434582-f6ca-45fa-bb04-78e1b090d0fe`
**worktree:** `/Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph`
**branch:** `cp-0425203339-c8b-content-pipeline-graph`

---

## File Structure

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/brain/src/workflows/content-pipeline.graph.js` | Modify | (1) `compileContentPipelineApp` 改 async + 默认 `getPgCheckpointer` (L334)；(2) `runDockerNode` 顶部加幂等门 (L495)；(3) `buildContentPipelineGraph` 内 3 个非 verdict edge 改 conditional + `stateHasError` (L279-322) |
| `packages/brain/src/workflows/content-pipeline-runner.js` | Modify | L115 直调改 await |
| `packages/brain/src/__tests__/content-pipeline-graph.test.js` | Modify | 7 处直调改 await + 顶部 mock pg-checkpointer + 各 it 改 async |
| `packages/brain/src/__tests__/content-pipeline-graph-docker.test.js` | Modify | L585 1 处改 await + 顶部 mock pg-checkpointer |
| `packages/brain/src/__tests__/content-pipeline-graph-resume.test.js` | Create | 新建 ~150 行 / 3 测：runDockerNode 幂等门 + PgCheckpointer 默认 + stateHasError 短路 |
| `docs/learnings/cp-0425203339-c8b-content-pipeline-graph.md` | Create | Learning：根因 + 5 条预防 checklist |

---

## Task 1: compileContentPipelineApp 改 async + 默认 PgCheckpointer + 全 caller await

**Files:**
- Modify: `packages/brain/src/workflows/content-pipeline.graph.js:334-338`
- Modify: `packages/brain/src/workflows/content-pipeline-runner.js:115`
- Modify: `packages/brain/src/__tests__/content-pipeline-graph.test.js:33,40,56,81,104,140,150`（7 处）
- Modify: `packages/brain/src/__tests__/content-pipeline-graph-docker.test.js:585`（1 处）

- [ ] **Step 1.1: 在 graph.js 顶部加 getPgCheckpointer import**

Edit `packages/brain/src/workflows/content-pipeline.graph.js`，在现有 imports（约 L24 附近 `MemorySaver` import 旁）加：

```js
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
```

- [ ] **Step 1.2: 改 compileContentPipelineApp 为 async + 默认 PgCheckpointer**

替换 L334-L338：

旧：
```js
export function compileContentPipelineApp({ overrides, checkpointer } = {}) {
  const graph = buildContentPipelineGraph(overrides);
  const saver = checkpointer || new MemorySaver();
  return graph.compile({ checkpointer: saver });
}
```

新：
```js
/**
 * 编译 graph 为可调用 app。
 *
 * @param {object} [opts]
 * @param {object} [opts.overrides]    传给 buildContentPipelineGraph
 * @param {object} [opts.checkpointer] BaseCheckpointSaver；不传则用 PgCheckpointer 单例（v2 C8b 默认）
 */
export async function compileContentPipelineApp({ overrides, checkpointer } = {}) {
  const graph = buildContentPipelineGraph(overrides);
  const saver = checkpointer || (await getPgCheckpointer());
  return graph.compile({ checkpointer: saver });
}
```

- [ ] **Step 1.3: 改 content-pipeline-runner.js L115 加 await**

Edit `packages/brain/src/workflows/content-pipeline-runner.js`，把：

```js
  const app = compileContentPipelineApp({
```

改为：

```js
  const app = await compileContentPipelineApp({
```

- [ ] **Step 1.4: 改 content-pipeline-graph.test.js 顶部加 mock + 7 处直调改 await**

Edit `packages/brain/src/__tests__/content-pipeline-graph.test.js`，在文件顶部 imports 之后（约 L20 附近）加：

```js
// 防真连 pg：compileContentPipelineApp 改 async 默认走 PgCheckpointer
vi.mock('../workflows/orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
  }),
}));
```

7 处直调（L33/40/56/81/104/140/150）：每处 `compileContentPipelineApp(...)` → `await compileContentPipelineApp(...)`。如果在 `it('...', () => {})` 块内，把 `() =>` 改 `async () =>`。

- [ ] **Step 1.5: 改 content-pipeline-graph-docker.test.js 顶部加 mock + L585 改 await**

Edit `packages/brain/src/__tests__/content-pipeline-graph-docker.test.js`，顶部加同款 vi.mock（同 Step 1.4 的 mock 块），L585 直调加 await（如有 it 改 async）。

- [ ] **Step 1.6: 跑全 graph + docker test 验全 pass**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src/__tests__/content-pipeline-graph.test.js \
                  packages/brain/src/__tests__/content-pipeline-graph-docker.test.js 2>&1 | tail -10
```
Expected: all tests pass（数字以现有为准，不引入回归）。

- [ ] **Step 1.7: node --check 验语法**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  node --check packages/brain/src/workflows/content-pipeline.graph.js && \
  node --check packages/brain/src/workflows/content-pipeline-runner.js
```
Expected: 无输出。

- [ ] **Step 1.8: Commit**

```bash
git add packages/brain/src/workflows/content-pipeline.graph.js \
        packages/brain/src/workflows/content-pipeline-runner.js \
        packages/brain/src/__tests__/content-pipeline-graph.test.js \
        packages/brain/src/__tests__/content-pipeline-graph-docker.test.js && \
  git commit -m "refactor(brain-v2-c8b): compileContentPipelineApp 改 async + 默认 PgCheckpointer

- compileContentPipelineApp signature breaking change (sync → async)
- 默认 checkpointer 从 MemorySaver 改为 getPgCheckpointer() 单例（C8b 加固）
- 所有 caller 改 await: runner.js (1) + content-pipeline-graph.test.js (7) +
  content-pipeline-graph-docker.test.js (1)
- 测试顶部 mock pg-checkpointer 防真连 pg

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: runDockerNode 加 6 节点幂等门

**Files:**
- Modify: `packages/brain/src/workflows/content-pipeline.graph.js:495`（runDockerNode 顶部）

- [ ] **Step 2.1: 写 fail test 验幂等门触发**

Append to `packages/brain/src/__tests__/content-pipeline-graph-resume.test.js`（如文件不存在先 create with 顶部 imports + mock 模板，参照 C8a `harness-initiative-graph.test.js` L1-L40）：

```js
describe('runDockerNode resume idempotency gate', () => {
  it('skips spawn when state already has primary output (research.findings_path)', async () => {
    const mockExecutor = vi.fn();
    const fakeTask = { id: 'resume-test-1', payload: {} };
    const nodes = createContentDockerNodes(mockExecutor, fakeTask, {});
    const stateWithOutput = {
      pipeline_id: 'pipe-1',
      output_dir: '/tmp/p',
      findings_path: '/tmp/p/research/findings.md',  // 幂等门触发字段
    };
    const delta = await nodes.research(stateWithOutput);
    expect(mockExecutor).not.toHaveBeenCalled();
    expect(delta.findings_path).toBe('/tmp/p/research/findings.md');
    expect(delta.meta?.resumed).toBe(true);
  });
});
```

注意 `createContentDockerNodes` 的 nodes 是节点函数对象（key=node name → fn），调 `nodes.research(state)` 直接调 makeNode 包的节点函数。

- [ ] **Step 2.2: Run test, expect FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src/__tests__/content-pipeline-graph-resume.test.js -t "runDockerNode resume" 2>&1 | tail -10
```
Expected: FAIL — `mockExecutor` 仍被调（当前无幂等门）。

- [ ] **Step 2.3: 在 runDockerNode 顶部加幂等门**

Edit `packages/brain/src/workflows/content-pipeline.graph.js` L495 区段，在 `async function runDockerNode(nodeName, state) {` 函数体首句（cfg 取得后）加：

旧：
```js
  async function runDockerNode(nodeName, state) {
    const cfg = NODE_CONFIGS[nodeName];
    console.log(`[content-pipeline-graph] node=${nodeName} task=${taskId} starting docker execution`);
```

新：
```js
  async function runDockerNode(nodeName, state) {
    const cfg = NODE_CONFIGS[nodeName];

    // C8b 幂等门：state 已有该节点 primary output → 跳过 docker spawn
    // （C6 / C8a 教训：LangGraph resume 会 replay 上次未完成节点 → 重 spawn 烧容器）
    const primaryField = cfg.outputs[0];
    if (primaryField && state[primaryField]) {
      console.log(`[content-pipeline-graph] node=${nodeName} task=${taskId} resume skip (state.${primaryField} exists)`);
      return {
        output: '',
        error: null,
        success: true,
        meta: { resumed: true, prompt_sent: '', raw_stdout: '', raw_stderr: '', exit_code: null, duration_ms: 0, container_id: null },
      };
    }

    console.log(`[content-pipeline-graph] node=${nodeName} task=${taskId} starting docker execution`);
```

- [ ] **Step 2.4: Run test, expect PASS**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src/__tests__/content-pipeline-graph-resume.test.js -t "runDockerNode resume" 2>&1 | tail -10
```
Expected: 1 test pass。

- [ ] **Step 2.5: 跑全 graph + docker test 验无回归**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src/__tests__/content-pipeline-graph.test.js \
                  packages/brain/src/__tests__/content-pipeline-graph-docker.test.js 2>&1 | tail -10
```
Expected: 0 fail。

- [ ] **Step 2.6: Commit**

```bash
git add packages/brain/src/workflows/content-pipeline.graph.js \
        packages/brain/src/__tests__/content-pipeline-graph-resume.test.js && \
  git commit -m "feat(brain-v2-c8b): runDockerNode 6 节点幂等门 + 1 resume test

cfg.outputs[0] 兜底取每节点 primary output：
- research: findings_path
- copywrite: copy_path
- copy_review: copy_review_feedback
- generate / image_review / export: 各自首字段

state 已有 → 跳过 docker spawn 返回 { resumed: true } meta
解 LangGraph resume 重 spawn 烧容器（C6 / C8a 教训）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: stateHasError 短路（仅 3 个非 verdict 节点）

**Files:**
- Modify: `packages/brain/src/workflows/content-pipeline.graph.js:262-325`（buildContentPipelineGraph）

- [ ] **Step 3.1: 写 fail test 验 error 短路**

Append to `packages/brain/src/__tests__/content-pipeline-graph-resume.test.js`：

```js
describe('stateHasError short-circuit (non-verdict nodes only)', () => {
  it('research error → graph END without invoking copywrite', async () => {
    const calls = [];
    const overrides = {
      research:     async () => { calls.push('research'); return { error: 'docker died' }; },
      copywrite:    async () => { calls.push('copywrite'); return {}; },
      copy_review:  async () => { calls.push('copy_review'); return { copy_review_verdict: 'APPROVED' }; },
      generate:     async () => { calls.push('generate'); return {}; },
      image_review: async () => { calls.push('image_review'); return { image_review_verdict: 'PASS' }; },
      export:       async () => { calls.push('export'); return {}; },
    };
    const app = await compileContentPipelineApp({ overrides });
    const out = await app.invoke(
      { pipeline_id: 'p1', keyword: 'k', output_dir: '/tmp' },
      { configurable: { thread_id: 'short-circuit-test' } }
    );
    expect(calls).toEqual(['research']);  // 仅 research 跑，error → END
    expect(out.error).toBe('docker died');
  });

  it('verdict node (copy_review) error does NOT short-circuit (round>=3 兜底承担)', async () => {
    // 验证 verdict 节点不嵌 stateHasError：copy_review 即使 state.error 也走 verdict 路由
    // 这个测试不强求 path，只确认 graph 不在 copy_review 后立即 END
    const calls = [];
    const overrides = {
      research:     async () => { calls.push('research'); return { findings_path: '/tmp/r' }; },
      copywrite:    async () => { calls.push('copywrite'); return { copy_path: '/tmp/c' }; },
      copy_review:  async () => { calls.push('copy_review'); return { copy_review_verdict: 'APPROVED', error: 'flake' }; },
      generate:     async () => { calls.push('generate'); return { images_dir: '/tmp/g' }; },
      image_review: async () => { calls.push('image_review'); return { image_review_verdict: 'PASS' }; },
      export:       async () => { calls.push('export'); return { final_post_path: '/tmp/e' }; },
    };
    const app = await compileContentPipelineApp({ overrides });
    await app.invoke(
      { pipeline_id: 'p2', keyword: 'k', output_dir: '/tmp' },
      { configurable: { thread_id: 'verdict-no-short-circuit-test' } }
    );
    // copy_review 后必须流到 generate（verdict APPROVED），证明 verdict 节点 error 不短路
    expect(calls).toContain('generate');
  });
});
```

- [ ] **Step 3.2: Run test, expect FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src/__tests__/content-pipeline-graph-resume.test.js -t "stateHasError" 2>&1 | tail -15
```
Expected: 第一个测试 fail（research error 时 calls 含 copywrite，因当前 plain edge 不短路）；第二个测试可能 pass（当前行为已是不短路）。

- [ ] **Step 3.3: 改 buildContentPipelineGraph 加 stateHasError 短路**

Edit `packages/brain/src/workflows/content-pipeline.graph.js` 在 `buildContentPipelineGraph` 函数前加 helper：

```js
function stateHasError(state) { return state.error ? 'error' : 'ok'; }
```

然后改 L279-L322 的 graph builder：

旧：
```js
    .addEdge(START, 'research')
    .addEdge('research', 'copywrite')
    .addEdge('copywrite', 'copy_review')
    .addConditionalEdges(
      'copy_review',
      (state) => { /* verdict 路由 */ },
      { generate: 'generate', copywrite: 'copywrite' },
    )
    .addEdge('generate', 'image_review')
    .addConditionalEdges(
      'image_review',
      (state) => { /* verdict 路由 */ },
      { export: 'export', generate: 'generate' },
    )
    .addEdge('export', END);
```

新：
```js
    .addEdge(START, 'research')
    // C8b 非 verdict 节点：error 短路（research/copywrite/generate）
    .addConditionalEdges('research', stateHasError, { error: END, ok: 'copywrite' })
    .addConditionalEdges('copywrite', stateHasError, { error: END, ok: 'copy_review' })
    // verdict 节点 copy_review 保留原 verdict 路由（round>=3 兜底承担 docker flake）
    .addConditionalEdges(
      'copy_review',
      (state) => { /* 原 verdict 路由（含 round>=3 兜底）— 完全不动 */ },
      { generate: 'generate', copywrite: 'copywrite' },
    )
    // C8b 非 verdict 节点：error 短路
    .addConditionalEdges('generate', stateHasError, { error: END, ok: 'image_review' })
    // verdict 节点 image_review 保留原 verdict 路由
    .addConditionalEdges(
      'image_review',
      (state) => { /* 原 verdict 路由 — 完全不动 */ },
      { export: 'export', generate: 'generate' },
    )
    .addEdge('export', END);
```

注意：copy_review / image_review 的 verdict 路由函数体**完全保留原代码**，只字不改。仅改 plain `.addEdge('research','copywrite')` / `.addEdge('copywrite','copy_review')` / `.addEdge('generate','image_review')` 这 3 处为 conditional + stateHasError。

- [ ] **Step 3.4: Run test, expect PASS**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src/__tests__/content-pipeline-graph-resume.test.js -t "stateHasError" 2>&1 | tail -15
```
Expected: 2 测全 pass。

- [ ] **Step 3.5: 跑全 graph + docker test 验无回归**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src/__tests__/content-pipeline-graph.test.js \
                  packages/brain/src/__tests__/content-pipeline-graph-docker.test.js \
                  packages/brain/src/__tests__/content-pipeline-graph-resume.test.js 2>&1 | tail -10
```
Expected: 0 fail。

- [ ] **Step 3.6: Commit**

```bash
git add packages/brain/src/workflows/content-pipeline.graph.js \
        packages/brain/src/__tests__/content-pipeline-graph-resume.test.js && \
  git commit -m "feat(brain-v2-c8b): stateHasError 短路（仅 3 个非 verdict 节点）+ 2 测

非 verdict 节点 (research/copywrite/generate) 的 plain edge 改 conditional + stateHasError：
任一节点 state.error 真填 → 立即 END，不再下游节点拿空数据继续 spawn。

verdict 节点 (copy_review/image_review) 完全不动：
docker flake 让 state.error 同时填 verdict，原 round>=3 兜底吸收 flake 自愈，
强行 error → END 反而让 pipeline 在 R3 任一次 flake 死透（比当前更脆）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: PgCheckpointer 默认化 resume 测试 + 全测验收

**Files:**
- Modify: `packages/brain/src/__tests__/content-pipeline-graph-resume.test.js`（补 1 测）

- [ ] **Step 4.1: 写 PgCheckpointer 默认化测试**

Append to `packages/brain/src/__tests__/content-pipeline-graph-resume.test.js`：

```js
describe('compileContentPipelineApp default PgCheckpointer', () => {
  it('不传 checkpointer 时调 getPgCheckpointer 单例', async () => {
    // mock getPgCheckpointer 是 vi.hoisted 顶部写好的；这里验证它被调用
    const { getPgCheckpointer } = await import('../workflows/orchestrator/pg-checkpointer.js');
    getPgCheckpointer.mockClear();
    const app = await compileContentPipelineApp();
    expect(getPgCheckpointer).toHaveBeenCalledTimes(1);
    expect(typeof app.invoke).toBe('function');
  });

  it('传 checkpointer 时不调 getPgCheckpointer', async () => {
    const { getPgCheckpointer } = await import('../workflows/orchestrator/pg-checkpointer.js');
    getPgCheckpointer.mockClear();
    const customSaver = {
      get: vi.fn(), put: vi.fn(), setup: vi.fn(),
      list: vi.fn().mockResolvedValue([]), getTuple: vi.fn(), putWrites: vi.fn(),
    };
    const app = await compileContentPipelineApp({ checkpointer: customSaver });
    expect(getPgCheckpointer).not.toHaveBeenCalled();
    expect(typeof app.invoke).toBe('function');
  });
});
```

- [ ] **Step 4.2: Run test, expect PASS**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src/__tests__/content-pipeline-graph-resume.test.js 2>&1 | tail -10
```
Expected: 全部 resume test pass（约 5 测：runDockerNode 1 + stateHasError 2 + PgCheckpointer 2）。

- [ ] **Step 4.3: 跑 5 条 DoD manual: 命令独立验**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/content-pipeline.graph.js','utf8');if(!c.includes('resume skip'))process.exit(1);console.log('DoD1 OK');" && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/content-pipeline.graph.js','utf8');if(!c.includes('getPgCheckpointer'))process.exit(1);console.log('DoD2 OK');" && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/content-pipeline.graph.js','utf8');if(!c.includes('stateHasError'))process.exit(1);console.log('DoD3 OK');" && \
  node -e "require('fs').accessSync('packages/brain/src/__tests__/content-pipeline-graph-resume.test.js');console.log('DoD5 OK');"
```
Expected: 4 行 OK。DoD#4（resume test pass）已在 Step 4.2 验。

- [ ] **Step 4.4: 跑全 brain test suite 抽查 regression**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  npx vitest run packages/brain/src 2>&1 | tail -10
```
Expected: fail 数与 main 上同期一致（preexisting fail 接受，无 C8b 引入）。

- [ ] **Step 4.5: Commit**

```bash
git add packages/brain/src/__tests__/content-pipeline-graph-resume.test.js && \
  git commit -m "test(brain-v2-c8b): PgCheckpointer 默认化 2 测 + 全 DoD 验

不传 checkpointer 时调 getPgCheckpointer，传时不调；
全 5 DoD manual: 命令独立跑过。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Learning + spec DoD 标 [x]

**Files:**
- Create: `docs/learnings/cp-0425203339-c8b-content-pipeline-graph.md`
- Modify: `docs/superpowers/specs/2026-04-25-c8b-content-pipeline-hardening-design.md`（DoD 5 项标 [x]）

- [ ] **Step 5.1: 写 Learning（learning format gate 强制要求 ### 章节）**

Create `docs/learnings/cp-0425203339-c8b-content-pipeline-graph.md`：

```markdown
# Learning — C8b content-pipeline 真图加固

## 背景
PRD: docs/superpowers/specs/2026-04-25-c8b-content-pipeline-hardening-design.md
Brain task: d5434582-f6ca-45fa-bb04-78e1b090d0fe
分支: cp-0425203339-c8b-content-pipeline-graph

## 干了什么
content-pipeline.graph.js（已是 6 节点真图）加 3 加固：
- runDockerNode 顶部加 6 节点幂等门 (cfg.outputs[0] 兜底取 primary output)
- compileContentPipelineApp 改 async + 默认 getPgCheckpointer
- 3 个非 verdict 节点 (research/copywrite/generate) plain edge 改 conditional + stateHasError 短路
- verdict 节点 (copy_review/image_review) 完全不动（保留 round>=3 兜底）

## ⚠️ Handoff §4 PRD 错误
原 handoff §4 假设 content-pipeline 是 625 行单 function，事实已是 C5 完成的 6 节点真图。
入口（research subagent 调研发现）：

### 根本原因
LangGraph resume 时会 replay 上次未完成节点 → 重 spawn 起重复容器，烧 docker / LLM / 时间。
原 compileContentPipelineApp 默认 MemorySaver → Brain 重启即丢 state，所有持久化能力依赖 caller 显式传 checkpointer。
原 buildContentPipelineGraph 的 plain edge 在节点 error 时仍按拓扑流到下游 → 下游拿空数据继续 spawn。
verdict 节点（copy_review/image_review）docker flake 设 state.error 但保留 verdict — 直接 error → END 会破坏 round>=3 兜底语义。

### 下次预防
- [ ] 加新 LangGraph 真图节点时，runDockerNode 顶部模板化加幂等门（cfg.outputs[0] 兜底）
- [ ] compileXxxApp 默认应走 getPgCheckpointer 单例（不依赖 caller 显式传）
- [ ] plain addEdge 改 conditional + stateHasError 仅适用于"错了就该 END"的非 verdict 节点
- [ ] verdict 节点（含 round 兜底）docker flake 由 verdict 路由本身吸收，不要前置 stateHasError
- [ ] handoff PRD 与代码现状脱节时，research subagent 必须先验代码现状再启动 brainstorming
```

- [ ] **Step 5.2: spec DoD 5 项已在草稿阶段标 [x]，验证仍是 [x]**

```bash
cd /Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph && \
  grep -cE '^- \[x\] `\[BEHAVIOR\]`|^- \[x\] `\[ARTIFACT\]`' docs/superpowers/specs/2026-04-25-c8b-content-pipeline-hardening-design.md
```
Expected: 5（4 BEHAVIOR + 1 ARTIFACT 全 [x]）。如果不是 5，把缺的标 [x]。

- [ ] **Step 5.3: Commit Learning**

```bash
git add docs/learnings/cp-0425203339-c8b-content-pipeline-graph.md && \
  git commit -m "docs(brain-v2-c8b): learning — content-pipeline 加固 + 5 条预防

5 条预防 checklist：runDockerNode 模板化幂等门 / compileXxxApp 默认
PgCheckpointer / plain addEdge 改 conditional 仅非 verdict / verdict 节点
保留 round 兜底 / handoff 与代码脱节时先 research 再 brainstorm。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 完成判据

- 5 commit（Task 1-5 各 1）
- 全 brain test 0 新 fail（preexisting fail 接受）
- 5 DoD manual: 全过
- node --check 3 个核心文件
- 5 文件改动（content-pipeline.graph.js / runner.js / 2 旧 test / 1 新 test + Learning）

---

## Self-Review

**Spec coverage 检查**：
- spec §3.1 幂等门 → Task 2
- spec §3.2 PgCheckpointer 默认化 → Task 1（含全 caller 改 await）
- spec §3.3 stateHasError（仅非 verdict） → Task 3
- spec §3.4 测试 → Task 2/3/4 各覆盖一类
- spec §4 DoD 5 项 → Task 4/5 全验
- spec §5 Out of scope → 各 task 注明不动 verdict 路由 / 22 channels / shim

**Placeholder scan**：
- 无 TBD / TODO / "implement later"
- 所有节点函数 / 测试代码完整给出
- 所有 Run 命令含 Expected
- DoD 测试命令完整 paste-ready

**Type 一致性**：
- `compileContentPipelineApp` async signature 跨 task 一致（Task 1 改 + Task 4 测试用 await）
- `stateHasError` helper 名跨 spec / task 一致
- Mock vi.mock 路径 `'../workflows/orchestrator/pg-checkpointer.js'` 跨 Task 1 + Task 4 一致
- 测试文件名 `content-pipeline-graph-resume.test.js` 跨 Task 2/3/4 一致
