---
branch: cp-04061849-fix-cd-deploy-concurrency-shepherd
created: 2026-04-06
pr: "1953"
---

# Learning: CD 流水线 concurrency 死锁 + Brain URL 配置错误

### 根本原因

1. **Job-level concurrency 死锁**：`deploy` job 设了 `concurrency: group: deploy-production`，与 workflow-level 同名。GitHub Actions 中，workflow 已持有该 concurrency slot；job 再申请同名 slot → 死锁 → 0步立即 failure（`steps: []`、0秒失败）。

2. **Brain URL 配置错误**：`BRAIN_DEPLOY_URL` secret 未设置，fallback `https://dev-autopilot.zenjoymedia.media`，该域名指向 Xray VLESS 代理端口（不是 HTTP API），返回 HTML 404。Brain 实际在 `http://38.23.47.81:5221`，外网可直达。

3. **shepherd 断链**：PR merge 后只更新 `pr_status='merged'`，没有设 `task.status='completed'`。`tasks.js:426-468` 的 KR 进度链存在但从未触发，所有 OKR 进度卡在 0%。

### 下次预防

- [ ] 部署 CI 改动时，`deploy` job 禁止加 job-level concurrency（workflow-level 已够）
- [ ] 新机器上线时，BRAIN_DEPLOY_URL = Brain 直连 IP:PORT，不走反向代理域名
- [ ] shepherd PR 合并分支必须同时 set `status='completed'` + `completed_at`
