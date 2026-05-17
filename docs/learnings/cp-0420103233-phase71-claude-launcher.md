# cp-0420103233-phase71-claude-launcher — Learning

### 背景

Phase 7.1：统一 claude 启动器，让 headless/interactive/parallel 全部走同一 session_id 机制。

### 根本原因

Phase 7（v17.0.0）只修了 Stop Hook 读 session_id 的匹配逻辑，没修"源头写入"——交互 claude 没带 `--session-id` flag 时 worktree-manage.sh 写 owner_session="unknown"。2026-04-20 实测 Phase 8.1 PR 期间 Stop Hook 完全失效，assistant "宣布完成"就真结束。这是"Phase 7 只修了一半"的漏洞暴露。

### 下次预防

- [ ] 任何 Stop Hook 行为修复：必须同时验证 headless + interactive 两个路径（Phase 7 只验 headless 导致遗漏）
- [ ] 任何"要求 session_id"的功能：走同一个 launcher 写入，不允许两条独立路径（防止配置漂移）
- [ ] launcher 是 Cecelia 约定唯一的 claude 启动入口；未来任何"增加 claude 启动参数"的需求都改 launcher，不直接改调用方
- [ ] bash 脚本末尾 `main "$@"` 执行必须加 `BASH_SOURCE` guard，否则无法被测试 source
