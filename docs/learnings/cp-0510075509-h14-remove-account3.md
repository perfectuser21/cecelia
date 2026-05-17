# Learning: H14 — 移除 account3 from ACCOUNTS

**PR**: cp-0510075509-h14-remove-account3
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-4

## 现象

W8 v15 ganLoop reviewer 容器 claude CLI account3 凭据 → 403 'Your organization does not have access to Claude'。retry 3 次都 403 → graph fail。

### 根本原因

用户已退订 account3 Claude 订阅（ops 事实，不是代码 bug）。但 brain ACCOUNTS / CLAUDE_ACCOUNTS hardcoded 数组（3 src 文件）仍含 'account3'。account-rotation 不感知账号订阅状态，按数组顺序 select → 选 account3 → claude CLI 403 → 节点 fail。

哲学层根因：**ops 配置不应 hardcoded**。账号列表应从 env / DB / config service 动态加载，让 ops 事故响应（账号退订、限流升级、凭据过期）不需要 PR + redeploy。本 PR 是 ops 事故的临时硬编码响应；长期应抽 dynamic accounts config（独立 sprint）。

### 下次预防

- [ ] 任何 ops 状态（账号、凭据、配额、订阅）不应 hardcoded 在 src/，应放 DB/env/config service
- [ ] account-rotation 应感知账号鉴权失败（403 永久错） → 自动 quarantine 该账号 + alert，而不是依赖人手改数组
- [ ] credentials-health-scheduler 应主动 ping 每个账号 /usage API，403 时降级 active=false（自愈）
- [ ] 长期：抽 dynamic-accounts-config 系统，单独 sprint 设计
