## Brain {VERSION} — 手机忙排队等待不再占用执行超时：等待上限改按截止时间

- 手机忙回队（lib/qiumi-device-busy.js）的等待上限不再参考执行超时（原 min(任务超时, 120 分钟) 作废）：排队时任务还没开始执行，执行超时只管真正运行的那次 run（executor 每次派发给 `openclaw agent --timeout` 的仍是完整 timeout_sec）。
- 截止时间取值：`payload.expires_at` → `tasks.due_at`（中文表「预期结束时间」）→ 都没有则首次忙起 24 小时；`due_at` 不晚于 `payload.scheduled_start` 视为开始时间误落（存量行形状），不当截止。
- 到截止仍忙 → failed(`device_busy_expired`，过期未执行)；中文「OpenClaw结果」写「⌛ 到截止时间仍未轮到手机（一直被 <owner> 占用），未执行」。回队事件 `qiumi_device_busy_requeued` 带 deadline_at / deadline_source。
- 入账：`due_at` 只来自「预期结束时间」，英文 Plan Date 起点 / 旧列「预期完成日期」（现为开始时间）不再落 `due_at`；`due_at` 按上海墙钟写、收割器按 `(due_at AT TIME ZONE 'Asia/Shanghai')` 读（列是 timestamp without time zone，生产 PG 会话时区 UTC）。
