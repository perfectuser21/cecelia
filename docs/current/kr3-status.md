# KR3 微信小程序上线状态

**更新时间**: 2026-04-15（post-PR#2359）
**代码完成度**: ~97%（PR#2351-#2359 全量合并，仅剩外部商户号申请）
**Brain OKR current_value**: 70
**状态**: 🟡 代码就绪，WX Pay 外部阻断（待商户号申请），可并行推进灰度部署

---

## 最新进展

| PR | 内容 | 状态 |
|----|------|------|
| cecelia#2359 | `scripts/kr3-setup-wx-pay.sh` 新增 `--mark-admin-oid`；Brain DB `kr3_admin_oid_initialized` 已标记 | ✅ MERGED |
| cecelia#2358 | Brain `kr3-config-checker.js` 本地凭据自动检测 + 修复 env var 名称不匹配 | ✅ MERGED |
| cecelia#2352 | 私钥 PKCS#8 转换 + setup 脚本增强 | ✅ MERGED |
| cecelia#2351 | WX Pay 配置引导脚本 + 管理员 OID 落地 | ✅ MERGED |
| cecelia#2329 | Brain `kr3-config-checker.js` + `/api/brain/kr3/check-config` 端点 | ✅ MERGED |
| miniapp#1-#27 | 核心功能全量（首页/AI聊天/文案/文章库/会员/支付/用户管理/bootstrapAdmin） | ✅ MERGED |

---

## 当前配置状态（Brain API）

```bash
curl localhost:5221/api/brain/kr3/check-config
# → { adminOidReady: true, wxPayConfigured: false, allReady: false }
```

| 项目 | 状态 | 说明 |
|------|------|------|
| 管理员 OpenID | ✅ adminOidReady: true | checkAdmin 三层 fallback 就绪（DB → ADMIN_OPENIDS env → 内置 o2lLz62X0iyQEYcpnS2ljUvXlHF0） |
| 支付商户号 | ❌ wxPayConfigured: false | **外部阻断**：私钥已就绪，缺 MCHID/V3_KEY/SERIAL_NO（需微信商户平台申请） |

### Brain kr3 配置 API

```bash
# 查询配置状态
curl localhost:5221/api/brain/kr3/check-config

# 本地凭据检测状态（PR#2358 新增）
curl localhost:5221/api/brain/kr3/local-credentials-status

# 标记微信支付已配置（商户号申请完成后调用）
curl -X POST localhost:5221/api/brain/kr3/mark-wx-pay \
  -H "Content-Type: application/json" \
  -d '{"note":"已在云控制台配置5个WX_PAY_*环境变量"}'

# 标记管理员 OpenID 已初始化（已完成）
curl -X POST localhost:5221/api/brain/kr3/mark-admin-oid \
  -H "Content-Type: application/json" \
  -d '{"note":"checkAdmin 内置 fallback 已就绪"}'
```

---

## P0 阻断项状态

| # | 问题 | 状态 | 解决方案 |
|---|------|------|---------|
| 1 | 云函数未部署到生产环境 | ⏳ 待操作（CN Mac mini 微信开发者工具） | 开发者工具逐一上传 9 个云函数 |
| 2 | 支付商户号配置缺失 | 🔴 **外部阻断**（待商户号申请） | 登录微信商户平台申请 MCHID + 下载 V3_KEY + SERIAL_NO → 配置云函数环境变量 |
| 3 | 管理员 OpenID 替换 | ✅ 已完成 | checkAdmin 三层 fallback 已生效；Brain DB `kr3_admin_oid_initialized` 已标记 |
| 4 | 支付沙盒测试 | ⏳ 待操作（依赖#2） | 商户号配置完成后，真机 + 沙盒环境联调 |
| 5 | 真机兼容性测试 | ⏳ 待操作 | iOS + Android 各 1 台扫码测试 |
| 6 | 微信平台信息填写 | ⏳ 待操作 | 公众平台设置名称/图标/分类 |

---

## WX Pay 外部阻断详情

**阻断原因**：支付商户号 (MCHID) 尚未申请，微信商户平台账号未开通。

**已就绪部分**：
- `~/.credentials/apiclient_key.pem` — 私钥（PKCS#8 格式） ✅
- `packages/brain/src/kr3-config-checker.js` — 本地凭据检测 + 自动标记 ✅
- `scripts/kr3-setup-wx-pay.sh` — 完整配置引导工具 ✅
- `zenithjoy-miniapp/docs/wechat-pay-setup.md` — 申请步骤文档 ✅

**缺失的外部凭据**（需从微信商户平台获取）：

| 变量 | 来源 | 状态 |
|------|------|------|
| `WX_PAY_MCHID` | 微信商户平台 → 账户中心 → 商户信息 | ❌ 未申请 |
| `WX_PAY_V3_KEY` | 微信商户平台 → API安全 → 设置密钥 | ❌ 未申请 |
| `WX_PAY_SERIAL_NO` | 微信商户平台 → API安全 → 证书序列号 | ❌ 未申请 |
| `WX_PAY_PRIVATE_KEY` | `~/.credentials/apiclient_key.pem` | ✅ 已就绪 |
| `WX_PAY_NOTIFY_URL` | notifyPayment HTTP 触发器 URL（部署后填写） | ⏳ 待部署后确认 |

**获取商户号步骤**：
1. 打开 `zenithjoy-miniapp/docs/wechat-pay-setup.md`，按步骤申请商户平台账号
2. 申请完成后执行 `bash scripts/kr3-setup-wx-pay.sh --check-only` 确认本地状态
3. 在微信云开发控制台为 `createPaymentOrder` 云函数配置 5 个环境变量
4. 执行 `bash scripts/kr3-setup-wx-pay.sh --mark-done` 通知 Brain

---

## 管理员 OpenID 状态（已完成）

`checkAdmin` 云函数三层 fallback 已全部就绪：

```
优先级 1: DB admins 集合动态查询（bootstrapAdmin 调用后写入）
优先级 2: 云函数环境变量 ADMIN_OPENIDS（微信云控制台配置）
优先级 3: 代码内置 BUILT_IN_ADMIN_OPENIDS = ['o2lLz62X0iyQEYcpnS2ljUvXlHF0']
```

Brain DB 状态：`kr3_admin_oid_initialized = active`（2026-04-15）

可选加固（非必须）：微信开发者工具 → 云函数 → bootstrapAdmin → 本地调用 `{}` → 将调用者 OpenID 写入 admins 集合

---

## 灰度上线计划

```
阶段 0（已完成）: 核心 bug 清零，v1.0.0 上传
阶段 1（当前，可并行）:
  a) 云函数部署 + 管理员初始化 + 内测 5-10 人（不依赖 WX Pay）
  b) 微信商户号申请（外部流程，需数天审核）
阶段 2（阶段1b 完成后）: 体验版扩大内测 + 支付沙盒联调
阶段 3（最终）: 提交微信审核 → 正式上线
```

> ⚠️ 阶段 1a（云函数部署 + 内测）**不依赖**支付商户号，可立即开始。支付功能暂时不可用不影响 AI 聊天/文案/文章库等核心功能的内测。

---

## 部署命令（CN Mac mini 执行）

```bash
# 微信开发者工具手动部署（必须）
# 原因：云环境 zenithjoycloud-8g4ca5pbb5b027e8 与微信账号绑定，不走腾讯云 API

# 代码库位置
cd /Users/administrator/perfect21/zenithjoy-miniapp

# 配置状态检查
bash /Users/administrator/perfect21/cecelia/scripts/kr3-setup-wx-pay.sh --check-only

# 商户号就绪后：标记配置完成
bash /Users/administrator/perfect21/cecelia/scripts/kr3-setup-wx-pay.sh --mark-done
```
