# PRD: H16 — ensureHarnessWorktree clone 后 origin set-url 到 GitHub

## 背景

W8 v17 跑 LangGraph harness contract，sub-graph 的 spawn 节点（H13 加的 contract import）做 `git fetch origin <propose-branch>` 失败：

```
fatal: couldn't find remote ref cp-harness-propose-r2-...
```

根因：`packages/brain/src/harness-worktree.js` 的 `ensureHarnessWorktree` 用 `git clone --local --no-hardlinks <主仓库本地路径> <worktree>` 创 worktree。git clone 默认让新 worktree 的 `origin` 指向 **clone 来源（主仓库本地路径 `/Users/administrator/perfect21/cecelia`）**，不是 GitHub。

但 proposer 节点用 SKILL push 时是 push 到主仓库自己的 GitHub origin —— 所以 `cp-harness-propose-*` 分支只在 GitHub 上有，新 worktree 的 origin（指向本地路径）里没有这些分支，fetch 必然失败。

## 目标（What）

`ensureHarnessWorktree` 在 `git clone --local` 之后，立刻把新 worktree 的 `origin` URL 改成 **主仓库的 GitHub URL**（通过 `git -C <baseRepo> remote get-url origin` 拿）。

这样 sub-graph 后续所有 `git fetch origin <branch>` / `git push origin HEAD` 都走 GitHub，跟 proposer push 的目的地一致。

## 不动

- 不动 `clone --local --no-hardlinks` 本身（保留 git objects 共享，clone 速度仍快）
- 不动 H13 spawn 节点的 contract import 逻辑（H16 修了 origin URL 后，那段就自动正确）
- 不动已合 PR 的 H7-H15 修法
- 不动 reuse path（dir 已存在）的 orphan 检查 —— 那条路径不走 clone

## 成功标准

- `ensureHarnessWorktree` 在 clone 后调一次 `git -C <baseRepo> remote get-url origin` 拿到 GitHub URL
- 然后调 `git -C <wtPath> remote set-url origin <GitHub URL>` 改 origin
- get-url 失败时 `logFn` 警告但不抛（best-effort，clone 已成功，后续操作可能失败但不至于死锁）
- 既有 `harness-worktree*.test.js` 不破坏（必要时 mock execFn 让 get-url throw 短路 set-url）
- 新增测试覆盖 set-url 真被调用 + GitHub URL 透传 + get-url 失败的 graceful 路径

## 风险

- `clone --local` 后 origin URL 改成 GitHub —— 如果 GitHub 网络抖，后续 fetch 会比之前慢/失败（之前 fetch 走本地 IO）。但这是必要代价：本地 origin 根本不包含 propose 分支，"快但永远 fetch 失败"不如"稍慢但能 fetch 成功"。
- 老 worktree（已存在 dir，origin 还指向 baseRepo 本地路径）：reuse 路径里的 orphan check 用 `url.includes(baseRepo)` 判断，仍认为 valid，不会自动迁移。这是有意为之 —— 让既有 worktree 自然过完任务后由 cleanup 清掉，新 worktree 走新逻辑。
