## Brain {VERSION} — coding workflow verify 对接真实 claude：证据核对容忍 worktree 内 cd 前缀、claude 会话剥 runner 配置

- 真实端到端 ea2feb66 实测：claude 在 worktree 里直接执行命令，写 04 证据时补上 `cd <worktree> &&` 前缀，被判 command_not_executed。lib/transcript.mjs `unverifiedItems(items, executions, { worktree })`：证据命令开头 cd 到 worktree 根或其子目录（原路径或 realpath）的前缀去掉后再核对；cd 到 worktree 外（含 `..` 逃逸、同名前缀目录）不放宽；输出核对规则不变。
- prompts/verify.md：command 块必须逐字照抄 Bash 工具实际执行过的那条命令，不补 cd、不改写 grep 条件、不合并拆分。
- lib/claude.mjs：claude 会话 env 不继承 runner 配置 CODING_WF_*（会话里跑 runner 测试曾因此 4 条失败）；childEnv 不变，runner→执行器→活动仍可读 CODING_WF_GH_BIN、超时等。
