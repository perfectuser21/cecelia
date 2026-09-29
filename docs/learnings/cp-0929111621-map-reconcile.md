# notion_projection_map 与现实对不上：漏登记的写入方 + 视图当表（09-29）

### 根本原因
- 注册表只登记了 Brain 仓库里的血管；Brain 之外的写入方（us-vps /opt/openclaw 的 opc-*.py cron）直写 Notion 却从没进账，「部门日报」推送方一直写着「待核」。
- 旧 Cecelia Tasks 库的写入方是 projection/outbox.js，库 id 藏在 projection_targets.config 里而不在代码常量里，grep 代码找不到；直到 09-28 23:01 还在给每个 device_job 建页，决策 71e0087b 关掉 enabled 才停。
- 迁移 453 按「information_schema 里带 notion_id 列」补登记，把迁移 391 建的视图别名（acceptance_criteria / features_registry）当成了独立表。
- 首版描述生成用注册表返回顺序拼多表名，同库多行顺序不稳定，会让同一说明每天被重写。

### 下次预防
- [ ] 找 Notion 库写入方时查 Notion 页面 last_edited_time + 按最近编辑排序，再对照 tasks.notion_synced_at 反查，不要只 grep 代码常量；配置表（projection_targets 等）里的库 id 同样要进注册表
- [ ] 按 information_schema 枚举带某列的「表」时必须过滤 table_type='BASE TABLE'，视图不是独立表
- [ ] 由集合生成的幂等文本必须排序后再拼，否则幂等判断会被顺序抖动打穿
- [ ] 记忆·Diary / 记忆·Owner Profile 两库对 CCAPI2026 集成 404，注册表却登记为 active push，需核实 notion-memory-sync 用的凭据与库归属
