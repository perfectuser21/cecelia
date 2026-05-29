## engine-ship 剥离 cecelia + 接链 engine-pr-watchdog（2026-05-29）

### 根本原因

1. `engine-ship` 的 TERMINAL IMPERATIVE 写死"退出 assistant turn，不再调 Skill"，导致 `engine-pr-watchdog` 从未被调用——PR 推上去后无人监控 CI，PR 合并只靠 Stop Hook（v19 已删 /dev 路由，实际也不工作）。

2. `engine-ship/SKILL.md` 重复存在于两处（`packages/engine/skills/` 和 `zenithjoy-skills/`），与"所有 skill 统一住 zenithjoy-skills"原则矛盾。

3. `check-cleanup.sh` 检查 `.hook-core-version` 用的是 `$ENGINE_DIR/.hook-core-version`（engine 根目录），不是 `$ENGINE_DIR/hooks/.hook-core-version`——两个文件都存在，容易混淆，浪费排查时间。

### 下次预防

- [ ] 版本 bump 前先读 `check-cleanup.sh` 确认它检查的是哪 6 个文件路径，不要凭记忆猜
- [ ] skill TERMINAL IMPERATIVE 每次新建 skill 时必须明确写"下一 tool call 是什么"，禁止写"退出 turn"
- [ ] engine skill 迁移到 zenithjoy-skills 前，先 grep cecelia 里所有引用该 skill 路径的测试文件，一并处理
