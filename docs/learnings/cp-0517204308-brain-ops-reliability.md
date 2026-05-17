## Brain 运行可靠性 + 智能账号调度（2026-05-17）

### 根本原因

Brain 容器停止无任何外部告警，janitor docker-prune job 从未被自动触发（仅可 API 手动触发），account2 OAuth session 中途失效时 selectBestAccount 无 session 时长过滤，三个盲区共同影响 harness pipeline 自动化可靠性。

### 下次预防

- [ ] Brain 宕机告警：launchd plist 每 60s 外部检测，Brain 挂了 ≤60s 收飞书 P0
- [ ] 容器清理：server.js 启动时 + 每 6h 自动触发 docker-prune，不再依赖手动 API
- [ ] 账号调度：selectBestAccount({ minSessionHours: 4 }) 排除 session 不足的账号
- [ ] 无账号可用：executor 将 harness_initiative 置 paused + P1 告警，1h 后自动重试
- [ ] 多账号扩展：ACCOUNTS 数组是唯一注册点，加账号无需改调度逻辑
