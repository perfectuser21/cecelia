# Learning: worktree 隔离防护 gate（主仓库被当共享工作台）

## 背景
PR 3226 合并卡住排查中，发现主仓库 `/Users/administrator/perfect21/cecelia` 被多个 cp-* 任务用 `git checkout` 当共享开发工作台，并发时工作目录被互相抽走、git 操作踩踏（一个 rebase、一个 checkout main 提交 learning）。关联 Issue bfeec6d6。

### 根本原因
engine-worktree 的隔离只在任务走完整 init-or-check **且调用方真的 cd 进 worktree** 时才生效。三层缝隙叠加导致失效：
1. `worktree-manage.sh` 是子进程，`cd` 改不了父 claude 进程的 cwd（脚本只能 `echo` 路径），SKILL 却声称会 cd，无强制校验确保调用方留在 worktree。
2. 现有 `branch-protect.sh` 只 hook `Write|Edit`，而踩踏动作 `git checkout`/`git rebase` 全是 Bash，不触发它。
3. 该检查只在 HEAD 已在 `cp-*` 时触发；踩踏起点 `git checkout cp-*`、收尾 `git checkout main` 在 main 分支时根本不触发。

真正的踩踏起点动作是「在主仓库 `git checkout` 到 cp-*/feature 分支」——现有 gate 全部漏过。

### 下次预防
- [ ] 任务必须在独立 worktree 开发，主仓库 HEAD 永远停在 main
- [ ] 危险动作识别为「主仓库 git checkout 到任务分支」，在 PreToolUse **Bash** 层拦截（新增 worktree-checkout-guard.sh），而非只在 Write/Edit 层
- [ ] 加新 gate 前先查清现有 gate 为何失效（触发器缝隙 / 分支缝隙），否则新 gate 会同样漏
- [ ] 可移植 shell 脚本禁用 `\b` 词边界——BSD sed（macOS）不支持，导致本地通过 CI 失败或相反；用 awk 分词替代
- [ ] 跨 repo 边界：engine-worktree SKILL.md 在 zenithjoy-skills（user skill），文字修正须走 skill-creator 独立 PR，不能塞进 cecelia [CONFIG] PR
