# Provider-neutral Harness Kernel

本目录是 Harness 的确定性内核。它决定阶段、门禁、重试、合并与恢复；Claude
Code、Codex 等 CLI 只是执行 TaskBundle 的 worker，不拥有流程状态机。

## 灰度启用与回滚

仅对 `orchestrator: "skill-relay"` 的任务生效：

```json
{
  "harness_runtime": "kernel-v1",
  "executor": "auto"
}
```

- `executor: "auto"`：按 capability 选择已注册 provider，不选择 model。
- `executor: "claude"` / `"codex"`：显式选择 provider。
- `model` 缺省：不向 CLI 传模型，让账号或 CLI 配置决定。
- `model` 显式设置：才透传为 provider 的模型参数。
- 回滚：删除 `harness_runtime` 或改成其他值，立即回到原
  `harness-controller` 路径，不需要迁移或删除 attempt 数据。

当前生产 adapter 为 Claude Code 与 Codex。新增 Grok 等 provider 时只需实现
`start / resume / inspect / cancel / normalizeResult`，声明 capabilities，并通过
TaskBundle、结构化输出、session 隔离和恢复测试；不要把 provider 专有指令写入
Skill 或状态机。

## 契约与 Skill

- `execution-contract.js`：内部 v1 `TaskBundle` / `HarnessResult` schema。
- `skill-bundle.js`：从仓库 `packages/workflows/skills/` 读取 Skill，记录 version、
  `sha256` 和完整内容后再派发；运行时不以 `~/.claude/skills` 为事实源。
- `provider-registry.js`：按能力解析 provider，注册顺序是 `auto` 的确定性优先级。
- `providers/`：仅生成 CLI 调用描述并规范化返回，不决定 Harness 流程。

每个 planner / proposer / reviewer / generator / evaluator / judge 都写一条
`harness_attempts`。唯一 `(run_id, hop)` 固定 relay 次序；provider session 在同一
run 内只能属于一个 attempt。回调结果必须匹配 attempt id、provider 和 role。

## 对抗与恢复不变量

1. proposer 与 reviewer、generator 与 evaluator 必须是不同 attempt 和新 session。
2. reviewer/evaluator 的 decision 是必填项；judge 使用独立证据门，不复用 agent
   的自我评价。
3. runner 每 60 秒 heartbeat；lease 未过期时其他进程不得接管。
4. lease 过期且已有 provider session：只 reclaim 并 resume 同一 attempt。
5. 没有可恢复 session：不猜进度，重启 kernel reconcile，从 DB、PR、Git 和产物
   重新推导下一 hop。
6. callback 是幂等终态写入；verdict 以 attempt id 去重并绑定 round / PR SHA。

Claude 的本地 session 文件按 attempt 持久化在宿主
`CECELIA_HARNESS_SESSION_DIR`（缺省为系统临时目录下的
`cecelia-harness-sessions/`），容器替换后继续挂载同一目录。跨设备若没有共享该目录，
不要复制 session id 冒充可恢复；watchdog 应关闭旧 attempt，并按 Git/PR/DB 真相重新
推导。Codex thread 由 provider 自身保存，`thread.started` 到达时立即落 attempt。

## 运行与排障

```bash
# 只观测、推导，不写 DB/不派发
node packages/brain/src/orchestrator/run.js --task-id <uuid> --run-id <uuid> --dry-run

# 真实运行（通常由 skill-relay 启动）
node packages/brain/src/orchestrator/run.js --task-id <uuid> --run-id <uuid>

# provider runner 静态契约
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
```

内部 callback：

- `POST /api/brain/harness/attempts/:attemptId/heartbeat`
- `POST /api/brain/harness/attempts/:attemptId/callback`

排障先查 `harness_attempts` 的 status、lease_owner、lease_expires_at、
provider_session_id、error_code，再查 `orchestrator_decision_log`。不要人工复制 session
到另一个 role；需要恢复时让 watchdog 按上述规则接管。

## 既有 Brain v2 编排模块

**位置**：Brain v2 三层架构中间层 L2（L1 Scheduler → L2 Orchestrator → L3 Executor）。
**spec**：`docs/design/brain-orchestrator-v2.md` §6。

## 模块

| 文件 | 责任 |
|---|---|
| `graph-runtime.js` | `runWorkflow(workflowName, taskId, attemptN, input?)` 统一入口；thread_id 格式强制 `{taskId}:{attemptN}`；has-thread 预检 resume/fresh 分流 |
| `pg-checkpointer.js` | `PostgresSaver` 进程单例工厂；所有 workflow 共用（禁 MemorySaver）|
| `workflow-registry.js` | `registerWorkflow / getWorkflow / listWorkflows`；空启动，C2+ 填充 |

## 使用

```js
import { runWorkflow } from './orchestrator/graph-runtime.js';
import { registerWorkflow } from './orchestrator/workflow-registry.js';
import { myGraph } from './workflows/my-flow.graph.js';

// 启动时注册一次（Phase C2 起 workflows/index.js 集中注册）
registerWorkflow('my-flow', myGraph);

// tick 分派
await runWorkflow('my-flow', task.id, task.attempt_n ?? 1, task);
```

## Phase C 路线图

| Phase | 本目录变化 |
|---|---|
| **C1（本 PR）** | 建 3 个模块 + 测试，不接线任何调用方 |
| C2 | 新 `workflows/dev-task.graph.js`；tick.js 加 `WORKFLOW_RUNTIME=v2` 灰度 |
| C3 | 搬 `harness-gan-graph.js` → `workflows/harness-gan.graph.js` subgraph |
| C4 | 搬 `harness-initiative-runner.js` → `workflows/harness-initiative.graph.js`（组合 C3 subgraph）|
| C5 | 搬 `content-pipeline-graph.js` → `workflows/content-pipeline.graph.js` |
| C6 | tick.js 瘦身到 ≤ 200 行，路由表 `taskTypeToWorkflow` |
| C7 | 清老 runner + 清 WORKFLOW_RUNTIME flag | ✅ 完成（PR flip-default-langgraph-flags） |

## 硬约束（spec §6，每 PR 必守）

- **thread_id = `{taskId}:{attemptN}`**：retry 递增 attemptN 开新 thread，不复用老 checkpoint
- **PgCheckpointer 单例**：所有 graph 共用；禁 MemorySaver（C2 起 CI grep 守门）
- **graph node 内禁同步 >50ms**：只允许 `spawn()` / 异步 DB / 轻 transform；禁 `execSync` / 大 JSON.parse / 同步 IO
- **每 Phase 末崩溃重启 resume 验证**（spec §6.5）：C2 起每次合前必跑

## 调用链

```
tick.js (L1 Scheduler)
  ↓ selectNextDispatchableTask → task
  ↓ runWorkflow(workflowName, task.id, attemptN, task).catch(logError)   ← fire-and-forget
  ↓
graph-runtime.runWorkflow
  ├─ getWorkflow(name)           ← workflow-registry
  ├─ checkpointerHasThread()     ← pg-checkpointer
  └─ graph.invoke(input, config) ← LangGraph compiled graph
      ↓ node-1 → node-2 → ...
      ↓ spawn(opts)  ← L3 Executor（packages/brain/src/spawn/）
      ↓ runDocker → agent
```

## 测试

`__tests__/graph-runtime.test.js` 覆盖：
1. thread_id 格式正确（taskId + attemptN 拼接）
2. 非法参数 throws（空 taskId / attemptN 非正整数）
3. 未注册 workflow 抛 `workflow not found`
4. has-checkpoint 时传 null（resume），无时传 input（fresh）

Mock 策略：`vi.mock('@langchain/langgraph-checkpoint-postgres')` 返回 stub `PostgresSaver.fromConnString`；每个 it 前 `_clearRegistryForTests()` + `_resetPgCheckpointerForTests()`。
