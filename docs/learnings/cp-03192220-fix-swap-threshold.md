# Learning: Swap 阈值误判过载
## 分支
`cp-03192220-fix-swap-threshold`
### 根本原因
SWAP_USED_MAX_PCT=50 在 macOS 上太保守。macOS 主动将不活跃页换出到 swap，swap 使用 60-70% 是正常行为。50% 阈值导致 swapPressure=1.24 → effective_slots=0 → 所有任务停派。
### 下次预防
- [ ] pressure 算法应区分平台——macOS swap 行为和 Linux 不同
- [ ] effective_slots=0 应该有告警，不能静默全停
