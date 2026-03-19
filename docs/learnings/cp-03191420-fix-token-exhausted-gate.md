# Learning: Token 全部耗尽时阻止派发

## 分支
cp-03191420-fix-token-exhausted-gate

## 变更摘要
当所有 API 账户 quota 耗尽（available_accounts=0 且 token_pressure>=1.0）时阻止任务派发。

### 根本原因
PR #1124 将 token 压力改为仅监控，但遗漏了"全部耗尽"的边界情况。所有账户 quota 用完后仍派发任务会导致秒失败→requeue→堆积循环。

### 下次预防
- [ ] 移除限制逻辑时，保留"全部不可用"的安全阀
- [ ] 区分"降速"和"完全不可用"两种场景
