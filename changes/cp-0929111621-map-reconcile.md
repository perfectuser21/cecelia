## Brain {VERSION} — Notion 投影注册表与现实对账 + 镜子库只读说明由注册表生成

- 迁移 488：notion_projection_map 补登记 OPC 经营对象 / OPC 日报 / Key Results（us-vps cron 在写）与旧 Cecelia Tasks / Cecelia Projects（projection/outbox.js 曾写，决策 71e0087b 已停用 → archived）；「部门日报」推送方核实为 opc-daily-page.py；acceptance_criteria / features_registry 两个视图别名行归档（任务 a7a6b8b4）。
- 新 scheduler job notion-mirror-labels（每天一次）：active 推送镜子库的描述开头写「🔒 只读镜子：由 Brain <表> 经 <血管> 推送…」，已是同样说明零写，两面库与无 Brain 表的库跳过；手动入口 scripts/ops/notion-mirror-labels.mjs。
