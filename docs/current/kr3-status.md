# KR3 微信小程序上线状态

**更新时间**: 2026-04-13
**代码完成度**: ~85%（26 个 PR 已合并）
**Brain 进度**: 65%
**状态**: 🟡 代码就绪，等待手动部署

---

## 已完成（代码层面）

| PR | 内容 | 状态 |
|----|------|------|
| #1-#11 | 核心功能：首页/AI聊天/文案/文章库/会员/支付集成 | ✅ MERGED |
| #13 | 阻断 Bug 清零（会员页语法错误 + 文章云函数恢复） | ✅ MERGED |
| #14 | 支付商户号 V3 配置代码 + 管理员 OpenID 更新 | ✅ MERGED |
| #16 | checkAdmin 动态查询 | ✅ MERGED |
| #18 | 隐私协议弹窗（微信审核要求） | ✅ MERGED |
| #20 | addAdmin + bootstrapAdmin + checkAdmin env var fallback | ✅ MERGED |
| #24 | launch-checklist v2.0 更新 | ✅ MERGED |
| #25 | 灰度阶段0完成 → 阶段1就绪 | ✅ MERGED |
| #26 | checkAdmin 三级 fallback + ai-features.wxml 修复 + v1.0.0 上传 | ✅ MERGED |

**小程序 v1.0.0 已上传至微信后台（robot 1）**

---

## 剩余 P0 手动操作（全部需 CN Mac mini）

| # | 操作 | 执行路径 | 优先级 |
|---|------|---------|--------|
| 1 | 部署 9 个云函数到生产环境 | 微信开发者工具 → 云开发 → 逐一上传 | P0 |
| 2 | 设置体验版 | 微信公众平台 → 版本管理 → 设为体验版 | P0 |
| 3 | 支付沙盒联调 | 真机 + 商户号沙盒 + `createPaymentOrder` env var | P0 |
| 4 | 真机测试 iOS + Android | 扫码测试，核心路径走通 | P0 |
| 5 | 填写小程序名称/图标/分类 | 微信公众平台 → 设置 | P0 |

### 支付配置

商户号 env var 需要在微信云控制台 → 云函数 `createPaymentOrder` → 环境变量中配置：
- `MCHID` - 微信商户号
- `MCHKEY` - 商户 API 密钥 V3
- 其他凭据参见 `docs/wechat-pay-setup.md`（在 zenithjoy-miniapp 仓库）

### 管理员 OpenID

内置兜底已配置（PR #26），三级 fallback：
1. admins 集合 DB 查询
2. 环境变量 `ADMIN_OPENIDS`
3. 代码内置：`o2lLz62X0iyQEYcpnS2ljUvXlHF0`

---

## 灰度上线 8 步操作

1. 在 CN Mac mini：`git checkout main && git pull origin main`
2. 微信开发者工具打开 `/Users/administrator/perfect21/zenithjoy-miniapp`
3. 上传所有 9 个云函数（逐一右键 → 上传部署）
4. 手动触发 `initDatabase` 一次
5. 手机扫码预览 → 核心流程测试
6. 开发者工具 → 上传 → 填写版本描述 → 设为体验版
7. 邀请 5-10 人内测（公众平台 → 成员管理）
8. 内测无 P0 bug → 提交审核

---

## 仓库引用

- **zenithjoy-miniapp**: `perfectuser21/zenithjoy-miniapp`
- **launch-checklist**: `zenithjoy-miniapp/docs/launch-checklist.md`
- **支付配置指南**: `zenithjoy-miniapp/docs/wechat-pay-setup.md`
