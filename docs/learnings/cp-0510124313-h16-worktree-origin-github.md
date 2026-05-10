# Learning: H16 — ensureHarnessWorktree clone 后 origin set-url 到 GitHub

**PR**: cp-0510124313-h16-worktree-origin-github
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-5

## 现象

W8 v17 跑通到 7 节点 pick_sub_task，sub-graph spawn 节点（H13 加的 git fetch contract）失败：

```
fatal: couldn't find remote ref cp-harness-propose-r2-...
```

spawn 节点 catch + return error → sub-graph 进 await_callback interrupt 等永远不到的 callback → 90 min 超时。

### 根本原因

`packages/brain/src/harness-worktree.js` 的 `ensureHarnessWorktree` 用 `git clone --local --no-hardlinks 主仓库 wtPath` 创 worktree。

git clone 默认让新 worktree 的 `origin` remote 指向 **clone 来源**（主仓库本地路径 `/Users/administrator/perfect21/cecelia`），而不是 GitHub。

但 proposer 节点在 SKILL 容器里跑 `git push origin HEAD` 是 push 到 **主仓库的 GitHub origin**（容器里的 worktree 是从主仓库 clone，SKILL 拿主仓库的 origin URL push）。所以 `cp-harness-propose-*` 分支只在 GitHub 上有，sub-task worktree 里 `git fetch origin <propose-branch>` 找不到。

哲学层根因：**git clone --local 是性能优化但破坏 origin 语义假设**。下游所有 git 操作（H10 verify push / H13 import contract / 未来 generator git push）都暗中假设 origin = GitHub，但 clone --local 让这个假设 false。修法是 clone 后显式 `git -C wtPath remote set-url origin <baseRepo 的 GitHub URL>`，让 origin 语义恢复一致。

### 下次预防

- [ ] 任何 git clone 后必须显式确认 origin URL 符合预期（不能依赖 clone 默认行为）
- [ ] worktree 创建 helper（ensureHarnessWorktree）应在 unit test 里覆盖"origin URL = GitHub URL"作为 invariant
- [ ] 长期：抽 createGitHubMirroredWorktree() helper，封装 clone + set-url + verify 三步
- [ ] orphan-check 里 `url.includes(baseRepo)` 的判断也得跟着改（H17 候选）—— 现在新 worktree origin = GitHub URL，老 worktree origin = baseRepo 本地路径，两条路径并存到自然清完
