# Learning: 部署后烟雾测试 — Brain /health 验证

**分支**: cp-04040003-deploy-smoke-test
**日期**: 2026-04-04
**PR 类型**: feat(ci)

---

## 问题描述

`deploy.yml` 中的部署流程在 `Poll deploy status` 返回 "success" 后即结束。
该状态仅代表 `deploy-local.sh` 脚本执行完毕，**不代表 Brain 进程真正健康可响应**。

实际部署中可能发生：进程启动成功但端口未监听、DB 连接失败、路由注册失败等情况，
导致部署"成功"但服务不可用。

---

### 根本原因

CI 对"部署成功"的定义过于宽松：只验证脚本退出码，未验证服务可用性。
`/api/brain/health` 端点已存在（`packages/brain/src/routes/goals.js`），
但 CI 流程从未调用它。

---

### 解决方案

在 `Poll deploy status` 之后新增 `Smoke Test — 验证 Brain 健康` step：
- 等待 5 秒（给进程启动时间）
- `curl` 调用 `/api/brain/health`，捕获 HTTP 状态码
- HTTP 2xx → 通过；其他 → `exit 1` 使 CI 失败

---

### 下次预防

- [ ] 新增任何部署流程时，必须同时加烟雾测试（health check / ping）
- [ ] 烟雾测试复用已有 health 端点，不额外增加维护成本
- [ ] `deploy` job 的 `timeout-minutes` 已设为 5，烟雾测试 sleep 5s + max-time 30s 在范围内
