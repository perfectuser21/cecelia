# Learning: Engine 心跳精简重构（stop-dev.sh + devloop-check.sh）

### 根本原因

Engine 的循环控制文件（stop-dev.sh 955行 + devloop-check.sh 892行）通过补丁堆积演化为高复杂度系统：
- seal 防伪机制（4个 gate 文件）增加了认知负担但 CI 已能替代其质量保证职责
- divergence_count/check_divergence_count 等元检查逻辑混入完成条件主干
- Pipeline Rescue、execution logger、LITE mode 等功能超出"循环控制"核心职责

### 下次预防

- [ ] Engine 文件行数上限：stop-dev.sh ≤150行，devloop-check.sh ≤300行，超限触发重构信号
- [ ] 新增功能进 Engine 前先问"CI 能替代吗？"——能替代就不加 Hook 级逻辑
- [ ] 测试文件随功能删除同步 skip（`describe.skip` + v16.0.0 注释），不能留悬空断言
- [ ] 多个 describe.skip 批量操作时用 Agent 并行处理，避免主上下文膨胀
