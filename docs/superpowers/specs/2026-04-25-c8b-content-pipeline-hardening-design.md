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

**caller 影响**（grep 验证完整清单）：
- `content-pipeline-runner.js` L115：已显式传 checkpointer（routes 注入），改成 await 即可
- `__tests__/content-pipeline-graph.test.js` **7 处直调** `compileContentPipelineApp({...})`（L33/40/56/81/104/140/150 附近，全部不传 checkpointer）：必须 `await` + 顶部 `vi.mock('../workflows/orchestrator/pg-checkpointer.js')` 防真连 pg
- `__tests__/content-pipeline-graph-docker.test.js` L585：1 处直调 + 同款改 await + mock
- `routes/content-pipeline.js`：调 runner 不直调 compile，无需改

签名 breaking change（async）— 必须 grep 全 caller + 改 await + 测试加 mock pg-checkpointer。

### 3.3 加固 C — stateHasError 短路（**仅非 verdict 节点**）

**重要修订**：copy_review / image_review 是 verdict 节点，**不**嵌 stateHasError。原因：docker 偶发 flake 让 exit_code != 0，节点会同时填 `state.error` 和保留 verdict。原 round>=3 兜底就是为吸收这种"软失败"设计 —— 强行 error → END 会让 pipeline 在 R3 任一次 docker flake 死透，**比当前更脆**。

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

**改造原则**：
- **非 verdict 节点**（research / copywrite / generate）的 plain `addEdge('X','Y')` 改成 `addConditionalEdges('X', stateHasError, { error: END, ok: 'Y' })` —— 这些节点真硬错（state.error）应立即 END，避免下游节点拿空数据继续 spawn
- **verdict 节点**（copy_review / image_review）保留原 verdict 路由**完全不动** —— round>=3 兜底语义保持
- **export → END**：原本就是终点，无需改

**实现**：

```js
function stateHasError(state) { return state.error ? 'error' : 'ok'; }

graph
  // 非 verdict 节点：error 短路
  .addEdge(START, 'research')
  .addConditionalEdges('research', stateHasError, { error: END, ok: 'copywrite' })
  .addConditionalEdges('copywrite', stateHasError, { error: END, ok: 'copy_review' })

  // verdict 节点 copy_review：原 verdict 路由不动（含 round>=3 兜底）
  .addConditionalEdges('copy_review', copyReviewVerdictRoute, { generate: 'generate', copywrite: 'copywrite' })

  // 非 verdict 节点 generate：error 短路
  .addConditionalEdges('generate', stateHasError, { error: END, ok: 'image_review' })

  // verdict 节点 image_review：原 verdict 路由不动（含 round>=3 兜底）
  .addConditionalEdges('image_review', imageReviewVerdictRoute, { export: 'export', generate: 'generate' })

  // 终点
  .addEdge('export', END);
```

**verdict 节点 docker 真硬错的兜底**：当前 verdict 节点失败时仍写 `state.copy_review_verdict='REVISION'`（默认 placeholder）让 pipeline 回 copywrite 重试。round>=3 后硬规则 fail 才回 copywrite + recursion_limit 兜底挂掉。这一行为**保留**。verdict 节点的 docker 抖动 self-healing 由 round 机制承担，不是本 PR 范围。

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

**现有 2 个 graph test 不破坏** — `content-pipeline-graph.test.js`（7 处直调）+ `content-pipeline-graph-docker.test.js`（1 处直调）都因 `compileContentPipelineApp` 改 async 需要：
1. 全部直调改 `await compileContentPipelineApp(...)`
2. 测试顶部加 `vi.mock('../workflows/orchestrator/pg-checkpointer.js')`（不传 checkpointer 时 mock 兜底，避免真连 pg）
3. 测试函数改 `async` + `it('...', async () => {...})`

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
| stateHasError 误嵌 verdict 路由 → 破坏 round>=3 硬规则兜底（pipeline 比当前更脆） | rev 1 决定：verdict 节点（copy_review/image_review）**完全不嵌** stateHasError，仅 3 个非 verdict 节点（research/copywrite/generate）加 error 短路。verdict 节点 docker flake 由 round>=3 兜底承担（保留原行为） |
| 6 节点幂等门写漏一个 → 该节点仍 spawn | 模板化在 `runDockerNode` 单一位置注入，不在每节点单独写。`cfg.outputs[0]` 兜底取每节点 primary output |
| `output_dir` channel 在多节点共享 → idempotency 误判 | 不用 `output_dir` 作 idempotency 字段（research outputs[0] 是 findings_path），改用每节点真正 primary output |

---

## 7. PR 拆分

**单 PR**（scope 缩窄后 4-6h work）：

- `packages/brain/src/workflows/content-pipeline.graph.js`：~60 行 net change（runDockerNode 加门 +20 / compileApp 改 async +5 / 4 个非 verdict 节点 edges 改 conditional +25 / 注释 +10）
- `packages/brain/src/__tests__/content-pipeline-graph-resume.test.js`：新建 ~150 行 / 3 测
- `packages/brain/src/__tests__/content-pipeline-graph.test.js`：7 处 await + 顶部 mock pg-checkpointer（~30 行净改动）
- `packages/brain/src/__tests__/content-pipeline-graph-docker.test.js`：1 处 await + mock pg（~5 行）
- `packages/brain/src/workflows/content-pipeline-runner.js`：改 1 处 await（~3 行）
- `docs/learnings/cp-0425203339-c8b-content-pipeline-graph.md`：新建 Learning

预估：~270 行 added，10-15 行 deleted。
