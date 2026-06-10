## cp-06101344 fix harness db_context journey_id

### 根本原因

`buildLangGraphInfo()` 里的 task query 包含 `journey_id` 列（已从 `tasks` 表移除），导致 SQL 抛 `column "journey_id" does not exist` 异常。catch 块静默了错误，`taskData` 一直是 null，`db_context` 对所有步骤全部返回 null。

表面现象：Pipeline 步骤详情页 DB Context 区块始终不渲染。

### 下次预防

- [ ] SELECT 新增列前先验证列存在：`docker exec cecelia-node-brain node -e "...pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=\\'tasks\\'')" | grep <col>`
- [ ] catch 块静默错误时应有 console.warn，但更重要的是测试层要覆盖 db_context 非 null
