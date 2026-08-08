# Learning：迁移账本通过不等于关键 relation 真实存在

本轮巡检中，生产 `schema_version` 已记录 migration 153，Schema MAX 也已到 394，但 migration 153 应创建的 `task_execution_metrics` 表实际不存在。仅检查最大版本、迁移文件编号或“已应用”集合都会把这类中间对象丢失判成健康；真实回调日志已经持续显示写入失败。

### 根本原因

迁移治理把版本账本当成 schema 完整性的代理，却没有验证关键表、索引和列的真实存在。历史恢复、重建或人工变更只要保留 `schema_version` 行，就能绕开后续所有 `already applied` 判断。

### 下次预防

- [ ] selfcheck 对关键 relation 使用 `to_regclass` 和 `information_schema` 做存在性/列契约校验。
- [ ] 巡检同时核对 migration ledger、真实 schema 和运行日志，三者不能相互替代。
- [ ] 修复缺失对象时新增可重入 forward migration，不改写已登记的历史 migration。
- [ ] 非致命观测写入失败也要聚合告警，避免长期以日志噪声形式丢数据。
