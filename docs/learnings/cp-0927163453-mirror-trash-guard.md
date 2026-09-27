## 旧镜子库停推 + 守夜镜子库探活（2026-09-27，决策 24a37029）

### 根本原因
- AI Journey / AI Feature 两镜子库 2026-09-19 进 Notion 回收站；Notion 对回收站库 **GET 200 但 `in_trash:true`，POST/PATCH 才 404**——推送侧只见 404 只记 `notion_sync_log`，守夜 A10 只比行数，没有任何断言问"库还活着吗"，于是每 5 分钟刷一次失败刷了一周。
- 库 id 硬编码在 `notion-push-sync.js`（`JOURNEY_DB || resolveDbId(...)`），注册表登记形同虚设：即使把注册表行归档，代码照样往死库推。
- 承诺地图已由「承诺地图格子」承载（Journey 为文本列，迁移 479），两旧库没有消费者，但没人拍板"停推"之前谁都不敢摘。

### 下次预防
- [ ] 镜子库的"要不要推"只认 `notion_projection_map` 的 active 推送行（`resolveDbId` 无 fallback）；停推走迁移归档（archived/none），不改代码常量；A9 常量表同步摘表，否则会报"注册表无推送行"。
- [ ] 运维终态（archived/none）的提示只在进程内出一次；每轮刷的日志等于没有日志。
- [ ] 守夜 A11 `mirror_db_reachable` 对每个 active 推送库 `GET /databases/{id}` 看 `in_trash`/`archived`/404；新增镜子库自动被覆盖，无需手写断言。
- [ ] 探活失败分两级：in_trash/archived/404 = 库死了（红）；503/超时 = 外部抖动（degraded 不红）。别让 Notion 抖一下就天天红。
- [ ] 晨报/日报行读守夜哨兵（working_memory[promise-map-nightly].results），不重复打 Notion。
