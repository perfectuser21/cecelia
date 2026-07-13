# P1-PR2：死人开关实弹测试当场抓出两个通道级问题

### 根本原因
死人开关（体外哨兵）首次 proven-to-fire 实弹测试即发现：①BARK_TOKEN 从未配置——
告警通道本身是断的，不实弹永远不会发现（哨兵死规矩的价值实证）；②预期 job 数
硬编码会在每次加 job 的部署时序窗口产生误报。另：复活的 active-goals-zero-trigger
带着 5 月的枚举假设（in_progress），生产 objectives 已漂移为 active，复活 60s 即误触发。

### 下次预防
- [ ] 任何告警通道上线必须 proven-to-fire（亲眼收到一条真推送），配置≠可用
- [ ] 哨兵的预期值从被监控方自报（scheduler_jobs_expected 键），禁止硬编码
- [ ] 复活死代码前过判定点核对：它对世界的假设（枚举/路径/端口）可能已漂移
