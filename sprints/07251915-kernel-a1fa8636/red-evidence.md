# Red 证据

- 合同基线：`915a0c20e260d902c53ebb7d9338f32e9ab63eb4`
- 测试数据库：显式 `cecelia_test`（`_test` 后缀安全守卫通过）
- 合同测试结果：19 项中 14 项断言失败、5 项冻结回归通过，进程退出码 1。
- Red 根因：缺少 migration 361、attempt telemetry query/route、attempt-store lineage/统一时间与 orphan 结构化收口实现。
- 说明：5 项已绿为合同刻意冻结的既有 Kernel 路由/决策/数据库安全不变量，不是弱断言；新增能力相关断言均保持 Red。
