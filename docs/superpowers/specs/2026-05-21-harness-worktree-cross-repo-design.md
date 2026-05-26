# harness-worktree 跨仓库 bug 修复设计

## 问题

`ensureHarnessWorktree` 把 worktree 物理路径派生自 `baseRepo`：
```js
const wtPath = path.join(baseRepo, '.claude/worktrees/harness-v2/task-...')
```
当 `baseRepo = zenithjoy` 时，git clone source = dest 的祖先目录 → 失败。

## 修复设计

拆分两个变量：
- `cloneSource = opts.baseRepo || DEFAULT_BASE_REPO`：clone 源头（可为任意 repo）
- `wtHostRepo = DEFAULT_BASE_REPO`：worktree 物理存放位置（永远是 cecelia）

### 改动范围

**`ensureHarnessWorktree`**（主函数）：
- 第 101 行：`baseRepo` → 拆为 `cloneSource` + `wtHostRepo`
- 第 111 行：`wtPath = path.join(wtHostRepo, ...)` 固定用 cecelia
- 第 135/138 行孤儿校验：改用 `cloneSource`
- 第 173-177 行 clone 命令：source = `cloneSource`，dest = `wtPath`
- 第 183 行 H16 origin URL：改用 `cloneSource`

**`harnessTaskWorktreePath`**（helper）：
- 移除 `opts.baseRepo` 对 wtPath 的影响，固定用 `DEFAULT_BASE_REPO`

**`harnessSubTaskWorktreePath`**（helper）：
- 同上

### 测试策略

**新增测试**（跨 repo 场景，unit test）：
- `ensureHarnessWorktree` cross-repo：验证 `wtPath ⊂ DEFAULT_BASE_REPO` 且 `clone source = zenithjoy`
- `harnessTaskWorktreePath` cross-repo：`opts.baseRepo` 不影响返回路径
- `harnessSubTaskWorktreePath` cross-repo：同上

**更新已有测试**：现有测试传 `baseRepo: '/tmp/cec'` 作 mock，改动后 wtPath 走 `DEFAULT_BASE_REPO`，需更新 expect 的路径期望值。

## 不变量

- cecelia-only 场景行为不变（`cloneSource = DEFAULT_BASE_REPO` 时等价于原逻辑）
- 所有 `git -C wtPath` 操作不变（操作 worktree 自身）
