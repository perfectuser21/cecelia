## Brain {VERSION} — P1/P2 告警汇总不再私信主理人（决策 d3e7746c）

- 背景：#5687 复活了 P1 每小时 / P2 每日汇总，但 flush 走 `sendFeishu`；生产 FEISHU_BOT_WEBHOOK 为空时降级为 Open API 私信主理人，积压的系统类 P1（launchd_patrol_anomaly、guard_drill_no_fire 等）会私信轰炸。
- 修法：flushP1/flushP2 不再调用 `sendFeishu`。配置专用系统通道 env `ALERT_DIGEST_WEBHOOK`（群机器人 webhook）则只发该 webhook；未配置则仅 console.log。两种情况都视为 flush 成功：清空缓冲、更新 last_flush，并把最近一次汇总（时间/条数/通道/最近 50 条）落 `working_memory.alerting_buffers` 的 `last_p1_digest` / `last_p2_digest`，经 `GET /api/brain/alerting/status` 可查。
- P0 立即推送（sendFeishu + 5 分钟限流）不变；#5687 缓冲持久化 / 至少一次语义不变。
