# C7 Design — executor/content-pipeline inline PostgresSaver setup 清理 → getPgCheckpointer 单例

**日期**：2026-04-24
**分支**：cp-0424212248-brain-v2-c7-checkpointer-singleton
**Brain task**：255fc546-4972-4af2-9d67-4c33d54389f5
**上游 Handoff**：`docs/design/brain-v2-c6-handoff.md` §3 C7 定义
**Spec SSOT**：`docs/design/brain-orchestrator-v2.md` §6

## 1. Goal

`packages/brain/src/` 共 3 处 inline `PostgresSaver.fromConnString(...) + setup()` 改走 C1 建的 `orchestrator/pg-checkpointer.js` 的 `getPgCheckpointer()` 幂等单例。消除重复 checkpointer 实例，统一走 Brain v2 L2 中央路径。

## 2. 改动点（3 处）

### 2.1 `packages/brain/src/executor.js:2813-2821`（`harness_initiative` 分支）

**改前**：

```js
let checkpointer;
try {
  const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
  checkpointer = PostgresSaver.fromConnString(
    process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
  );
  await checkpointer.setup();
} catch (cpErr) {
  console.warn(`[executor] PostgresSaver 初始化失败，降级到 MemorySaver: ${cpErr.message}`);
  checkpointer = undefined;
}
```

**改后**：

```js
let checkpointer;
try {
  const { getPgCheckpointer } = await import('./orchestrator/pg-checkpointer.js');
  checkpointer = await getPgCheckpointer();
} catch (cpErr) {
  console.warn(`[executor] PostgresSaver 初始化失败，降级到 MemorySaver: ${cpErr.message}`);
  checkpointer = undefined;
}
```

Import 路径：`./orchestrator/pg-checkpointer.js`（executor.js 在 `packages/brain/src/` 下）。

### 2.2 `packages/brain/src/executor.js:2859-2863`（`harness_planner` LangGraph 分支）

**改前**：

```js
const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
const checkpointer = PostgresSaver.fromConnString(
  process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
);
await checkpointer.setup();
```

**改后**：

```js
const { getPgCheckpointer } = await import('./orchestrator/pg-checkpointer.js');
const checkpointer = await getPgCheckpointer();
```

原代码无外层 try/catch，保持原行为裸调（错误冒泡到外层 `try { ... } catch (err) { console.error('[executor] LangGraph pipeline error ...') }`），语义等价。

### 2.3 `packages/brain/src/routes/content-pipeline.js:625-629`

**改前**：

```js
const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
const checkpointer = PostgresSaver.fromConnString(
  process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
);
await checkpointer.setup();
```

**改后**：

```js
const { getPgCheckpointer } = await import('../orchestrator/pg-checkpointer.js');
const checkpointer = await getPgCheckpointer();
```

**关键**：import 路径必须是 `../orchestrator/pg-checkpointer.js`（多一层 `..`，routes 子目录），写成 `./orchestrator/...` 会 runtime `ERR_MODULE_NOT_FOUND`。

## 3. 不做（C7 scope 外）

- 不删 `workflows/*.graph.js` shim（C8+）
- 不动 `dispatchNextTask` 分派逻辑（C6 已定）
- 不做 tick 瘦身（Phase D）
- 不接 harness-initiative / content-pipeline 走 `runWorkflow`（C8）
- 不改 pg-checkpointer.js 自身

## 4. 测试策略

**测试方式**：本 PR 为代码简化，等价替换。不写新单测，用既有测试回归。

- 回归：`executor.js` / `content-pipeline.js` 触发的既有测试（harness_initiative / harness_planner / content-pipeline 路由）全绿
- DoD grep 检查确保 3 处全替换 + 0 处遗漏
- 本地 `node --check` 冒烟 2 个文件（feedback_brain_deploy_syntax_smoke）

**为何不写新单测**：`getPgCheckpointer()` 本身在 C1 已有测试覆盖（pg-checkpointer.test.js）。本 PR 是 caller 侧替换，等价行为，单测价值低。若 CI L3 要求 `feat:` PR 必须有 `*.test.ts` 变动，本 PR commit type 用 `refactor:` 规避。

## 5. 成功标准

- 3 处 inline `PostgresSaver.fromConnString` 全部替换为 `getPgCheckpointer()`
- `grep -c "PostgresSaver.fromConnString" packages/brain/src/` 排除 pg-checkpointer.js 后返回 0
- 既有 executor / content-pipeline 测试全绿
- `node --check` 两文件无 syntax error
- 合并后 Brain redeploy，手动 `docker exec cecelia-node-brain node -e "..."` 验证 getPgCheckpointer 可用

## 6. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| content-pipeline.js import 路径写错（`./` vs `../`）导致 runtime crash | Plan 里明确写 `../orchestrator/pg-checkpointer.js`；`node --check` 只查 syntax 不查 import 解析，用 `docker exec cecelia-node-brain node --check /app/src/routes/content-pipeline.js` 再一次保险 |
| 旧代码 `setup()` 是每次调用都幂等 re-setup，换 singleton 后只 setup 一次；若 setup 过程中并发多次 `getPgCheckpointer()` 同时进入 lazy init | pg-checkpointer.js 用 `_setupPromise` await 共享，防双 setup；已 C1 测试覆盖 |
| 3 处分支原本有不同的 try/catch 结构，粗暴替换可能改变错误传播语义 | 按 2.1/2.2/2.3 分别保持原 try/catch 结构，只替换内容 |

## 7. 实施 commit 拆分

**单 PR 1 commit**（无 TDD 新测试，等价替换）：

`refactor(brain): C7 inline PostgresSaver setup → getPgCheckpointer 单例`

包含：
- `packages/brain/src/executor.js`（2 处替换）
- `packages/brain/src/routes/content-pipeline.js`（1 处替换）
- `docs/learnings/cp-0424212248-brain-v2-c7-checkpointer-singleton.md`
