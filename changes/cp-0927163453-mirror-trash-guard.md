## Brain {VERSION} — 旧镜子库停推 + 守夜镜子库探活：AI Journey / AI Feature 在回收站，迁移 480 归档、注册表判推、A11 接晨报日报（决策 24a37029）

- 背景：AI Journey `358c…931a`（journeys）/ AI Feature `358c…4dff`（journey_features）2026-09-19 进 Notion 回收站（GET 200、写入 404），Brain 每 5 分钟推失败刷 `notion_sync_log` 一周无人知；承诺地图已由「承诺地图格子」承载（Journey 为文本列，迁移 479）。主理人 09-27 拍板：停推，不恢复不重建。
- 迁移 480：`notion_projection_map` 两行归档（status archived / direction none，notes 写原因与决策号），照 479 归档 Backbone-Step Map 的写法；`journeys` / `journey_features` 记账列保留不清；幂等。
- `notion-push-sync`：`pushJourneys` / `pushJourneyFeatures` / `pushAdvancementItems` 改按注册表 active 推送行决定是否推（`activePushDbId`），无则停推，停推提示每表只在进程内 info 一次；删除硬编码 `JOURNEY_DB` / `FEATURE_DB`，守夜 A9 常量表摘掉两表（否则 A9 会报"注册表无推送行"）。Issues 库 Sub Area relation 指向承诺地图分区页非 AI Journey，无需改。
- 守夜 A11 `mirror_db_reachable`（`lib/notion-projection-watch.js probeMirrorDbs`）：对 active 且 push/both 的每库 `GET /databases/{id}`，`in_trash`/`archived`=true 或 404 → 红并带 lost 清单；503/超时 degraded 不红。09-19 起三库进回收站都是上产后手工才发现，这条闸让它当天见（nightly Bark）。
- 晨报 `🔴 RED 镜子库失联：<title>×N（Notion 回收站/404，推送已停）` 行与日报「== 镜子库失联 ==」板块（`lib/mirror-db-report.js` 读 promise-map-nightly 哨兵），无失联不出行，读取失败不拖垮。
- smoke `mirror-trash-guard-smoke.sh` 入 allowlist。
