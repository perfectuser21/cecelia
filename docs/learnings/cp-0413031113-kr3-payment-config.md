---
branch: cp-0413031113-4caead7b-ebd3-4aa0-8b2e-1c1565
date: 2026-04-13
task: KR3 小程序支付商户号配置 + 管理员 OpenID 落地
---

# Learning: KR3 小程序 notifyPayment + 支付回调配置落地

### 根本原因

**问题 1 — notify_url 错误导致支付回调永远无法送达**：
`createPaymentOrder` 原先将 notify_url 硬编码为 `https://api.mch.weixin.qq.com/v3/pay/notify/${MCHID}`，
这是微信支付 API 本身的路径，不是回调目标。导致商户号配置后，支付成功通知也永远发送到错误地址。

**问题 2 — notifyPayment 云函数不存在**：
支付代码实现了前端调起支付 + 统一下单，但缺少接收微信服务端回调的 `notifyPayment` 处理器。
即使支付成功，会员状态也无法自动激活。

**问题 3 — 任务重试时工作已完成**：
前次执行（当天早些时候）已完成代码提交和 PR 创建，但在任务回写 Brain 时遭遇 401 auth 错误，
导致 Brain 重新调度该任务。本次执行需要识别这种情况（工作已完成，只需补回写）。

### 下次预防

- [ ] **任务执行前先检查 miniapp PR 历史**：`gh pr list --state all --head <branch>`，避免重复创建 PR
- [ ] **notifyPayment 是支付链路的必要组成**：写支付统一下单时，同步写回调处理器
- [ ] **notify_url 务必是云函数 HTTP 触发器 URL**，格式：`https://<env-id>.service.tcloudbase.com/<functionName>`
- [ ] **Brain 任务回写失败不代表任务未完成**：检查 PR 合并状态后再判断是否需要重做

### 剩余手动操作（需 CN Mac mini）

1. 在微信商户平台申请支付商户号（pay.weixin.qq.com）
2. 云函数控制台为 `notifyPayment` 创建 HTTP 触发器
3. 将 5 个环境变量（WX_PAY_MCHID/V3_KEY/SERIAL_NO/PRIVATE_KEY/NOTIFY_URL）配置到 `createPaymentOrder`
4. 在微信开发者工具调用 `bootstrapAdmin`（admins 集合为空时），初始化管理员 OpenID
