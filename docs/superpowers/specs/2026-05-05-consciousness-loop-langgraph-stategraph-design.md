# consciousness-loop LangGraph StateGraph 设计文档

> 写于 2026-05-05

## Goal

将 `consciousness-loop.js` 的 `_doConsciousnessWork()` 包装成 LangGraph StateGraph + PG Checkpointer，实现 Brain 崩溃后步骤级恢复。每次意识循环的 4 个子步骤各成一个 node，任意步骤后崩溃，重启后从断点续跑，不重复已完成步骤。

## 背景

现有 `consciousness-loop.js` 每 20 分钟运行 `_runConsciousnessOnce()`，串行执行：
1. thalamus（分析 tick 事件，路由建议写 working_memory）
2. generateDecision（全局策略写 working_memory）
3. runRumination（知识消化，fire-and-forget）
4. planNextTask（直接写 tasks 表）

当前无任何 checkpoint 机制，Brain 崩溃后 4 步全部重跑。且现有 `dev-task.graph.js` / `harness-initiative.graph.js` 已建立了 LangGraph StateGraph + PG Checkpointer 的标准模式，consciousness-loop 应对齐。

## 架构

### 文件结构

```
packages/brain/src/
├── workflows/
│   ├── consciousness.graph.js    ← 新建：StateGraph + 4 nodes
│   └── index.js                  ← 修改：导出 getCompiledConsciousnessGraph()
└── consciousness-loop.js         ← 修改：_runConsciousnessOnce 调图
```

### State Schema

```js
// consciousness.graph.js
export const ConsciousnessState = Annotation.Root({
  completed_steps: Annotation({ reducer: (_, neu) => neu, default: () => [] }),
  errors:          Annotation({ reducer: (_, neu) => neu, default: () => [] }),
  run_ts:          Annotation({ reducer: (_, neu) => neu, default: () => null }),
});
```

三字段说明：
- `completed_steps`：已完成步骤名列表，`['thalamus', 'decision', 'rumination', 'plan']`，供断点续跑判断
- `errors`：各步骤捕获的非致命错误字符串列表
- `run_ts`：本次运行开始时间戳，供日志 / 审计

业务结果（thalamus routing、decision guidance、tasks 行）全部直写 DB，不存 state。state 只保存执行控制信息。

### Graph 结构

```
START
  │
  ▼
thalamus ──→ decision ──→ rumination ──→ plan_next_task
                                              │
                                              ▼
                                            END
```

4 个节点，顺序连接，无条件 edge。每个节点：

```js
async function thalamusNode(state) {
  try {
    // ... 调 thalamusProcessEvent，写 guidance
    return { 
      completed_steps: [...state.completed_steps, 'thalamus'],
      errors: state.errors,
    };
  } catch (err) {
    return { 
      completed_steps: [...state.completed_steps, 'thalamus'],
      errors: [...state.errors, `thalamus: ${err.message}`],
    };
  }
}
```

注意：节点内 catch 吞异常并写 errors（非致命），保持与现有 `_doConsciousnessWork` 的容错语义一致。`rumination` 节点只 fire-and-forget（`.catch` 挂 warn），立即 push 'rumination' 到 completed_steps，不等待结果。

### thread_id 策略

不走 `runWorkflow()`（该函数强依赖 taskId / attemptN，consciousness 无 task 概念）。

使用 **rotating thread_id**：

- 每次 `_runConsciousnessOnce()` 开始时，若无 active thread，生成 `consciousness:{Date.now()}`
- 将 active thread_id 写入 `working_memory` 表（key = `'consciousness:active_thread'`）
- 调 `compiledGraph.invoke(input, { configurable: { thread_id } })`
- 若 checkpointer 已有该 thread → `input = null`（resume）
- 若无 checkpoint → `input = { completed_steps: [], errors: [], run_ts: new Date().toISOString() }`（fresh start）
- 4 步全部完成后：清除 working_memory `consciousness:active_thread`，重置 `_activeThreadId = null`

**崩溃恢复流程**：Brain 崩溃时 working_memory 中保留 `consciousness:active_thread = 'consciousness:1746441600000'`。重启后下次 setInterval 触发，读到该 thread_id → checkpointerHasThread → true → `input = null` → LangGraph 从断点 node 续跑。

### consciousness.graph.js 编译与单例

```js
let _compiled = null;

export async function getCompiledConsciousnessGraph() {
  if (!_compiled) {
    const checkpointer = await getPgCheckpointer();
    _compiled = buildConsciousnessGraph().compile({ checkpointer });
  }
  return _compiled;
}
```

`getCompiledConsciousnessGraph()` 进程级单例，首次调用时 lazy init，复用 `getPgCheckpointer()` 单例。

### consciousness-loop.js 修改

```js
// 新增模块级状态
let _activeThreadId = null;

// _runConsciousnessOnce() 内部替换 _doConsciousnessWork 为：
const graph = await getCompiledConsciousnessGraph();
const threadId = await _getOrCreateActiveThread();  // 读/写 working_memory

const checkpointer = await getPgCheckpointer();
const existingCheckpoint = await checkpointer.get({ configurable: { thread_id: threadId } });
const input = existingCheckpoint 
  ? null 
  : { completed_steps: [], errors: [], run_ts: new Date().toISOString() };

const result = await graph.invoke(input, { configurable: { thread_id: threadId } });

await _clearActiveThread();  // 删 working_memory consciousness:active_thread
_activeThreadId = null;
return { completed: result.completed_steps.length === 4, actions: result.completed_steps, errors: result.errors };
```

`_isRunning` 锁、`Promise.race` 超时保护、`setInterval` 计时器**全部保留**，不做修改。StateGraph 只替换 `_doConsciousnessWork()` 调用。

### workflows/index.js 修改

在 `initializeWorkflows()` 中预热 consciousness graph（可选，加速首次 invoke）：

```js
import { getCompiledConsciousnessGraph } from './consciousness.graph.js';

// initializeWorkflows() 末尾：
await getCompiledConsciousnessGraph(); // 预热单例
```

consciousness graph 不注册到 workflow-registry（不走 runWorkflow，不需要注册）。

## 测试策略

### Integration test（需真实 DB，`src/__tests__/integration/consciousness-graph.integration.test.js`）

测试场景：
- **约束存在**：`checkpoints` 表（migration 244）存在于 pg_catalog
- **正常 invoke**：图可 invoke，`completed_steps.length === 4`，无未捕获异常
- **崩溃恢复**：向 checkpointer 手动写入 `completed_steps: ['thalamus']` 的状态 → invoke → 确认从 `decision` 节点开始（thalamus 函数未被调用，completed_steps 包含全部 4 步）

注意：integration test 需 mock 底层 LLM 调用（thalamusProcessEvent / generateDecision / runRumination / planNextTask），只验证 StateGraph 控制流，不做真实 LLM 调用。

### Unit test（mock checkpointer，`src/__tests__/consciousness-graph.test.js`）

- `thalamusNode(state)` 正常路径：返回 `completed_steps` 包含 `'thalamus'`
- `thalamusNode(state)` 异常路径：底层 thalamusProcessEvent 抛错 → errors 包含错误信息，completed_steps 仍包含 `'thalamus'`（非致命，继续）
- `ruminationNode(state)`：fire-and-forget，立即返回 `completed_steps` 包含 `'rumination'`，不等待 runRumination 结束
- `getCompiledConsciousnessGraph()` 单例：多次调用只编译一次

### 不适用

- **E2E**：无跨进程 / 持久化边界（单 Brain 进程内，DB 读写由 integration test 覆盖）
- **Trivial wrapper**：逻辑 > 20 行

## 文件

- 新建：`packages/brain/src/workflows/consciousness.graph.js`
- 新建：`packages/brain/src/__tests__/consciousness-graph.test.js`
- 新建：`packages/brain/src/__tests__/integration/consciousness-graph.integration.test.js`
- 修改：`packages/brain/src/consciousness-loop.js`（`_runConsciousnessOnce` + `_getOrCreateActiveThread` + `_clearActiveThread`）
- 修改：`packages/brain/src/workflows/index.js`（预热 consciousness graph）
- 不改：`packages/brain/src/orchestrator/graph-runtime.js`
- 不改：`packages/brain/src/orchestrator/pg-checkpointer.js`

## 成功标准

```bash
# [BEHAVIOR] consciousness.graph.js 文件存在且含 getCompiledConsciousnessGraph 导出
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/consciousness.graph.js','utf8');if(!c.includes('getCompiledConsciousnessGraph'))process.exit(1);console.log('export OK');"

# [BEHAVIOR] working_memory 在 invoke 后被清理
node -e "const {Pool}=require('pg');const p=new Pool({connectionString:'postgresql://cecelia:cecelia@localhost:5432/cecelia'});p.query(\"SELECT count(*)::int cnt FROM working_memory WHERE key='consciousness:active_thread'\").then(r=>{if(r.rows[0].cnt!==0){console.error('thread not cleared');process.exit(1);}console.log('thread cleared OK');p.end();}).catch(e=>{console.error(e.message);process.exit(1);})"
```
