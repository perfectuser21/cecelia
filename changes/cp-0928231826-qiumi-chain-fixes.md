## Brain {VERSION} — 秋米派活链路四修：名册读 openclaw.json、每次运行新会话、多行回执解析、秋米不进旧 pushTasks、桥接器超时收尸（任务 7951bd36）

- `ops-collector` 改读 `~/.openclaw/openclaw.json`（`clawdbot.json` 自 09-21 未更新，skill-factory 等 7 个新 agent 不在 `ops_agents`，执行参数写它们被 `exec_agent_unknown` 拒）
- `openclaw-agent` 会话键改为 `agent:<agent>:<run_id>`：重排任务换新会话，agent 不能凭旧会话记忆复述
- 收割读日志尾巴 4000→20000 字节，按字段名取 `finalAssistantVisibleText`（真实 `--json` 为多行缩进，回执 text 此前恒空）
- `qiumi_task` 不进旧 `pushTasks`（与 `projection/notion.js` 抢同一 `notion_id` 致 400 乒乓，近 24h 162 次）
- `cecelia-bridge` `/llm-call` 超时立即回话，并在 5 秒宽限后 SIGKILL（`claude -p` 无视 SIGTERM，曾挂 126 个最长 3 天）
- 注册表守卫白名单行号跟上 `executor.js`（main 上已红）
