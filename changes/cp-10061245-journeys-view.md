## Brain {VERSION} — 树+仓库 v3.0 第 6 刀 PR-B：journeys 空壳父表下线，改只读视图

- 任务 49d057f1（主理人 10-06 拍板：拆继承后改只读视图，决策 fc6e7a99）。PR-A（#5999）已让生产代码不再读写父表；迁移 529 拆继承、删父表，同名建只读视图。
  - 先处理依赖：`activity_flow_metrics` 的能力兜底改读 `capabilities`；`journey_ref_guard`（10 张表的多态 `journey_id` 引用守卫）改按 `value_streams` / `capabilities` 判存在。
  - `value_streams` / `capabilities` 各自 `NO INHERIT journeys`，删父表与 INSERT 分流触发器 `trg_journeys_route_insert` 及其函数；子表上的身份锁（价值流不能改成能力）与级联删除触发器保留。
  - `journeys` 变成只读 UNION ALL 视图（价值流 ∪ 能力，21 列与子表一致），兜底外部消费者；INSERT / UPDATE / DELETE 一律被拒（写入必须按角色直写子表）。
  - 清点结果：没有任何外键指向父表（`pg_constraint.confrelid = journeys` 为 0 行），所以拆继承不牵动引用完整性；迁移内先断言父表自己 0 行才下线，有行就中止。
  - 回滚脚本还原 520 的形状（父表、分流触发器、两张子表重新继承、旧守卫函数与指标视图）；检查约束从子表取文本在三边重建，避免生产与从零迁移库里表达式写法不同导致重新继承失败。已在本机库验证 升级 → 回滚 → 再升级。
- 测试：直接写 `journeys` 的集成测试与夹具改为按角色写子表；新增迁移形状测试与真库行为测试（视图只读、子表不继承、守卫放行价值流/能力 id 并拒绝不存在的 id、身份锁仍在）。
