# TASK CARD: KR3 小程序支付配置 + 管理员 OpenID 落地

## 任务信息
- **Task ID**: 4caead7b-ebd3-4aa0-8b2e-1c156563b783
- **Branch**: cp-0413031113-4caead7b-ebd3-4aa0-8b2e-1c1565
- **优先级**: P0
- **类型**: dev

## 目标

KR3 小程序灰度 Phase 1 阻断项解除：

1. **支付商户号配置代码完善**
   - 修复 `createPaymentOrder` 的 `notify_url`（原值错误指向微信服务器）
   - 新增 `notifyPayment` 云函数处理支付成功回调

2. **管理员 OpenID 确认**
   - `checkAdmin` 已有三层 fallback（DB → 环境变量 → 内置），管理员 OpenID 已在代码中就绪

## 背景

- 小程序代码已 85% 完成（26 个 PR 已合并到 `zenithjoy-miniapp` main）
- `819fa3b` 提交（notifyPayment + notify_url 修复）已存在本地，未推送
- 支付商户号（WX_PAY_MCHID 等）需后续在微信商户平台申请后配置为云函数环境变量

## 工作范围

| 工作 | 仓库 | 状态 |
|------|------|------|
| createPaymentOrder notify_url 修复 | zenithjoy-miniapp | 本次 PR |
| notifyPayment 云函数（支付回调处理器） | zenithjoy-miniapp | 本次 PR |
| 管理员 OpenID 三层 fallback | zenithjoy-miniapp | 已在 main（PR#20/#26） |
| KR3 状态追踪 | cecelia | 本次 PR |
