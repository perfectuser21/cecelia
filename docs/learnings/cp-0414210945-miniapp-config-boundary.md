---
branch: cp-0414210945-bd26c40f-2a4c-4677-bab6-a33ae9
date: 2026-04-14
task: bd26c40f — KR3 小程序支付商户号配置 + 管理员 OpenID 替换
---

# Learning: 运营配置任务与代码任务的边界

### 根本原因

此任务被 SelfDrive 连续派发 3 次（均 401 认证失败），核心误判是：将**运营配置**任务作为**代码开发**任务处理。

代码层面（PR #14-#27）早已完成，阻断的全是外部依赖：
- 微信商户平台账户（MCHID/V3_KEY/SERIAL_NO 需人工登录平台获取）
- WeChat Cloud DB 写入权限限制（errcode -501005，外部服务器无法写入）

### 下次预防

- [ ] SelfDrive 生成任务时，如果描述含"登录商户平台/DevTools手动操作"等字样，应自动标记 `delivery_type: ops-config`，而非 `code-only`
- [ ] `delivery_type: ops-config` 类任务跳过 /dev 工作流，直接进入 `needs_human_review` 状态
- [ ] 支付商户开户属于业务前置条件（OKR 层面），不应作为 dev 任务派发
- [ ] WeChat Cloud 外部 DB 写入受限是已知约束，不应重复尝试（errcode -501005 == 确认失败，不应重试）

### 实际产出

- `zenithjoy-miniapp` PR #30：setup-credentials.js + launch-checklist 精确化
- `~/.credentials/wechat-pay.env` 已创建并预填私钥（来自 apiclient_key.pem）
- 人工步骤已文档化（launch-checklist.md P0 阻断项）
