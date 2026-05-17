# PRD: harness-worktree 初始化 .git 状态校验，自动 rebuild 孤儿 dir

## 背景

W7.3 cleanupStaleWorktrees 在多 agent 并发场景下偶发误清活跃 worktree（P0-C bug）。
被清后的 dir 不一定立刻消失：rm 进程可能因外部句柄/权限问题留下残骸 — `.git` 子目录还存在但已不是有效 git worktree pointer，整个 dir 处于"半成品"状态。

Brain 重新 spawn 同一 task 时，`harness-worktree.js::ensureHarnessWorktree`
当前判断逻辑：

```js
if (await statFn(wtPath)) {
  // 跑 git rev-parse --is-inside-work-tree
  if (inside === 'true') return wtPath;  // 复用
  // 否则 rmFn + 重新 clone
}
```

陷阱：孤儿 dir 里 `.git` 是真正的 directory（独立 repo 状态而不是 worktree pointer file），
`git rev-parse --is-inside-work-tree` **依然返回 true** —— 因为这就是个独立 git repo，只不过
不是基于主仓库的 clone，里面没有 main 分支、没有 origin remote。

后果：docker-executor 用这个孤儿 worktree 起容器，挂载 -v 后容器初始化失败，
27ms 内 exit 125（实证：W8 task-39d535f3 today docker exit 125 in 12-28ms）。

## 目标

让 `ensureHarnessWorktree` 检测出孤儿 dir 并强制重建，避免下游 docker spawn 125。

## 成功标准

- 孤儿 dir（.git 是 directory 但不是合法 worktree pointer）被识别为不可复用
- 识别后自动 `rm -rf` 整个 dir + `git clone` 重建
- 合法 worktree（含 origin remote 指向 main 仓库 + 当前在 cp-* 分支）正常复用
- 不存在的 dir 走原 clone 路径
- 单元测试覆盖三种 case：孤儿/合法/不存在

## 不在范围

- W7.3 cleanupStaleWorktrees 本身的 race fix（已另作 P0-C）
- docker-executor 错误处理改进
- worktree manage shell 脚本

## 风险

- 误判合法 worktree 为孤儿 → 误删用户工作；用 origin remote 校验 + 主仓库 path 一致性兜底
- 校验命令耗时（git remote get-url）→ 可忽略（<10ms）
