## Brain {VERSION} — OpenClaw 运行记录入 runs 表 + Notion 最近执行库

- 迁移 532：runs 增 Notion 投影记账列 notion_id/notion_synced_at/notion_digest，并在 notion_projection_map 登记 runs 占位行（pending_vessel，库建好前不会被误推）
- OpenClaw 运行记录采集（每 5 分钟定时任务）：把 OpenClaw 每次运行落成一行 runs（run_id=openclaw:*，带任务名/起止/耗时/结果/摘要），整批写库失败即抛错，历史回填有追赶模式（不发 Bark）
- runs 投影 Notion「最近执行」库（每 2 分钟定时任务）：窗口内（OpenClaw 7 天、失败/超时 30 天）推送，移出窗口的页归档，库未登记时安静跳过
- 建库脚本 `scripts/ops/create-runs-notion-db.mjs`（默认 dry-run，`--apply` 才建库并把占位行转正，已有 active 行拒绝重复建）+ 只读 smoke `openclaw-run-ingest-smoke.sh`
