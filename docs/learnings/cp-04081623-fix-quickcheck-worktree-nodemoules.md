# Learning: quickcheck.sh worktree node_modules 路径解析

## 根本原因

`git rev-parse --show-toplevel` 在 worktree 中返回的是 worktree 路径，不是主仓库路径。quickcheck.sh 直接用 `REPO_ROOT/packages/engine/node_modules` 检查依赖是否存在，worktree 里没有 node_modules（依赖在主仓库），导致所有测试静默跳过（exit 0），pre-push hook 形同虚设。

另一个坑：`git rev-parse --git-common-dir` 在主仓库返回相对路径 `.`，在 worktree 返回绝对路径。必须先 `cd $REPO_ROOT && cd $GIT_COMMON_DIR && pwd` 转为绝对路径，再 `dirname` 才能得到正确的主仓库根目录。

## 修复方案

用 `git rev-parse --git-common-dir` 找到主仓库 `.git` 目录，`dirname` 得到 `MAIN_REPO_ROOT`。检查 node_modules 时先查 `REPO_ROOT`，找不到 fallback 到 `MAIN_REPO_ROOT`。运行 npx/vitest/tsc 时通过 `PATH="$ENGINE_NM/.bin:$PATH"` 注入正确的 bin 路径。

## 下次预防

- [ ] 任何涉及 node_modules 路径的脚本，都要考虑 worktree 场景
- [ ] `git rev-parse --git-common-dir` 返回值在主仓库是相对路径，必须先转绝对路径
- [ ] 静默跳过（exit 0 + ⚠️）改为 fallback 逻辑，找不到就用 MAIN_REPO_ROOT，而不是跳过
