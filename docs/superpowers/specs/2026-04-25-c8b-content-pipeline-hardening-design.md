# Brain v2 C8b — content-pipeline 真图加固 Design Spec

**日期**：2026-04-25
**Brain task**：`d5434582-f6ca-45fa-bb04-78e1b090d0fe`
**worktree**：`/Users/administrator/worktrees/cecelia/c8b-content-pipeline-graph`
**分支**：`cp-0425203339-c8b-content-pipeline-graph`
**上游 PRD（修正版）**：本 spec 替代 `docs/design/brain-v2-c8-d-e-handoff.md` §4 — handoff §4 假设 content-pipeline.graph.js 是 625 行单 function，事实**已经是 6 节点真图**（C5 阶段完成）

---

## 1. Goal

把已存在的 6 节点真图加 3 个加固：

1. **6 节点首句幂等门** — 解 LangGraph resume 重 spawn 烧 docker 容器（C6 / C8a 同款教训）
2. **PgCheckpointer 默认化** — `compileContentPipelineApp` 默认走 `getPgCheckpointer()`，不再依赖 caller 显式传
3. **stateHasError 短路** — error 节点不继续往下流，直接 END

成功定义：同 thread_id 第二次 invoke 时，已有 outputs 的节点跳过 docker spawn，PostgresSaver 持久化每节点 state，硬错节点立即 END。

---

## 2. 当前状态（事实）

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/brain/src/workflows/content-pipeline.graph.js` | 625 | **真 6 节点 LangGraph** + Docker 节点工厂（C5 已完成） |
| `packages/brain/src/workflows/content-pipeline-runner.js` | 204 | 入口 `runContentPipeline(task, opts)`；显式传 checkpointer |
| `packages/brain/src/routes/content-pipeline.js` | — | POST `/api/brain/content-pipeline/:id/run-langgraph` 调 runner |
| `packages/brain/src/__tests__/content-pipeline-graph-docker.test.js` | — | 测 docker 节点工厂；本 PR 不动 |

**当前拓扑**（content-pipeline.graph.js L262-L325）：

```
START → research → copywrite → copy_review
                                     ↓ (verdict)
                  ┌──────APPROVED──→ generate → image_review
                  │                                  ↓ (verdict)
              copywrite ←─REVISION─┐         ┌──PASS─→ export → END
                                   │         │
                  generate ←──FAIL─┘─────────┘
                  ↑ (round>=3 兜底优先 verdict)
```

6 节点 + 2 verdict conditional edges + round>=3 兜底（防无限回路）。

**关键发现 — 当前缺失**：
- `runDockerNode` 没幂等门（resume 时无条件 spawn）
- `compileContentPipelineApp` 默认 `MemorySaver`（L336）— Brain 重启即丢
- 节点 error（exit_code != 0 / 抛异常）只填 `state.error` 但 graph **仍按拓扑流向下一节点**，无 error 短路

---

## 3. 选定方案：3 加固，1 PR

### 3.1 加固 A — 6 节点首句幂等门

**位置**：`runDockerNode(nodeName, state)` 顶部（content-pipeline.graph.js L495 附近），在 `const cfg = NODE_CONFIGS[nodeName]` 之后。

**模板**：用 `cfg.outputs[0]` 作 idempotency 字段（每节点 outputs 数组第一个是 primary output）。

```js
async function runDockerNode(nodeName, state) {
  const cfg = NODE_CONFIGS[nodeName];

  // 幂等门（C8a 同款）：state 已有该节点 primary output → 跳过 docker spawn
  const primaryField = cfg.outputs[0];
  if (state[primaryField]) {
    console.log(`[content-pipeline-graph] node=${nodeName} task=${taskId} resume skip (state.${primaryField} exists)`);
    return { output: '', error: null, success: true, meta: { resumed: true } };
  }

  // ...原 docker spawn 逻辑不动
}
```

**6 节点 primary output 映射**（NODE_CONFIGS L355-L405）：

| 节点 | outputs[0] |
|---|---|
| research | `findings_path` |
| copywrite | `copy_path` |
| copy_review | `copy_review_feedback` |
| generate | （查 NODE_CONFIGS） |
| image_review | （查 NODE_CONFIGS） |
| export | `final_post_path` |

实现时按真实 `NODE_CONFIGS[nodeName].outputs[0]` 取，不硬编码字段名。

**幂等返回值**：`{ output: '', error: null, success: true, meta: { resumed: true } }` —— 让 `extractNodeOutputs` 不写新字段（保留 state[primaryField] 原值），`makeNode` 不更新 trace。

### 3.2 加固 B — PgCheckpointer 默认化

**位置**：`compileContentPipelineApp` 函数（L334）。

**当前**：
```js
export function compileContentPipelineApp({ overrides, checkpointer } = {}) {
  const graph = buildContentPipelineGraph(overrides);
  const saver = checkpointer || new MemorySaver();
  return graph.compile({ checkpointer: saver });
}
```

**改为 async**：
```js
export async function compileContentPipelineApp({ overrides, checkpointer } = {}) {
  const graph = buildContentPipelineGraph(overrides);
  const saver = checkpointer || (await getPgCheckpointer());
  return graph.compile({ checkpointer: saver });
}
```

**caller 影响**：
- `content-pipeline-runner.js`：已显式传 checkpointer（routes 注入），改成 await 即可
- `__tests__/content-pipeline-graph-docker.test.js`：测试可能直调 `compileContentPipelineApp` — 改 await，并注入 mock checkpointer 防真连 pg
- `routes/content-pipeline.js`：调 runner 不直调 compile

签名 breaking change（async）— 必须把 caller 全 grep 一遍 + 改 await。

### 3.3 加固 C — stateHasError 嵌入 conditional edges

**位置**：`buildContentPipelineGraph` 函数（L262）。

**当前 edges**：
```js
.addEdge(START, 'research')
.addEdge('research', 'copywrite')
.addEdge('copywrite', 'copy_review')
.addConditionalEdges('copy_review', verdictRoute, { generate, copywrite })
.addEdge('generate', 'image_review')
.addConditionalEdges('image_review', verdictRoute, { export, generate })
.addEdge('export', END);
```

**改造**：所有 plain `addEdge('X', 'Y')` 改成 `addConditionalEdges('X', stateHasError, { error: END, ok: 'Y' })`。verdict edges 嵌套 stateHasError 优先：

```js
function stateHasError(state) { return state.error ? 'error' : 'ok'; }

// 嵌套：error 优先 → END / 否则走 verdict 路由
function copyReviewRoute(state) {
  if (state.error) return 'END';
  // ... 原 verdict 路由（含 round>=3 兜底）
}
function imageReviewRoute(state) {
  if (state.error) return 'END';
  // ... 原 verdict 路由
}

graph
  .addEdge(START, 'research')
  .addConditionalEdges('research', stateHasError, { error: END, ok: 'copywrite' })
  .addConditionalEdges('copywrite', stateHasError, { error: END, ok: 'copy_review' })
  .addConditionalEdges('copy_review', copyReviewRoute, { END, generate, copywrite })
  .addConditionalEdges('generate', stateHasError, { error: END, ok: 'image_review' })
  .addConditionalEdges('image_review', imageReviewRoute, { END, export, generate })
  .addConditionalEdges('export', stateHasError, { error: END, ok: END });  // export 后总走 END
```

**注意**：
- `copyReviewRoute` / `imageReviewRoute` 嵌套 stateHasError 检查在原 verdict 路由前
- 保留原 round>=3 兜底逻辑（硬规则 fail 仍回 copywrite）
- export 节点后无论如何都走 END（保留原行为，但加 error 短路对称性）

### 3.4 测试

新建 `packages/brain/src/__tests__/content-pipeline-graph-resume.test.js`：

| 测试 | 覆盖 |
|---|---|
| `runDockerNode resume skip when state has primary output` | mock executor + 调 docker node with `state.findings_path` 已存在 → executor 不被调，返回 `success:true, meta.resumed:true` |
| `compileContentPipelineApp 默认走 PgCheckpointer` | mock `getPgCheckpointer` + 不传 checkpointer → mock 被调 |
| `stateHasError 嵌入：error 节点直接 END` | inject error state → graph.invoke 后没继续流到下一节点 |

**Mock pg-checkpointer**（同 C8a `harness-initiative-graph.test.js` 模板）：
```js
vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({ get: ..., put: ..., setup: ..., list: ..., getTuple: ..., putWrites: ... }),
}));
```

**现有 `content-pipeline-graph-docker.test.js` 不破坏** — 已有测试 import `compileContentPipelineApp`，因签名改 async 需要把直调 `compileContentPipelineApp(...)` 的地方改成 `await compileContentPipelineApp(...)`。

---

## 4. DoD（PR 合并门禁）

- `[x]` `[BEHAVIOR]` 6 节点首句幂等门到位；Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/content-pipeline.graph.js','utf8');if(!c.includes('resume skip'))process.exit(1)"`
- `[x]` `[BEHAVIOR]` `compileContentPipelineApp` 默认 PgCheckpointer；Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/content-pipeline.graph.js','utf8');if(!c.includes('getPgCheckpointer'))process.exit(1)"`
- `[x]` `[BEHAVIOR]` `stateHasError` 短路存在；Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/content-pipeline.graph.js','utf8');if(!c.includes('stateHasError'))process.exit(1)"`
- `[x]` `[BEHAVIOR]` resume idempotent test pass；Test: `tests/__tests__/content-pipeline-graph-resume.test.js`
- `[x]` `[ARTIFACT]` 新建 resume test 文件；Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/content-pipeline-graph-resume.test.js')"`

---

## 5. Out of scope

- env gate 改名（保留 `CONTENT_PIPELINE_LANGGRAPH_ENABLED` 默认 true）
- `content-pipeline-graph-runner.js` shim 清理
- 现有 22 channels 重构
- `routes/content-pipeline.js` POST /run-langgraph 入口改造
- `workflows/index.js` 注册 content-pipeline（content-pipeline 不走 graph-runtime registry，直接 routes 调 runner）

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `compileContentPipelineApp` 改 async 影响所有 caller | grep 全 caller + 改 await，跑全 brain test 验无 regression |
| stateHasError 嵌入 verdict 路由可能破坏 round>=3 硬规则兜底 | 保留原 verdict 函数完整，仅在最前面加 `if (state.error) return 'END'`，error 优先级最高但不动其他逻辑 |
| 6 节点幂等门写漏一个 → 该节点仍 spawn | 模板化在 `runDockerNode` 单一位置注入，不在每节点单独写。`cfg.outputs[0]` 兜底取每节点 primary output |
| `output_dir` channel 在多节点共享 → idempotency 误判 | 不用 `output_dir` 作 idempotency 字段（research outputs[0] 是 findings_path），改用每节点真正 primary output |

---

## 7. PR 拆分

**单 PR**（scope 缩窄后 4-6h work）：

- `packages/brain/src/workflows/content-pipeline.graph.js`：~75 行 net change（runDockerNode 加门 +20 / compileApp 改 async +5 / edges 改 conditional +30 / 注释 +20）
- `packages/brain/src/__tests__/content-pipeline-graph-resume.test.js`：新建 ~150 行 / 3 测
- `packages/brain/src/__tests__/content-pipeline-graph-docker.test.js`：改 1 处 await（~3 行）
- `packages/brain/src/workflows/content-pipeline-runner.js`：改 1 处 await（~3 行）
- `docs/learnings/cp-0425203339-c8b-content-pipeline-graph.md`：新建 Learning

预估：~260 行 added，3-5 行 deleted。
