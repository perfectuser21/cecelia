# Learning: Alertness 过敏修复

## 变更摘要
修复 Alertness 系统三个过敏问题：PANIC 抖动稳定期、COMA drain 解耦、429 过滤。

### 根本原因
Alertness 系统缺乏抖动缓冲机制，单次异常就能触发最高级别响应（PANIC/COMA），叠加 drain_mode_requested=true 导致系统自杀停摆。同时 API 429（正常限流）被错误地计入错误率，放大了异常信号。

### 下次预防
- [ ] 所有告警升级路径都应有连续确认机制（N 次连续 critical 才升级），防止瞬时抖动
- [ ] 破坏性自动操作（drain/shutdown）不应绑定在单一状态转换上，应有独立确认逻辑
- [ ] 区分"可预期的暂时错误"（429/timeout）和"真正的系统异常"，前者不影响健康评估
