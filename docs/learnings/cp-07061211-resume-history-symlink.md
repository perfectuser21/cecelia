# Learning — resume 历史被 session 隔离打散

### 根本原因

#3557 用 per-session worktree 隔离 cwd 时，没有意识到 Claude Code 的 transcript 存储和
/resume 过滤都以 cwd 派生的 projects key 为单位——隔离 cwd 的同时把会话历史也隔离了，
每个 session 变成孤儿文件夹，/resume 形同虚设。修复过程中还踩了一个二级坑：
projects key 按物理路径（process.cwd()）派生而非 $PWD 逻辑路径，第一版实现方向搞反，
靠 ~/.claude/projects/ 里实存的 -private-tmp-* 条目实证纠正。

### 下次预防

- [ ] 改变进程 cwd 的基础设施改动，必须清点所有"以 cwd 为 key"的外部状态
      （Claude Code projects/memory、.dev-lock、hooks 的 cwd 判定），逐个确认不被破坏
- [ ] launcher 类必经路径上的新增逻辑一律 best-effort + stderr 警告，不阻断主流程
- [ ] 对第三方工具行为的假设（路径语义/编码规则）必须找实存证据实证，不凭推理落地
