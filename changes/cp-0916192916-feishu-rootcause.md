## Brain {VERSION} — 飞书交办入账改按「秋米为什么没干」分根因

- 原判定只看有没有执行记录，答不了「为什么没干」。E2E 实证秋米每条都回了，**回复里就写着原因**——机器回复有固定套话，用关键词就能分，不需要 LLM 猜人说的话。
- 四类根因（全部模式取自悦升云端群真实回复原文）：`fault` 系统故障（401/invalid api key/无法连接工作手机/provider internal error）→ 入账 blocked 并附故障原文，可直接起告警；`waiting` 等主理人补料（「先把两份资料发来」「还需要确认两点」）→ 入账 blocked，球在主理人；`done` 已完成（有 run，**或**回复「已整理并创建…已回读核验」——用 MCP 直接干的不留 run）→ completed；`answer` 纯咨询答复 / `silent` 无人接茬 / `unknown` 证据窗口外 → 一律不入账。
- **修回复串台**：原按 30min 窗口取回复，实测「表在哪」会把 17 分钟后另一件事的 401 回复认成自己的、被误判成系统故障。回复归属改为截止到下一条人发消息。
- 修 title 残留飞书 `@_user_N` 占位符的脏数据 bug；入账附 `bot_reply_excerpt`，主理人一眼看到卡在哪、不用回群里翻。
- 删除被取代的三态判定（`resolveDisposition`/`dispositionToStatus`），避免两套判定并存。
