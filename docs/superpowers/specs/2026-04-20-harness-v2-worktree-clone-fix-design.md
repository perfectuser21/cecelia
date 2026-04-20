# Harness v2 Worktree 用独立 clone 替代 linked worktree（PR-5）

**日期**：2026-04-20
**分支**：cp-0420191915-harness-v2-worktree-clone-fix
**Brain Task**：207f0731-3495-48aa-8e5c-cb8a4fe89147

## 背景

PR-1 的 `ensureHarnessWorktree` 用 `git worktree add -b <branch> main` 创建 linked worktree。linked worktree 的 `.git` 是**一个文件**，内容形如 `gitdir: /abs/path/to/main-repo/.git/worktrees/<name>`。

真机 E2E 跑 Initiative `421c8aaa` 时发现：
```
[docker-executor] exit task=421c8aaa code=128 duration=8814ms
[runner] planner failed: Docker exit=128: fatal: not a git repository:
    /Users/administrator/perfect21/cecelia/.git/worktrees/task-421c8aaa
```

容器只挂 worktree 目录到 `/workspace`，主仓库 `.git/` 没挂，`.git` 文件指向的路径在容器里不存在，所有 git 命令报 "not a git repository"。

另一个并发问题：zombie-sweep 清理 worktree **目录**但不清 git branch，第二次跑会报 `fatal: a branch already exists`。

## 目标

改 `ensureHarnessWorktree` 用独立 clone，产出完整 self-contained git repo，容器挂载即可用。

## 非目标

- zombie-sweep 对 harness-v2 worktree 的识别改进（留 PR-6）
- 自动 cleanup worktree 的 tick 接入（留 PR-6）

## 架构

```
ensureHarnessWorktree({ taskId, baseRepo })
  ├─ 计算 wtPath = <baseRepo>/.claude/worktrees/harness-v2/task-<shortid>
  ├─ 幂等：已存在 + git rev-parse 通过 → 返回 wtPath
  └─ 新建：
       git clone --local --no-hardlinks --branch main --single-branch <baseRepo> <wtPath>
       git -C <wtPath> checkout -b harness-v2/task-<shortid>
```

`--local`：本地文件 URL-style clone（比 http 快）
`--no-hardlinks`：不用 hardlink 主仓库 `.git/objects` → 避免容器里 pack 丢失
`--branch main --single-branch`：只拉 main 分支，最省带宽/磁盘

## 组件

### 修改 `packages/brain/src/harness-worktree.js`

```js
export async function ensureHarnessWorktree(opts) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
  const statFn = opts.statFn || defaultStat;
  const sid = shortId(opts.taskId);
  const branch = `harness-v2/task-${sid}`;
  const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${sid}`);

  if (await statFn(wtPath)) {
    try {
      const { stdout } = await execFn('git', ['-C', wtPath, 'rev-parse', '--is-inside-work-tree']);
      if (String(stdout || '').trim() === 'true') return wtPath;
    } catch { /* not a repo, re-create */ }
  }

  await execFn('git', [
    'clone', '--local', '--no-hardlinks',
    '--branch', 'main', '--single-branch',
    baseRepo, wtPath,
  ]);
  await execFn('git', ['-C', wtPath, 'checkout', '-b', branch]);
  return wtPath;
}

export async function cleanupHarnessWorktree(wtPath, opts = {}) {
  const rmFn = opts.rmFn || ((p) => fs.rm(p, { recursive: true, force: true }));
  try { await rmFn(wtPath); } catch { /* idempotent */ }
}
```

`cleanupHarnessWorktree` 不再调 `git worktree remove`（linked worktree 才用）；直接 `fs.rm -rf`。

### 测试 `packages/brain/src/__tests__/harness-worktree.test.js`

替换原 "creates new worktree when dir does not exist" 测试：
- 断言 `git clone --local --no-hardlinks --branch main --single-branch <baseRepo> <wtPath>` 被调用
- 断言 `git -C <wtPath> checkout -b harness-v2/task-<shortid>` 被调用
- 不再期望 `git worktree add`

"returns existing path when dir already a worktree (idempotent)" 测试：保留但变成 "returns existing path when dir is a git repo"。不再期望 `git worktree add` 不被调（改为期望 clone 不被调）。

"cleanupHarnessWorktree 调 git worktree remove" 测试改成：断言 `rmFn` 被调用，path 一致。"path missing 不抛" 保留。

## 数据流

无 DB 变更。只改本地 filesystem 操作。

## 错误处理

| 场景 | 行为 |
|------|------|
| clone 失败（磁盘满、base repo 损坏） | throw，runInitiative 上游返回 `{success:false}` |
| checkout -b 失败（分支名非法） | throw |
| wtPath 存在但不是 git repo（被半清） | try catch 后重新 clone（但 wtPath 存在时 clone 会报错）→ 先 `fs.rm` 再 clone |

为简化，idempotent 检查失败时：改为先 `fs.rm -rf wtPath` 再 clone。保证"要么复用要么全新"。

更新伪码：
```js
if (await statFn(wtPath)) {
  try {
    const { stdout } = await execFn('git', ['-C', wtPath, 'rev-parse', '--is-inside-work-tree']);
    if (String(stdout || '').trim() === 'true') return wtPath;
  } catch { /* fall through */ }
  // wtPath 存在但不是 git repo：清掉重建
  await fs.rm(wtPath, { recursive: true, force: true });
}

await execFn('git', ['clone', ...]);
await execFn('git', ['-C', wtPath, 'checkout', '-b', branch]);
return wtPath;
```

## 成功标准

- [ ] [BEHAVIOR] ensureHarnessWorktree 调 git clone 创建独立 repo（不再 git worktree add）。Test: packages/brain/src/__tests__/harness-worktree.test.js
- [ ] [BEHAVIOR] clone 参数含 `--local --no-hardlinks --branch main --single-branch`。Test: 同上
- [ ] [BEHAVIOR] checkout 到 `harness-v2/task-<sid>` 新分支。Test: 同上
- [ ] [BEHAVIOR] cleanupHarnessWorktree 调 fs.rm（不再 git worktree remove）。Test: 同上
- [ ] [ARTIFACT] harness-worktree.js 源码不再出现 `'worktree', 'add'` 字符串。Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');process.exit(!c.includes(\"'worktree', 'add'\")?0:1)"

## 回滚

- revert PR-5 → 回到 PR-1 linked worktree（容器里 git 不可用状态）
- 不影响 PR-2/3/4（它们的接口不依赖 worktree 内部结构）

## 风险

- clone 速度：cecelia 主仓库 ~500MB，本地 clone 5-10s（SSD 预期）。可接受。
- 磁盘占用：每 Task ~500MB。4-5 Task/Initiative = 2-3GB。需 PR-6 接入 cleanup 钩子，防止堆积。
- 容器内 git push：clone 出来的 repo `origin` 指向本地主仓库文件路径。要改 push URL 到 GitHub？不需要——agent 用 `gh pr create` 推分支，gh 用 GITHUB_TOKEN 推到 GitHub remote，不通过本地 origin。但 `git remote add github https://github.com/perfectuser21/cecelia.git` 可能需要。container 的 entrypoint.sh 已有 git config，可能要补 remote config 逻辑——观察 PR-5 跑通后若 push 失败再加 PR-7。
