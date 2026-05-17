# Learning: KR-Project 依赖图修复

Branch: cp-03290508-97ef0bfd-4563-4c72-92b5-5126d4
Date: 2026-03-29

### 根本原因

SelfDrive 诊断发现 6/7 KR 显示 0% 进度，根本原因是结构性断裂：
17 个 planning 项目全部 `kr_id=null`，从未与 KR 关联，导致 OKR 树无法通过项目进度推算 KR 完成度。

另一个隐藏问题：24h "完成" 的 45 个任务全是 `[heartbeat] zenithjoy`，不是实际开发任务。
系统健康但没有真正推进 KR 进度。

### 下次预防

- [ ] 在 /decomp 拆解 Project 时必须指定 `kr_id`，不允许创建 `kr_id=null` 的 Project
- [ ] Brain 自驱诊断应定期扫描 `SELECT COUNT(*) FROM okr_projects WHERE kr_id IS NULL AND status != 'completed'` 并报警
- [ ] 每次 migration 执行 `AND kr_id IS NULL` 幂等保护已验证有效，继续遵循
- [ ] worktree 中 Write 文件必须使用完整绝对路径（含 worktree 前缀），否则误写到 main repo
