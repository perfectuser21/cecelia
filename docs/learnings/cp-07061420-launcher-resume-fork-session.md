# Learning: launcher 强制 --session-id 与 --resume/--continue 冲突致启动秒退

## 现象
用户 `claude --resume` 经 alias→claude-launch.sh 启动时，claude CLI 报
`Error: --session-id can only be used with --continue or --resume if --fork-session is also specified`
后立即退出。launcher 已先把人切进新 worktree，肉眼看是"进了 session 但 resume 完全没内容"，
极易误判为 #3567 会话池软链没生效。

### 根本原因
#3557 session 隔离让 launcher 对所有启动无条件注入 `--session-id <uuid>`，
但没有覆盖"用户透传 resume/continue flags"的参数组合：claude CLI 规定该组合必须带 `--fork-session`。
本质是 launcher 包装层只考虑了"新会话"路径，没有枚举被包装 CLI 的参数约束矩阵。

### 修复
ARGS 解析后检测 `--resume|--resume=*|-r|--continue|--continue=*|-c`，缺 `--fork-session` 则追加；
dry-run 与真实 FINAL_CMD 同源消费 ARGS 自然同步。恢复的对话 fork 到 launcher 新 session-id 下，
与 per-session worktree / .dev-lock owner_session 模型自洽。7 个 dry-run 契约测试常驻 CI。

### 下次预防
- [ ] 包装/注入类 launcher 改动时，必须枚举被包装 CLI 的互斥/依赖参数组合（--session-id×--resume 这类），逐组合过 dry-run 契约测试再上线
- [ ] 排查"功能 X 完全不工作"时，先用 expect/真实入口复现完整启动链路（alias→launcher→binary），不要只测 binary 本身——本次 binary 直跑一切正常，断点在包装层
- [ ] debug 结论落地前跑一次"用户真实入口"端到端（zsh -ic），避免修好 A 路径漏掉 B 路径
