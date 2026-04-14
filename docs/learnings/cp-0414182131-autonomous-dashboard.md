## Autonomous Sessions Dashboard — 首次真实业务 dogfood（2026-04-14）

### 根本原因
今天 7 个 autonomous PR 全是元层面（修 autonomous 自己），没证明能做真业务。这是第一次用 autonomous 做真 feature — dashboard 页面让用户实时看 /dev session 状态。

### 下次预防
- [ ] autonomous 跨 apps/api/dashboard/brain 多包场景可行性已验证
- [ ] Implementer 自己发现 DynamicRouter 是配置驱动（不用手改），说明 Implementer 能做轻量架构决策
- [ ] worktree 无 node_modules 导致前端测试要借主 repo — 未来新 worktree 自动软链 node_modules 可优化（已在 quickcheck.sh 处理）
