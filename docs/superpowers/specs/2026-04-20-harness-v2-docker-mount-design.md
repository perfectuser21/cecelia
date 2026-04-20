# Harness v2 Docker 容器仓库挂载 + GitHub 凭据注入（PR-1/4）

**日期**：2026-04-20
**分支**：cp-0420152150-harness-v2-docker-mount
**Brain Task**：bf2a9f9d-959b-4232-86ca-f8b5bbc4ef7e
**上游根因追溯**：Initiative `b94cde3b` 实测 E2E 失败——容器内 agent 报错 `/workspace is not a git repo in this sandbox, so the worktree→PR→CI path couldn't be walked`

## 背景

Harness v2 Pipeline 需要容器内的 Claude Code agent 能真实 `git push` + `gh pr create`。当前 `harness-initiative-runner.js` 调用 `executeInDocker` 时没传 `worktreePath`，docker-executor 回落到默认值（主仓库），但：

1. 主仓库不是 worktree，agent 无法切分支
2. 容器内没有 `GITHUB_TOKEN`，即使能 git commit 也 push 不了
3. 没有独立隔离目录，多个 Task 并发时会互相覆写

## 目标

手术刀级补全容器挂载 + 凭据。本 PR 只解决"让 agent 进容器后有 git repo + 能 push"，不涉及 Phase 状态机和 GAN 循环（留给后续 PR-2/3/4）。

## 非目标

- `executor.js` 的 `harness_task` 分支派发（PR-2）
- `tick.js` 的 `advanceHarnessInitiatives()` phase 推进器（PR-3）
- `harness-initiative-runner.js` 集成 Phase A GAN Proposer/Reviewer（PR-4）
- cleanup worktree 的自动触发时机（只导出函数，不接线）

## 架构

```
runInitiative(task)
  ├─ ensureHarnessWorktree({taskId, initiativeId})
  │    └─ git worktree add .claude/worktrees/harness-v2/task-<shortid> -b harness-v2/<shortid>
  ├─ resolveGitHubToken()
  │    └─ process.env.GITHUB_TOKEN → $(gh auth token) → ~/.credentials/github.env → throw
  └─ executeInDocker({
       worktreePath: <harness-v2-worktree>,
       env: { ...existing, GITHUB_TOKEN: <token> }
     })
     └─ 容器内 /workspace 是一个 git worktree（cecelia 仓库的分支）
        └─ agent 可 git add / commit / push、gh pr create
```

## 组件

### 新增：`packages/brain/src/harness-worktree.js`

```
ensureHarnessWorktree({ initiativeId, taskId, baseRepo = DEFAULT_REPO }) -> Promise<string>
  - 计算目录：<baseRepo>/.claude/worktrees/harness-v2/task-<taskId.slice(0,8)>
  - 幂等：
      存在且 `git -C <dir> rev-parse --is-inside-work-tree` 为 true → 返回路径
      不存在 → git worktree add <dir> -b harness-v2/task-<shortid>（base=main）
  - 返回绝对路径

cleanupHarnessWorktree(path) -> Promise<void>
  - git worktree remove --force <path>
  - 幂等：不存在也不抛
  - 注：本 PR 不自动调用，留给后续 PR 接入 Phase C 合并后清理
```

### 新增：`packages/brain/src/harness-credentials.js`

```
resolveGitHubToken() -> Promise<string>
  - 优先级：
      1) process.env.GITHUB_TOKEN（非空）
      2) `gh auth token` 命令输出（非空）
      3) 读 ~/.credentials/github.env 的 GITHUB_TOKEN= 行
      4) 都没 → throw new Error('github_token_unavailable')
  - token 绝不 console.log
```

### 修改：`packages/brain/src/harness-initiative-runner.js` 约 line 97-108

插桩两行，调用处补两个字段：

```js
const worktreePath = await ensureHarnessWorktree({ initiativeId, taskId });
const githubToken = await resolveGitHubToken();

const result = await executor({
  task: { ...task, task_type: 'harness_planner' },
  prompt,
  worktreePath,                                 // 新增
  env: {
    CECELIA_CREDENTIALS: 'account1',
    CECELIA_TASK_TYPE: 'harness_planner',
    HARNESS_NODE: 'planner',
    HARNESS_SPRINT_DIR: sprintDir,
    HARNESS_INITIATIVE_ID: initiativeId,
    GITHUB_TOKEN: githubToken,                  // 新增
  },
});
```

## 错误处理

| 场景 | 行为 |
|------|------|
| `resolveGitHubToken` 三路都失败 | runInitiative 抛 `{success:false, error:'github_token_unavailable'}`，不建 contract/run |
| `ensureHarnessWorktree` 失败（磁盘满、分支冲突） | runInitiative 抛 `{success:false, error:'worktree_create_failed: <msg>'}` |
| token 泄漏 | redact 日志；永不 `console.log(env)`；只打印 `GITHUB_TOKEN: <present/missing>` |
| 并发 Task 撞同一 shortid | `taskId.slice(0,8)` 几乎不会碰撞；万一撞则幂等复用（同 Task 重跑场景） |

## 数据流

无 DB schema 变更。只改容器启动参数。

## 测试策略

### 单元测试

1. **`packages/brain/src/__tests__/harness-worktree.test.js`**
   - mock `child_process.execSync` 验证 git worktree add 命令构造正确
   - 幂等场景：目录存在时不再 add
   - cleanup 对不存在目录不抛

2. **`packages/brain/src/__tests__/harness-credentials.test.js`**
   - 优先级：env > gh > file > throw
   - env 空串不算 hit（继续走下游）
   - 全失败 throw `github_token_unavailable`

3. **`packages/brain/src/__tests__/harness-initiative-runner-container-mount.test.js`**
   - mock executor，断言 spawn 调用时 `worktreePath` 非空且含 `.claude/worktrees/harness-v2/`
   - 断言 `env.GITHUB_TOKEN` 非空
   - 断言 token 未进 stdout/stderr 输出

## 成功标准

- [BEHAVIOR] runner spawn 调用传 `worktreePath` 非空且含 `harness-v2` 片段。Test: packages/brain/src/__tests__/harness-initiative-runner-container-mount.test.js
- [BEHAVIOR] runner spawn 调用传 `env.GITHUB_TOKEN` 非空。Test: packages/brain/src/__tests__/harness-initiative-runner-container-mount.test.js
- [BEHAVIOR] `resolveGitHubToken` 按 env > gh CLI > file > throw 顺序解析。Test: packages/brain/src/__tests__/harness-credentials.test.js
- [ARTIFACT] 新文件 `packages/brain/src/harness-worktree.js` 存在，导出 `ensureHarnessWorktree`/`cleanupHarnessWorktree`
- [ARTIFACT] 新文件 `packages/brain/src/harness-credentials.js` 存在，导出 `resolveGitHubToken`

## 回滚

三件事：
1. revert 这个 PR
2. 现有 Initiative `b94cde3b` 不受影响（它本来就卡住了）
3. 不改 DB/不改接口/不改线上 v4 流水线
