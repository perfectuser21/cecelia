## Brain {VERSION} — 飞书群交办入账

- 新增 `feishu-task-ledger` scheduler job（60min 自 gate）：拉三个在册飞书群消息，经三道判据识别出主理人真正派给秋米的活，入 tasks 账并经既有 pushTasks 投影 Notion。
- 三道判据（决策 1c6679cd / 判定点 398d5f36）：①@ 对象必须是 bot open_id 而非人（实测 14 天 232 条带 @ 消息里仅 81 条 @秋米）②LLM 四档语义分类只放行 task（规则法不可分：「你拉个会议」5 字是任务，「现在的模型是什么」7 字是提问）③30min 窗口重发去重（实测同一任务因无响应被重发 3 次）。
- 执行回执用机器回复当凭据：交办后 30min 内同群 bot 有回复 → completed，否则 blocked。**入账状态绝不产出 queued**，否则 Brain tick 会把群里的客户对话当任务真去执行（smoke 已 proven-to-fire）。
- 前序「从 OpenClaw task_runs 回填」方案作废：实勘证明 OpenClaw 不持久化群消息原文（ingress payload 完成后清空、transcript 表 0 行、飞书群在 task_runs 只留 13 行 CLI 噪音），唯一可信源是飞书开放平台 API。
