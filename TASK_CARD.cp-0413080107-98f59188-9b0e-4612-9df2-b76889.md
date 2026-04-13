# Task Card — KR3 小程序上线前置条件：商户号 + OpenID 配置检测

**Task ID**: 98f59188-9b0e-4612-9df2-b76889
**Branch**: cp-0413080107-98f59188-9b0e-4612-9df2-b76889
**Priority**: P0
**Date**: 2026-04-13

## 目标

KR3 微信小程序上线被两个配置项阻断：
1. **支付商户号（WX_PAY_*）**：需人工申请微信商户号并配置 5 个云函数环境变量
2. **管理员 OpenID**：miniapp checkAdmin 三层 fallback（DB→env→builtin）已就绪，但 DB 层未初始化

当前 Brain 无法感知这两个配置是否已就绪，导致 SelfDrive 无法自动推进 KR3 进度。

## 解决方案

在 Brain 中新增 `kr3-config-checker.js`，提供：
1. WeChat Pay 环境变量（miniapp 云函数侧）状态查询
2. Brain DB 中管理员 OpenID 是否已初始化的检测
3. `/api/brain/kr3/check-config` 端点暴露配置状态
4. `kr3-progress-scheduler.js` 集成：每日报告包含配置状态

## 范围

- **新增**: `packages/brain/src/kr3-config-checker.js`
- **修改**: `packages/brain/src/kr3-progress-scheduler.js`（集成配置状态到日报）
- **修改**: `packages/brain/src/routes/brain.js`（新增 `/api/brain/kr3/check-config` 路由）

## 完成标准

详见 DoD
