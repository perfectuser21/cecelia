# Stream 3 — git-fence helper（修 PR #2838 refspec bug）

## 背景

PR #2838 在 `inferTaskPlanNode` 加了 inline `git fetch origin <branch>`，意图修
"proposer 在 task container 内 git push 后，brain 容器本地 origin tracking 不更新"
的跨进程同步问题。但命令缺 refspec — 实证 W8 v4 task 5eb2718b deploy PR #2838
后跑，仍 fail at inferTaskPlan，Sprint 2.1a 同样症状。

## 根本原因

`git fetch origin <branch>` 这种"只给一个 ref 不带冒号"的形式，按 git 的语义
**只更新 FETCH_HEAD**，**不更新** `refs/remotes/origin/<branch>`。
所以紧接着 `git show origin/<branch>:<file>` 仍然 `fatal: invalid object name`。

正确写法是显式 refspec：

```
git fetch origin <branch>:refs/remotes/origin/<branch>
```

冒号左边是远端引用，右边是要更新的本地引用，两边写明才会真正动 remote tracking branch。

参考：[refspec 语法](https://git-scm.com/book/en/v2/Git-Internals-The-Refspec)。

## 修复

新增 `packages/brain/src/lib/git-fence.js` 暴露
`fetchAndShowOriginFile(worktreePath, branch, file)`：

- 内部 `git fetch origin <branch>:refs/remotes/origin/<branch>`（显式 refspec）
- fetch 失败 graceful warn（让 show 报真错），show 失败抛原错
- `inferTaskPlanNode` 改用 helper，删掉 PR #2838 加的 inline 错误命令
- 4 unit test + 真 git 跨 worktree e2e smoke
- 更新 PR #2838 加的 `infer-task-plan-fetch.test.js` 期望（现在该断言 refspec 形式）

## 下次预防

- [ ] 跨进程 git 操作必须 fetch + 显式 refspec，不写 inline
- [ ] 用 `fetchAndShowOriginFile` helper 不要 inline execSync git
- [ ] 任何 `git fetch origin <X>` 都先想清楚要不要更新 remote tracking ref，
      要更新就加 `:refs/remotes/origin/<X>`，否则就只是 FETCH_HEAD
- [ ] 单元测试要断言**完整命令字符串**（含 refspec），不能只 `startsWith('git fetch')` —
      这是 PR #2838 的测试漏检的根因
