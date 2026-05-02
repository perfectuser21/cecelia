## devloop-check 单一 exit 0：harness 统一收敛到 PR merged（2026-05-02）

### 根本原因

devloop-check.sh 存在两条 exit 0 路径：

1. **条件 0.5（harness 快速通道）**：harness 任务在 PR 创建后立即 `_mark_cleanup_done + return 0`，session 退出，Brain 另派 Evaluator 等 CI + merge
2. **条件 5/6（通用路径）**：PR merged + step_4_ship=done → 退出

这造成 harness 任务"保证弱"——Generator session 退出后，若 Brain 没有可用 session 派 Evaluator（claimed_by 死锁、runner 队列满），PR 永远挂着无人合并。根本错误：一个 task 的 session 不应在 PR merged 之前退出。

AI-native 正确模型：**一个 session 拥有一个 task 从 start 到 merge 的完整生命周期**。

### 下次预防

- [ ] 任何新增 `return 0` / `exit 0` 到 devloop-check.sh 的 PR，必须确认这是 PR merged 路径，不是中途快捷退出
- [ ] harness_mode=true 允许跳过的检查项（DoD 完整性、step_4_ship 要求），必须单独用 `_harness_mode` 守卫，不能整个路径 bypass
- [ ] 每次 Engine version bump 必须同步所有 6 个文件（VERSION / package.json / package-lock.json / .hook-core-version / hooks/VERSION / regression-contract.yaml）；check-cleanup.sh 是验证工具
- [ ] 设计"快速通道"之前先问：如果下游 session 不可用，这个任务怎么办？若答案是"挂着"，则快速通道是错误设计
