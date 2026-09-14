## Brain {VERSION} — Notion 排单 OpenClaw 分流改 relation 数据驱动

- Tasks 库派发从硬编码「执行方」select 改为 relation「Workflow」「Agent」指向运行舱四表真实 Notion 行
- pull 反查 ops_workflows/ops_agents.notion_id 取 dispatch 人工列（migration 444：webhook_url / template）
- 删除 OPENCLAW_EXECUTORS 代码枚举；smoke 反向守卫防回潮；缺配置写 ⚠ 回执可自愈重派
