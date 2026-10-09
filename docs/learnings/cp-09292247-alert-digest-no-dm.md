# Learning：P1/P2 汇总复活后差点私信轰炸主理人（决策 d3e7746c）

- 现象：#5687 把 alerting-flush 接回 scheduler 后，积压的 P1 全是系统类告警；生产 FEISHU_BOT_WEBHOOK 为空，sendFeishu 会降级为 Open API 私信主理人。
- 根因：汇总类通知复用了面向主理人的 sendFeishu，而 sendFeishu 的降级链路终点是主理人私信——"通道为空"被静默改写成"发给老板"。
- 教训：
  - 系统类/汇总类通知必须走专用系统通道（ALERT_DIGEST_WEBHOOK），未配置时只记录不推送，禁止复用带私信降级的 sendFeishu。
  - 复活一条沉睡 5 个月的推送链路前，先看积压内容是什么、最终落到谁手里。
