# Learning: 24h 成功率 39% 诊断 — pipeline_rescue storm + account3 auth

**分支**：cp-04072300-75cec4c4-085a-4f2e-81a2-e2d118  
**日期**：2026-04-08

### 根本原因

两个离散故障叠加导致成功率骤降：

1. **pipeline_rescue storm**：pipeline-patrol dedup 漏洞（PR #2004 修复），quarantined 状态任务未纳入 72h 冷却期，导致同目标 rescue 任务反复创建，虚增 194 个失败任务

2. **account3 OAuth token 过期**：所有 dispatch 到 account3 的任务（dev/sprint 类型）因 401 auth error 失败，共 31 个任务，且触发 SelfDrive 自诊断循环放大到 22 个额外任务

### 下次预防

- [ ] account3 token 刷新后，在 Brain 设置中添加 token 到期预警（提前 7 天告警）
- [ ] 成功率指标计算应分离 pipeline_rescue 和业务任务，避免 storm 噪音掩盖真实状态
- [ ] SelfDrive 自诊断触发前，检查是否已有同类诊断任务 in_progress，避免重复放大
- [ ] 真实业务成功率（去噪后）约 62.6%，仍有提升空间
