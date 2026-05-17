# 设计文档：三联修复 — deploy容器冲突 + harness重启丢检查点 + sprint_dir检测不稳

**日期**：2026-05-17  
**任务 ID**：2763fb71-746a-43cb-b63c-54d94d6d6490  
**分支**：cp-0517082346-fix-deploy-harness-sprintdir

---

## 背景

三个互相干扰的问题导致 harness pipeline 每次 Brain 重启都从头重跑：

1. `brain-deploy.sh` 部署时容器命名冲突 → Brain DOWN
2. Brain 重启后 `syncOrphanTasksOnStartup` 把 `in_progress` 的 harness 任务 reset 为 queued（从头重跑）
3. Planner 写 `sprints/` 子目录但 LangGraph state 里 `sprintDir` 解析不到，Proposer ENOENT

---

## Fix 1：brain-deploy.sh 容器命名冲突

### 文件
`scripts/brain-deploy.sh`，L215-217

### 根因
`docker compose up -d` 前的清理只处理 `exited` 和 `created` 两个状态。当旧容器处于 `restarting`/`pausing`/`dead` 状态，或由外部 project 创建的 `running` 容器时，compose 无法 stop+remove，新容器创建失败（命名冲突）。

### 方案
部署前无条件 stop+rm 所有名为 `cecelia-node-brain` 的容器（不限状态）：

```bash
# 取代原 L215-217
EXISTING_IDS=$(docker ps -a --filter "name=^/cecelia-node-brain$" -q 2>/dev/null || true)
if [[ -n "$EXISTING_IDS" ]]; then
  echo "  Removing existing cecelia-node-brain container(s)..."
  echo "$EXISTING_IDS" | xargs docker rm -f 2>/dev/null || true
fi
```

使用 `^/cecelia-node-brain$` 精确匹配（避免前缀误匹配）。放置位置：L207-213 幂等检查（image SHA 一致则 exit 0）**之后**，`docker compose up -d` **之前**，保持幂等检查有效。

### 测试策略
- unit：验证 `scripts/brain-deploy.sh` 中 `^/cecelia-node-brain$` filter 出现（文件检查）
- smoke：`packages/brain/scripts/smoke/brain-deploy-smoke.sh` — 模拟旧容器存在场景

---

## Fix 2：harness_initiative 任务 Brain 重启后丢失 LangGraph 检查点

### 文件
`packages/brain/src/executor.js`，`syncOrphanTasksOnStartup` 函数（约 L3627）

### 根因
`SELECT` 无 `task_type` 字段，所有 `in_progress` 任务被当成 OS 进程孤儿：
- `isTaskProcessAlive()` 对 LangGraph 同步任务永远返回 false（无子进程）
- 走 `requeue` 分支 → `status=queued, watchdog_retry_count=0` → LangGraph checkpoint 丢失，从头 Attempt N+1

### 方案
`harness_initiative` 的正确重启语义：保持/重置为 `queued` + `payload.resume_from_checkpoint = true`，让 dispatcher 在下一 tick 重新 invoke，LangGraph 从 checkpoint 续跑。

```js
// SELECT 加 task_type
const result = await pool.query(`
  SELECT id, title, payload, started_at, error_message, task_type
  FROM tasks
  WHERE status = 'in_progress'
`);

// loop 开头
const LANGGRAPH_TYPES = new Set(['harness_initiative']);
for (const task of result.rows) {
  if (LANGGRAPH_TYPES.has(task.task_type)) {
    // 恢复为 queued + 标记 resume，让 dispatcher 下次 tick 从 checkpoint 续跑
    await pool.query(`
      UPDATE tasks
      SET status = 'queued',
          payload = payload || '{"resume_from_checkpoint": true}'::jsonb,
          updated_at = NOW()
      WHERE id = $1
    `, [task.id]);
    console.log(`[startup-sync] LangGraph task re-queued with checkpoint resume: ${task.id} (${task.title})`);
    continue;
  }
  // 原有 OS 进程孤儿检测逻辑...
}
```

`runHarnessInitiativeRouter` 已有 `resume_from_checkpoint` 判断逻辑（L2818-2821），设置后会从已有 thread_id 的 checkpoint 恢复，不会新建 Attempt。

### 测试策略
- unit：`packages/brain/src/__tests__/executor-startup-sync.test.js` — mock pool，验证 harness_initiative 任务被 re-queued + resume flag，普通 dev 任务走原逻辑

---

## Fix 3：sprint_dir 检测不稳定

### 文件
`packages/brain/src/workflows/harness-initiative.graph.js`

### 根因
**双重根因：**
1. `parsePrdNode` B37（L654-659）用 `git diff --name-only origin/main HEAD -- sprints/`，但 Planner 的 commit 可能不在当前 HEAD（branch 切换后），diff 为空 → 回退 LLM 文本解析（不稳定）
2. `runSubTaskNode` B38（L1058-1062）把 `state.sprintDir` 写入 graph state 的 subTask.payload，但不写 DB；Brain 重启后 dispatcher 从 DB 读到旧的顶级 `sprints/`

### 方案

**改动1：git log + find 双重检测**

```js
// 替换 L654-659 的 git diff
let sprintDir = task.payload?.sprint_dir || 'sprints';

// 方案A：git log 检测新增文件（覆盖多 commit 场景）
try {
  const { stdout: logOut } = await execFile('git',
    ['log', '--diff-filter=A', '--name-only', '--format=', 'origin/main..HEAD', '--', 'sprints/'],
    { cwd: state.worktreePath }
  );
  const subdirs = [...new Set(
    logOut.trim().split('\n')
      .filter(Boolean)
      .map(f => f.split('/').slice(0, 2).join('/'))
      .filter(p => p.startsWith('sprints/'))
  )];
  if (subdirs.length === 1) sprintDir = subdirs[0]; // 保留完整相对路径，如 "sprints/ws1"
} catch (_) {}

// 方案B fallback：文件系统 find（覆盖未 commit 场景）
if (sprintDir === (task.payload?.sprint_dir || 'sprints')) {
  try {
    const { stdout: findOut } = await execFile('find',
      [path.join(state.worktreePath, 'sprints'), '-maxdepth', '1', '-mindepth', '1', '-type', 'd'],
      { cwd: state.worktreePath }
    );
    const dirs = findOut.trim().split('\n').filter(Boolean);
    if (dirs.length === 1) {
      sprintDir = path.relative(state.worktreePath, dirs[0]); // "sprints/ws1" 
    }
  } catch (_) {}
}
```

**改动2：upsertTaskPlan 时写入 payload.sprint_dir**

在 `upsertTaskPlan` 调用处（约 L720），将 `effectiveSprintDir` 传入每个子任务的 payload，确保 DB 持久化正确路径：

```js
// upsertTaskPlan 函数签名增加 overrideSprintDir 参数
// 在构建 subtask payload 时：
payload: {
  ...existingPayload,
  sprint_dir: overrideSprintDir || existingPayload.sprint_dir || 'sprints',
}
```

### 测试策略
- unit：`packages/brain/src/__tests__/harness-initiative-sprintdir.test.js` — mock execFile，验证 git log 空时 find fallback 正常工作；验证 upsertTaskPlan 写入 sprint_dir

---

## 成功标准

- [ ] brain-deploy.sh 部署时不再因容器命名冲突导致 Brain DOWN
- [ ] Brain 重启后 harness_initiative 任务 status=queued + resume_from_checkpoint=true，不丢 LangGraph checkpoint
- [ ] sprint_dir 检测在 git log 为空时能通过 find fallback 正确获取子目录
- [ ] 子任务 payload.sprint_dir 在 DB 中与运行时 state.sprintDir 一致

---

## 测试策略汇总

| 层次 | 文件 | 覆盖点 |
|------|------|--------|
| unit | `executor-startup-sync.test.js` | Fix 2：harness_initiative 跳过+requeue+resume flag |
| unit | `harness-initiative-sprintdir.test.js` | Fix 3：git log fallback→find，upsertTaskPlan sprint_dir 写入 |
| file-check | brain-deploy.sh 内容验证 | Fix 1：精确 filter 出现 |
| smoke | `brain-deploy-smoke.sh` | Fix 1：真实 docker 场景端到端 |
