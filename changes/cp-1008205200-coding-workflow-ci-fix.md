## Brain {VERSION} — coding workflow runner：CI 红自动修复（ci_fix）

- 真实端到端 #6062：CI（Linux bash 5.2）抓出 install.sh 转义 bug，链内没有修复环节，需人工补提交。
- runner 每轮在认领新任务前先查自己开的 cw PR（分支 cp-<stamp>-cw-<id8>）：必需检查全部出结果且有失败、本 head 没修过、累计未满 CODING_WF_CIFIX_MAX_ATTEMPTS（默认 2）时，本轮只修这一个。
- 修复：fetch PR 分支建 worktree（.dev-mode/.dev-lock、npm ci）→ 拉全部失败检查的 job 日志末尾（去时间戳、封顶 40KB）→ claude（prompts/ci-fix.md，禁 push/gh、GH 凭据隔离、超时 CODING_WF_CIFIX_TIMEOUT_MS 默认 30 分钟）修复并提交 → 程序核对：工作区干净、有新提交、只追加不改写、不碰 sprints/ 与 .claude/CLAUDE.md/AGENTS.md → runner 推送。
- 每次尝试记 <logDir>/cifix-<pr>.json（pushed/no_commit/uncommitted/protected_path/history_rewritten/claude_failed/claude_timeout/push_failed…），并回写 Brain 任务 result.ci_fix（task_id 取 sprint 的 01-intent.md）；claude 输出存 cifix-<pr>-<ts>.log；worktree 用完即删。CODING_WF_CIFIX=0 关闭。
