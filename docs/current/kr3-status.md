# KR3 微信小程序上线状态

**更新时间**: 2026-04-13（post-PR#2329）
**代码完成度**: ~95%（27 个 miniapp PR + Brain 配置检测器已合并）
**Brain OKR current_value**: 70
**状态**: 🟡 代码就绪，等待 CN Mac mini 手动部署 + Brain 重启激活 kr3 路由

---

## 最新进展

| PR | 内容 | 状态 |
|----|------|------|
| cecelia#2329 | Brain `kr3-config-checker.js` + `/api/brain/kr3/check-config` 端点 | ✅ MERGED |
| cecelia#2327 | `notifyPayment` 支付配置追踪文档 | ✅ MERGED |
| miniapp#27 | `notifyPayment` 云函数：微信支付 V3 回调处理器（AES-256-GCM 解密 + 激活会员）；修复 `createPaymentOrder` 的 `notify_url` | ✅ MERGED |
| miniapp#26 | `checkAdmin` 三层 fallback（DB → ADMIN_OPENIDS env → 内置 OpenID）+ 灰度 Phase 1 | ✅ MERGED |
| miniapp#25 | 灰度阶段 0 完成 → 阶段 1 就绪标注 | ✅ MERGED |
| miniapp#1-#24 | 核心功能全量（首页/AI聊天/文案/文章库/会员/支付/用户管理） | ✅ MERGED |

### Brain kr3 配置检测 API

Brain 已有 `packages/brain/src/kr3-config-checker.js`，待 Brain 重启后可用：

```bash
# 查询配置状态
curl localhost:5221/api/brain/kr3/check-config

# 标记微信支付已配置（商户号申请完成后调用）
curl -X POST localhost:5221/api/brain/kr3/mark-wx-pay -H "Content-Type: application/json" -d '{"note":"已在云控制台配置5个WX_PAY_*环境变量"}'

# 标记管理员 OpenID 已初始化（bootstrapAdmin 调用后执行）
curl -X POST localhost:5221/api/brain/kr3/mark-admin-oid -H "Content-Type: application/json" -d '{"note":"已调用bootstrapAdmin初始化"}'
```

---

## 关键配置状态

### 管理员 OpenID（已就绪）

`checkAdmin` 云函数实现三层 fallback，无需手动替换：

```
优先级 1: DB admins 集合动态查询
优先级 2: 云函数环境变量 ADMIN_OPENIDS
优先级 3: 代码内置 o2lLz62X0iyQEYcpnS2ljUvXlHF0
```

首次部署后调用 `bootstrapAdmin` 云函数一次，调用者 OpenID 自动写入 DB（推荐）。

### 支付商户号（待配置）

`createPaymentOrder` 从环境变量读取，代码已就绪。需要以下 5 个云函数环境变量：

| 变量 | 来源 | 状态 |
|------|------|------|
| `WX_PAY_MCHID` | 微信商户平台 → 账户中心 | ⏳ 待申请 |
| `WX_PAY_V3_KEY` | 微信商户平台 → API安全 | ⏳ 待申请 |
| `WX_PAY_SERIAL_NO` | 商户证书文件 | ⏳ 待申请 |
| `WX_PAY_PRIVATE_KEY` | `apiclient_key.pem` | ⏳ 待申请 |
| `WX_PAY_NOTIFY_URL` | notifyPayment HTTP 触发器 URL | ⏳ 部署后填写 |

> 商户号申请详见：`zenithjoy-miniapp/docs/wechat-pay-setup.md`

---

## P0 剩余手动操作（全部需 CN Mac mini 微信开发者工具）

| # | 操作 | 工具 | 状态 |
|---|------|------|------|
| 1 | 部署 19 个云函数到生产环境 | 微信开发者工具 → 上传部署 | ⏳ 待操作 |
| 2 | 调用 `bootstrapAdmin` 初始化管理员 OpenID | 开发者工具云函数调用 | ⏳ 待操作 |
| 3 | 为 `notifyPayment` 创建 HTTP 触发器 | 云开发控制台 | ⏳ 待操作 |
| 4 | 支付沙盒联调（真机 + 商户号） | 真机 + 微信商户沙盒 | ⏳ 待商户号 |
| 5 | 真机兼容性测试（iOS + Android） | 真机扫码 | ⏳ 待部署后 |
| 6 | 微信公众平台填写名称/图标/分类 | 微信公众平台 | ⏳ 待操作 |

### 部署命令（CN Mac mini 执行）

```bash
cd /Users/administrator/perfect21/zenithjoy-miniapp
source ~/.credentials/wechat-miniapp.env
MINIAPP_PRIVATE_KEY="$(cat ~/.credentials/private.wx98c067e00cce09da.key)" \
  node scripts/run-with-supported-node.js scripts/deploy-cloudfunctions.js
```

> **注意**: `miniprogram-ci` 的 `uploadFunction` 报 "env not found"，需在微信开发者工具中手动部署。
> 原因：云环境 `zenithjoycloud-8g4ca5pbb5b027e8` 与微信开发者账号绑定，不通过腾讯云 SecretId 认证。

---

## 灰度上线计划（代码就绪后执行）

```
阶段 0（已完成）: 核心 bug 清零，v1.0.0 上传
阶段 1（当前）:   云函数部署 + 管理员初始化 + 内测 5-10 人
阶段 2（下一步）: 体验版扩大内测 + 支付沙盒联调
阶段 3（最终）:   提交微信审核 → 正式上线
```

---

## 快速参考

| 资源 | 位置 |
|------|------|
| AppID | `wx98c067e00cce09da` |
| 云环境 ID | `zenithjoycloud-8g4ca5pbb5b027e8` |
| 支付配置指南 | `zenithjoy-miniapp/docs/wechat-pay-setup.md` |
| 灰度方案 | `zenithjoy-miniapp/docs/grayscale-plan.md` |
| 上线 Checklist | `zenithjoy-miniapp/docs/launch-checklist.md` |
| miniapp 仓库 | `/Users/administrator/perfect21/zenithjoy-miniapp` |
