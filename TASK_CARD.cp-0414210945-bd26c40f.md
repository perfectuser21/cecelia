# Task Card — KR3 小程序上线配置

**Branch**: cp-0414210945-bd26c40f-2a4c-4677-bab6-a33ae9
**Task ID**: bd26c40f-2a4c-4677-bab6-a33ae993c9b5
**Date**: 2026-04-14

## 任务目标

微信小程序上线前最后两项配置工作：
1. 支付商户号配置（MCHID + V3_KEY + SERIAL_NO + 私钥）
2. 管理员 OpenID 写入 admins 集合

## 技术分析结论

代码层面早已完成（PR #14-#27）：
- `createPaymentOrder` 从 env var 读取商户凭据
- `checkAdmin` 内置 fallback + DB 动态查询
- `bootstrapAdmin` / `addAdmin` 已部署

阻断点是**外部运营依赖**，非代码问题：
1. 微信商户平台开户状态（MCHID/V3_KEY/SERIAL_NO）
2. WeChat Cloud 禁止外部 DB 写入（errcode -501005）

## 本次 PR 产出

- `zenithjoy-miniapp` PR #30：支付配置助手 + 上线 checklist
  - `scripts/setup-credentials.js`：自动检查 + 预填私钥
  - `docs/launch-checklist.md`：精确化 P0 阻断项
- `~/.credentials/wechat-pay.env` 已创建（私钥已预填，待填 3 项商户信息）

## 剩余人工操作（P0 阻断）

| # | 操作 | 路径 |
|---|------|------|
| 1 | 获取 MCHID + SERIAL_NO + 设置 V3_KEY | pay.weixin.qq.com → 账户中心 |
| 2 | 填入 wechat-pay.env | `~/.credentials/wechat-pay.env` |
| 3 | 配置云函数环境变量 | 微信云控制台 → createPaymentOrder |
| 4 | 调用 bootstrapAdmin | 微信开发者工具 → 云函数 → 本地调用 `{}` |
