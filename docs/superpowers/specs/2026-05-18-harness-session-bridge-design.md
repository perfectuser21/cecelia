# Harness Session Bridge 设计文档

**日期**: 2026-05-18  
**分支**: cp-0518093211-harness-session-bridge

---

## 问题陈述

Harness pipeline 由 5 类步骤组成，每步是独立 Docker 容器内的 Claude Code session：

| 步骤 | 节点 | 容器命名规则 |
|------|------|-------------|
| Planner | `runPlannerNode` | `cecelia-task-${taskId[:12]}` |
| GAN Proposer | `proposer()` (每轮) | `cecelia-task-${taskId[:12]}` |
| GAN Reviewer | `reviewer()` (每轮) | `cecelia-task-${taskId[:12]}` |
| Generator | `runSubTaskNode` → sub-graph | `cecelia-task-${subTaskId[:12]}` |
| Evaluator | `finalEvaluateFn` | `cecelia-task-${taskId[:12]}` |

**当前 Brain 重启后的失败路径**：
1. Brain 进程死亡，Docker 容器继续运行（独立进程）
2. `startup-sync` 把任务重排队（`resume_from_checkpoint: true`）
3. LangGraph 从 checkpoint 恢复到上次完成的节点
4. 节点重入 → `executor()` 重新 spawn → Docker 报 **"container name already in use"** 冲突
5. 节点抛错 → initiative 失败

**根本原因**：LangGraph checkpoint 保存了节点进度，但没有保存正在运行的容器名称和 Claude Code session UUID，无法在重入时判断"容器是否已在运行"。

---

## 目标

Brain 重启后，harness 节点重入时能：
1. **容器运行中** → 等待其自然完成，读取输出，不重新 spawn
2. **容器已正常退出** → 直接读取输出文件（`.brain-result.json` / `sprint-prd.md`），跳过 spawn
3. **容器消失（OOM/强制删除）且有 session UUID** → `claude --resume <uuid>` 接续
4. **完全没有记录** → 正常 fresh start

---

## 架构

### 数据流

```
cecelia-run.sh
  生成 SESSION_UUID
  写 $WORK_DIR/.cecelia-session-uuid    ← 新增
  
executor() 返回 { container, exit_code, ... }

harness-session-bridge.js（新建）
  读 $worktreePath/.cecelia-session-uuid
  返回 enrichedResult = { ...result, session_uuid }

各节点存入 LangGraph state:
  planner_session = { container, session_uuid }
  gan.session_map[round] = { container, session_uuid, role }
  evaluator_session = { container, session_uuid }

节点重入时:
  harness-session-bridge.reconnectOrSpawn()
    → pollDockerStatus() [非阻塞轮询]
    → 三条路径（见下）
```

### 三条重连路径

```
pollDockerStatus(container)
  ├── 'running'    → waitForContainerExit (轮询 docker inspect, 非阻塞)
  │                  → readOutputFiles(worktreePath)
  ├── 'exited_ok'  → 验证 mtime > containerStartedAt（防读旧轮残留）
  │                  → readOutputFiles(worktreePath)
  ├── 'exited_err' → claude --resume session_uuid（最优先，不烧重复 token）
  │                  OR fresh start（session_uuid 为 null 时）
  └── 'gone'       → claude --resume session_uuid（session 文件可能仍在）
                     OR fresh start（session_uuid 为 null 时）
```

**非阻塞等待**：使用 `setInterval` + Promise（轮询 `docker inspect --format '{{.State.Status}}'`），不使用 `docker wait`（会阻塞 Node.js 事件循环）。

---

## 组件设计

### 1. `cecelia-run.sh`（修改）

在 SESSION_UUID 生成后（行 596 之后）立即写文件：

```bash
SESSION_UUID=$(python3 -c 'import uuid; print(uuid.uuid4())')
# 写入 worktree（Brain 可读）
echo "$SESSION_UUID" > "$ACTUAL_WORK_DIR/.cecelia-session-uuid" 2>/dev/null || true
```

**约束**：
- `ACTUAL_WORK_DIR` 在行 450 左右已设置，此时可用
- 写失败不阻断（`|| true`），向后兼容

### 2. `packages/brain/src/harness-session-bridge.js`（新建）

接口：

```js
// 主入口：节点重入时调用，代替直接 executor()
export async function reconnectOrSpawn({ nodeKey, state, executor, taskArg, worktreePath, readOutput })
// → { ...result, session_uuid? }

// 执行后：调用方存入 state
export function makeSessionRecord(result) 
// → { container: result.container, session_uuid: result.session_uuid ?? null }

// 内部：Docker 状态轮询（非阻塞）
async function pollDockerStatus(containerName)
// → 'running' | 'exited_ok' | 'exited_err' | 'gone'

async function waitForContainerExit(containerName, { pollIntervalMs = 5000, timeoutMs = 90*60*1000 })

// 内部：读 session UUID
async function readSessionUuid(worktreePath)
// → string | null
```

### 3. `harness-initiative.graph.js`（修改）

**State 新增字段**（`InitiativeState` Annotation.Root 中）：

```js
planner_session:   Annotation({ reducer: (_o, n) => n, default: () => null }),
evaluator_session: Annotation({ reducer: (_o, n) => n, default: () => null }),
```

**`runPlannerNode` 修改**：
- 重入时：`state.planner_session?.container` 存在 → 走 `reconnectOrSpawn`
- 完成后：返回 `planner_session: makeSessionRecord(result)`
- `readOutput`：检查 `sprint-prd.md` 存在且 mtime > containerStartedAt → 读文件内容

**`finalEvaluateFn` 修改**（类似）

### 4. `harness-gan.graph.js`（修改）

**GanContractState 新增字段**：

```js
session_map: Annotation({
  reducer: (old, neu) => ({ ...(old ?? {}), ...(neu ?? {}) }),  // shallow merge，key = round
  default: () => ({})
}),
```

**`proposer()` / `reviewer()` 修改**：
- 重入检查：`state.session_map[state.round]` 存在 → `reconnectOrSpawn`
- 完成后：返回 `session_map: { [state.round]: makeSessionRecord(result) }`
- `readOutput`：读 `.brain-result.json`，验证 `mtime > containerInfo.startedAt`（防旧轮残留）

### 5. `harness-task.graph.js`（修改）

`runSubTaskNode` 的子图 `spawnNode` 中加 session 记录，存入子图 state，通过 callback 回传给父图。

---

## 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| GAN 多轮，Brain 在第 2 轮 proposer 中重启 | `session_map[2]` 有记录 → reconnect 第 2 轮容器 |
| 容器被 OOM kill（exit code 137）| `exited_err` → `claude --resume` 或 fresh start |
| `.cecelia-session-uuid` 文件写入失败 | `readSessionUuid` 返回 null → 降级为 fresh start |
| `.brain-result.json` mtime < containerStartedAt | 判定为旧轮残留 → 不使用，走 fresh start |
| `docker inspect` 命令不可用 | try/catch → 返回 'gone' → fresh start |
| reconnect 超时（90min 无进展）| 同现有 SUBGRAPH_WAIT_MS 逻辑，标 failed |

---

## 测试策略

### Unit Tests（`packages/brain/src/__tests__/harness-session-bridge.test.js`）

测试 `reconnectOrSpawn` 的三条路径，mock `docker inspect` 和 `readOutput`：

```js
it('running → waitForExit → readOutput, executor not called', ...)
it('exited_ok + fresh mtime → readOutput only, executor not called', ...)
it('exited_ok + stale mtime → fresh start', ...)
it('gone + session_uuid → claude --resume', ...)
it('gone + no session_uuid → fresh start', ...)
it('no existing session in state → fresh start', ...)
```

### Integration Tests（`packages/brain/src/workflows/__tests__/harness-session-reconnect.integration.test.js`）

使用真实 MemorySaver + mock executor + mock docker：

```js
it('planner 节点重入：state 含 planner_session → 不调 executor，读 sprint-prd.md', ...)
it('GAN round=2 重入：session_map[2] 存在 → reconnect round 2 容器', ...)
it('完整节点序列：planner_session 写入 checkpoint → 重建 graph → 仍可读到', ...)
```

### E2E（`packages/brain/scripts/smoke/harness-session-bridge-smoke.sh`）

在真实 Brain 上：

```bash
# 启动一个 harness initiative，等 planner 容器起来
# 杀 Brain 进程
# 重启 Brain
# 验证 harness 从 planner 重连（不重新 spawn）而不是失败
# 验证最终 status=completed
```

---

## 约束

- 不引入新的 npm 依赖（`docker inspect` 通过 `child_process.execFile` 调用）
- `cecelia-run.sh` 改动向后兼容（`.cecelia-session-uuid` 文件可选）
- 不改变 harness 正常路径的行为（`state[nodeKey]` 为 null 时直接 fresh start）
- GAN session_map reducer 使用 shallow merge，不丢失已完成轮次的记录
