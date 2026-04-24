# Phase C1 — L2 Orchestrator graph-runtime 骨架（+ C0 checkpoint schema migration）

**Date**: 2026-04-24
**Status**: Approved
**Task**: `19722360-1588-45d7-9957-f5a62192d37a`
**Spec refs**: `docs/design/brain-orchestrator-v2.md` §6 / `docs/design/brain-v2-roadmap-next.md` §Phase C

## 1. 目标

Brain v2 L2 Orchestrator 第一块砖 + SSOT checkpoint schema。单 PR 合并 C0 + C1：

**C0**：`migrations/244_langgraph_checkpoints.sql` 创建 `checkpoints / checkpoint_blobs / checkpoint_writes` 三张表（对齐 `@langchain/langgraph-checkpoint-postgres` v1.0.1 官方 schema）+ `brain-manifest.js` EXPECTED_SCHEMA_VERSION `243→244`。

**C1**：`packages/brain/src/orchestrator/` 新建骨架：
- `graph-runtime.js` — `runWorkflow(workflowName, taskId, attemptN, input?)` 统一入口，强制 thread_id 格式 `{taskId}:{attemptN}`
- `pg-checkpointer.js` — `PostgresSaver` 单例工厂（复用 Brain 主 pool，禁用 MemorySaver）
- `workflow-registry.js` — `registerWorkflow(name, graph) / getWorkflow(name) / listWorkflows()`，空注册表启动
- `__tests__/graph-runtime.test.js` — 4 case 单测
- `README.md` — 简要 L2 架构文档

## 2. 前置摸底（3 份 subagent 报告整合）

### LangGraph checkpointer 现状
- 当前靠 `executor.js:L2817 + L2863` 两处 `PostgresSaver.setup()` 散建表（非 SSOT）
- thread_id 全是裸 UUID（`String(task.id)`），**无 attempt_n**
- LangGraph 1.2.9 不升版本（spec 决策 2）

### harness-initiative-runner 现状（525 行）
- 不受本 PR 影响（C1 不迁现有 runner，继续老路径）
- Phase C3/C4/C5 再逐个迁到 `workflows/`

### Phase C 整体切分（Plan agent）
- 推荐顺序：**C0 → C1 → C2（今晚）** → C3 → C4 → C5 → C6 → C7（后续）
- C0 必须先合，否则 C1 的 pg-checkpointer 初始化依赖 `checkpoints` 表存在

## 3. 架构

### 3.1 文件结构

```
packages/brain/src/orchestrator/
├── graph-runtime.js       # runWorkflow 入口 + thread_id 格式强制
├── pg-checkpointer.js     # PostgresSaver 单例工厂
├── workflow-registry.js   # 注册表（空启动，C2+ 填充）
├── README.md              # L2 架构说明
└── __tests__/
    └── graph-runtime.test.js
```

### 3.2 `graph-runtime.js` 接口

```js
import { getWorkflow } from './workflow-registry.js';
import { getPgCheckpointer } from './pg-checkpointer.js';

const THREAD_ID_RE = /^[^:]+:\d+$/;

/**
 * 统一 workflow 入口。
 * @param {string} workflowName 已注册的 workflow 名
 * @param {string} taskId       Brain task UUID（不许为空）
 * @param {number} attemptN     重试次数（1-based，不许 < 1）
 * @param {object|null} input   fresh start 的 input state；resume 时必须 null
 * @returns {Promise<object>}   graph.invoke 返回值
 */
export async function runWorkflow(workflowName, taskId, attemptN, input = null) {
  if (!workflowName || typeof workflowName !== 'string') throw new TypeError('workflowName required');
  if (!taskId || typeof taskId !== 'string') throw new TypeError('taskId required');
  if (!Number.isInteger(attemptN) || attemptN < 1) throw new TypeError('attemptN must be positive integer');

  const graph = getWorkflow(workflowName); // throws if not registered
  const threadId = `${taskId}:${attemptN}`;
  if (!THREAD_ID_RE.test(threadId)) throw new Error(`invalid thread_id: ${threadId}`);

  const config = { configurable: { thread_id: threadId } };
  const hasCheckpoint = await checkpointerHasThread(threadId);
  const actualInput = hasCheckpoint ? null : input;
  return await graph.invoke(actualInput, config);
}

// 内部：查 pg checkpointer 是否已有 thread 的 checkpoint
async function checkpointerHasThread(threadId) {
  const checkpointer = await getPgCheckpointer();
  const state = await checkpointer.get({ configurable: { thread_id: threadId } });
  return state != null;
}
```

### 3.3 `pg-checkpointer.js` 单例

```js
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pool from '../db.js';

let _singleton = null;

export async function getPgCheckpointer() {
  if (_singleton) return _singleton;
  _singleton = PostgresSaver.fromConnString(pool.options.connectionString);
  // setup() 幂等；migration 244 已建表，这里额外幂等保险
  await _singleton.setup();
  return _singleton;
}
```

### 3.4 `workflow-registry.js`

```js
const _registry = new Map();

export function registerWorkflow(name, graph) {
  if (_registry.has(name)) throw new Error(`workflow already registered: ${name}`);
  _registry.set(name, graph);
}

export function getWorkflow(name) {
  const g = _registry.get(name);
  if (!g) throw new Error(`workflow not found: ${name}`);
  return g;
}

export function listWorkflows() {
  return Array.from(_registry.keys());
}
```

### 3.5 migration 244

```sql
-- 244_langgraph_checkpoints.sql
-- @langchain/langgraph-checkpoint-postgres v1.0.1 官方 schema SSOT
-- 以前靠 PostgresSaver.setup() 在 executor.js 散建，本 migration 统一

CREATE TABLE IF NOT EXISTS checkpoint_migrations (
  v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
```

### 3.6 `brain-manifest.js`

`EXPECTED_SCHEMA_VERSION: 243 → 244`。

### 3.7 测试（4 cases）

`__tests__/graph-runtime.test.js`：
1. **thread_id 格式正确**：`runWorkflow('x', 'abc-123', 2, ...)` → stub graph.invoke 收到 `thread_id: 'abc-123:2'`
2. **无 checkpoint 传 input / 有 checkpoint 传 null**：mock `checkpointer.get` 返回 null / object 两种
3. **未注册 workflow 报错**：`getWorkflow('nonexistent')` throws
4. **非法参数 throws**：taskId=`''` / attemptN=`0` / attemptN=`'2'` 都抛 TypeError

全部 mock `@langchain/langgraph-checkpoint-postgres` 和 `graph.invoke`，不真连 pg。

## 4. 关键决策

### 4.1 合并 C0 + C1 到单 PR
- Plan agent 原建议分 2 PR，我判断合并更快：C1 pg-checkpointer 测试时可能失败（checkpoints 表不存在），不合并会阻塞 C1 测试 → 合单 PR + CI migrations 流程一次跑完
- 改动规模 ~300 行（可接受）

### 4.2 不加 `tasks.attempt_n` 列（YAGNI）
- Plan agent 提出 `245_tasks_attempt_n.sql`，但 C1 只暴露 `runWorkflow(attemptN)` 接口，caller 从哪拿 attemptN 让 caller 自己决定（当前 tasks 表有 `retry_count` 字段可复用）
- Phase D（task-router）真接线时再加 attempt_n 列（若需要）

### 4.3 不接线到 tick.js / executor.js
- 本 PR 只建骨架暴露 API；CI grep assertion 确认 tick.js 未调 runWorkflow
- C2 首次接线时加 `WORKFLOW_RUNTIME=v2` env flag 灰度

### 4.4 pg-checkpointer 单例而非工厂
- LangGraph PostgresSaver 内部有连接池，单例可共享；多实例会浪费连接
- 进程生命周期内一个即可

## 5. 成功标准
1. 4 个单测全 pass（含 thread_id 格式、非法参数、注册表错误、checkpoint hasthread 分支）
2. migration 244 通过 brain-selfcheck（schema_version=244）
3. CI grep assertion：`grep -c 'runWorkflow(' packages/brain/src/tick.js` == 0（未接线）
4. 现有 brain 子树测试不退化
5. `orchestrator/` 目录独立，不依赖 `harness-*` 或 `content-pipeline-*` 现有 runner

## 6. 不做
- 不迁任何现有 workflow（Phase C2-C5）
- 不改 tick.js / executor.js（Phase C2-C6）
- 不加 `tasks.attempt_n` 列（Phase D 需要时加）
- 不升级 @langchain/langgraph 版本（spec 决策 2）
- 不新增 `WORKFLOW_RUNTIME` env flag（C2 接线时加）
- 不清 executor.js 里的 `PostgresSaver.setup()` 散建（Phase C6 tick 瘦身时清）

## 7. 风险
| 风险 | 缓解 |
|---|---|
| `PostgresSaver.setup()` 和 migration 244 双重幂等冲突 | `CREATE TABLE IF NOT EXISTS` 保证，setup() 里也用 IF NOT EXISTS |
| 单测 mock 复杂（LangGraph + pg）| mock `@langchain/langgraph-checkpoint-postgres` 默认导出为 `{ PostgresSaver: class { ... } }` stub |
| Phase C2 首次接线可能发现 runWorkflow 签名不全 | 保留 API 前向兼容，C2 真跑时看情况补参数 |
| migration 244 在 prod 跑可能和 `setup()` 动态建表时间差竞争 | brain-deploy.sh 里 migration 是 `[3/7] Run Migrations`，在 `[7/8] Start Container` 前，CI 流程无竞争 |
