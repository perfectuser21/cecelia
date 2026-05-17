## All Features Smoke 动态脚本（2026-04-30）

### 根本原因
feature registry 里 159 个 feature 的 smoke_cmd 无法被自动持续验证，状态只是初始填入的一次性快照。CI 没有机制在每次部署后重新跑全部 smoke_cmd 刷新状态。

### 下次预防
- [ ] 新增 feature 到 registry 时，smoke_cmd 必须在同一 PR 里验证通过
- [ ] all-features-smoke.sh 进入 CI 后，每次 brain 改动都会重跑，状态陈旧问题消失
- [ ] bash 循环捕获每条命令退出码时不能用 set -e，用 set -uo pipefail + 手动计数
- [ ] bash 空数组 + set -u 要用 ${#arr[@]:-0} 避免 bash 3.x crash
