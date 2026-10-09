## coding workflow 第一刀：intent→spec 两步 md 链（2026-10-07）

### 根本原因

- 对标 Anthropic 官方 SDLC 后发现：我们的 coding 链按工作类型分流成多条流水线，产物不互相引用（capability 合同交给 Harness 只剩 one_liner+hash），主理人看不到链。第一刀用"契约 + json-stdio 活动 + 每步一份带上游引用的 md"跑通前两步。
- 开工前 GitHub 撞车检查发现草稿 PR #5783 已有通用活动执行器，复用其协议而非另写，省掉一个执行器。
- 本地 main 落后 origin/main 633 个提交，worktree-manage 从本地 main 拉分支；终审前才发现，靠 rebase 补救。
- worktree-manage.sh 的 `((skipped++))` 在 `set -e` 下首个跳过即退出，自动清理失效（已登记任务 2a80319e）。
- 主仓写保护 hook 以会话 cwd 判定，连仓库外草稿目录的 Write 也拦；需 EnterWorktree 把会话切进 worktree。

### 下次预防

- [ ] 建 worktree 前确认基点是 origin/main（或建完立刻 `git rev-list --count HEAD..origin/main`）
- [ ] 活动类脚本：stdout 只一个结果 JSON、子进程输出一律 stderr、子进程 env 剥离 `CLAUDECODE`/`CLAUDE_CODE_*`/`GIT_DIR` 等
- [ ] 凡把路径交给 git 的地方用 `--literal-pathspecs`，并拒绝解析到工作区根的路径
- [ ] 让 AI 生成产物的活动，运行前删除旧产物，运行后检查越界写
- [ ] 契约每个活动可能报出的 failure_class 必须在契约里非空，否则执行器判 undeclared_failure_class 停链
- [ ] pre-push quickcheck 可能耗时约 10 分钟：自动化 push 的预算要按它定，不要用 --no-verify 绕过
