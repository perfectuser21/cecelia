# Harness v2 `harness_task` 容器派发分支（PR-2/4）

**日期**：2026-04-20
**分支**：cp-0420175006-harness-v2-task-dispatch
**Brain Task**：1bfabb0f-0ca0-4306-ab46-7593c8057de6
**基于**：PR-1 (#2469) 提供的 `ensureHarnessWorktree` / `resolveGitHubToken`

## 背景

PR-1 让容器能挂载 git worktree + 注入 GITHUB_TOKEN，但**只改了 Planner 路径**。Phase B 子 Task（`task_type=harness_task`）目前没有走容器的 executor 分支，当 tick dispatcher 拉起它们时，它们会落到默认路径（bridge headless Claude Code / 原有 harness v4 派发），绕过了 PR-1 的成果，也意味着 agent 拿不到独立 worktree + token。

## 目标

在 `executor.js` 的 `triggerCeceliaRun(task)` 入口早期，给 `harness_task` 加专属分支，调 `triggerHarnessTaskDispatch(task)` 用 Docker 容器跑 `/harness-generator`。

## 非目标（后续 PR）

- PR-3：tick.js 加 `advanceHarnessInitiatives()` phase 晋级
- PR-4：`harness-initiative-runner.js` 集成 GAN Proposer/Reviewer 循环

## 架构

```
tick dispatcher
  └─ executor(task)   // triggerCeceliaRun in executor.js ~line 2763
       ├─ if task.task_type === 'harness_initiative' → runInitiative (PR-0 已接)
       ├─ if task.task_type === 'harness_task'       → triggerHarnessTaskDispatch (本 PR)
       └─ else                                       → 原有默认路径
```

## 组件

### 新增 `packages/brain/src/harness-task-dispatch.js`

**签名**：
```
triggerHarnessTaskDispatch(task, deps?) -> Promise<{ success, result?, cost_usd?, error? }>
  deps = {
    executor?: Function,          // 默认 executeInDocker from docker-executor.js
    ensureWorktree?: Function,    // 默认 ensureHarnessWorktree
    resolveToken?: Function,      // 默认 resolveGitHubToken
  }
```

**行为**：
1. 读 `task.payload.parent_task_id`（Initiative task id）→ 作为 `initiativeId`
2. 调 `ensureWorktree({ taskId: task.id, initiativeId })` 拿独立 worktree 路径
3. 调 `resolveToken()` 拿 GitHub token
4. 构造 prompt（`/harness-generator\n\ntask_id: ...\nfix_mode: ...\ndod: ...\ncontract_excerpt: ...`）
5. 调 `executor({ task, prompt, worktreePath, env: {...} })` 其中 env 至少包含：
   - `CECELIA_CREDENTIALS: 'account1'`
   - `CECELIA_TASK_TYPE: 'harness_task'`
   - `HARNESS_NODE: 'generator'`
   - `HARNESS_INITIATIVE_ID: <parent>`
   - `HARNESS_TASK_ID: <task.id>`
   - `HARNESS_FIX_MODE: 'true' | 'false'`（来自 `task.payload.fix_mode`）
   - `GITHUB_TOKEN: <token>`
6. prep 阶段（helper）失败 → 立即 `{success:false, error}` 不起容器
7. 容器 exit=0 → `{success:true, result, cost_usd}`；非 0 → `{success:false, error}`

### 修改 `packages/brain/src/executor.js`

定位：`triggerCeceliaRun(task)` ~line 2763，在现有 `harness_initiative` 分支（~line 2807）下面再加一块：

```js
if (task.task_type === 'harness_task') {
  try {
    const { triggerHarnessTaskDispatch } = await import('./harness-task-dispatch.js');
    return await triggerHarnessTaskDispatch(task);
  } catch (err) {
    console.error(`[executor] harness_task dispatch failed task=${task.id}: ${err.message}`);
    return { success: false, error: err.message };
  }
}
```

仅增不删，不影响任何现有路径。

## 数据流

- 父 Initiative Runner (PR-0) 已把 4-5 个 subtask 写到 `tasks` 表，`payload.parent_task_id = initiative task id`
- tick dispatcher 拿 `harness_task` status=queued → 调 executor
- executor 走新分支 → 容器跑 → agent 产 PR → task.result.pr_url 回写 → task.status=completed

（注：tick 晋级 + dispatch 触发条件在 PR-3 补，当前 PR 只负责"被调到的时候怎么跑"）

## 错误处理

| 场景 | 行为 |
|------|------|
| helpers 抛 `github_token_unavailable` | `{success:false, error}`，不触发容器 |
| helpers 抛 worktree 创建失败 | 同上 |
| 容器 exit!=0 | `{success:false, error}`（带 stdout/stderr 片段） |
| 容器 timeout | docker-executor 已有 watchdog，返回 timed_out=true，映射为 paused（tick 处理） |
| Token 进日志 | env 对象构造完只传给 executor，不 `console.log(env)` |

## 测试

`packages/brain/src/__tests__/harness-task-dispatch.test.js`：

1. harness_task 走容器（mock executor 被调）
2. spawn 传 `worktreePath`（含 `harness-v2`）
3. spawn 传 `env.GITHUB_TOKEN` 非空
4. payload.fix_mode=true → `env.HARNESS_FIX_MODE==='true'`
5. payload.fix_mode 缺省/false → `env.HARNESS_FIX_MODE==='false'`
6. helpers 抛 → 返回 `{success:false}` 不调 executor
7. 容器 exit=0 → 返回 `{success:true}`
8. 容器 exit=1 → 返回 `{success:false}`

## 成功标准

- [ ] [BEHAVIOR] executor.js 含 `harness_task` 分支 → 调 `triggerHarnessTaskDispatch`。Test: grep + 集成
- [ ] [BEHAVIOR] `triggerHarnessTaskDispatch` 传 `worktreePath` 到 executor。Test: packages/brain/src/__tests__/harness-task-dispatch.test.js
- [ ] [BEHAVIOR] `triggerHarnessTaskDispatch` 传 `env.GITHUB_TOKEN` 到 executor。Test: 同上
- [ ] [BEHAVIOR] `fix_mode` payload 正确映射到 `env.HARNESS_FIX_MODE`。Test: 同上
- [ ] [ARTIFACT] 新文件 `packages/brain/src/harness-task-dispatch.js` 存在，导出 `triggerHarnessTaskDispatch`

## 回滚

- revert 这个 PR
- harness_task 子任务会回落到默认路径（就是目前卡住的状态）
- 不影响其他任何类型的任务
