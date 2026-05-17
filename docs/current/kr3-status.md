# KR3 微信小程序上线状态

**更新时间**: 2026-05-16（SelfDrive 加速冲刺审查 + 分阶段目标拆解）
**代码完成度**: ~99%（PR#1-#28 含 Pencil UI 重设计，代码层面完整）
**Brain OKR current_value**: 75（估算，Brain 当前不可达无法写回）
**状态**: 🟠 代码就绪，**CI 私钥未配置**（程序化部署的前置阻断）

---

## 分阶段目标（SelfDrive 加速路线图）

> SelfDrive 看到的 25% 是 DB 陈旧数据（M2 calculator 已修复，Brain 重启后自动写回）。  
> 真实进度 = **60%**（代码就绪基础分），以下为加速路线：

| 阶段 | 目标进度 | 关键里程碑 | 执行者 | 预计完成 |
|------|---------|-----------|--------|---------|
| **阶段 0（当前）** | 60% | 代码就绪 ✅ | — | 已完成 |
| **阶段 1a** | **70%** | miniapp CI 私钥配置 + 云函数部署（19 个） | Alex（手动） | 5/16-5/17 |
| **阶段 1b** | **75%** | 内测启动（5-10 人扫码，不含支付） | Alex | 5/18 |
| **阶段 2** | **81%** | 真机 bug 清零 + 体验版提交微信审核 | Dev + Alex | 5/19-5/24 |
| **阶段 3** | **95%** | 微信审核通过（等待 3-7 天） | 外部 | 5/25-5/30 |
| **阶段 4** | **100%** | WX Pay 商户号 + 支付二期（并行申请） | Alex + Dev | 6月 |

**加速策略**：
1. **解耦支付**：阶段 1b-3 完全不依赖 WX Pay，先上线 AI 聊天/文案/文章库，支付功能二期独立
2. **私钥优先**：CI 私钥是最短路径，Alex 生成后 15 分钟内可完成云函数部署（`bash scripts/kr3-deploy-miniapp.sh --all`）
3. **WX Pay 并行**：申请商户号不阻断内测，现在就去 pay.weixin.qq.com 注册（审核需数天）
4. **进度验收工具**：`bash scripts/verify-kr3.sh --target 50` 可随时检查里程碑状态

**当周可启动任务（5/16-5/22）**：

| 任务 | 执行者 | 前置 | 状态 |
|------|--------|------|------|
| 生成 miniapp CI 私钥（mp.weixin.qq.com → 开发管理 → 代码上传密钥） | Alex | 无 | ⏳ 可立即开始 |
| 申请微信商户号（pay.weixin.qq.com 注册，审核约 3-7 天） | Alex | 无 | ⏳ 可立即开始（并行） |
| Brain 重启后验证 calculator 写回（curl /api/brain/kr3/progress） | Dev | Brain 重启 | ⏳ Brain 上线后 |
| 云函数部署（bash scripts/kr3-deploy-miniapp.sh --setup-key <key> --all） | 自动（私钥就绪后） | CI 私钥 | ⏳ 等私钥 |
| 微信平台信息填写（名称/图标/分类） | Alex | 代码上传 | ⏳ 等云函数 |

---

## 最新进展（2026-04-15 → 2026-05-16）

| PR | 内容 | 状态 |
|----|------|------|
| miniapp#28 | Pencil UI 全面重设计（助手/文案/朋友圈编辑器页面） | ✅ MERGED（2026-04-20）|
| cecelia#2359 | `scripts/kr3-setup-wx-pay.sh` 新增 `--mark-admin-oid` | ✅ MERGED |
| cecelia#2358 | Brain `kr3-config-checker.js` 本地凭据自动检测 | ✅ MERGED |
| miniapp#1-#27 | 核心功能全量（首页/AI聊天/文案/文章库/会员/支付/用户管理） | ✅ MERGED |

---

## 当前真实阻断项（按优先级）

| # | 阻断 | 类型 | 状态 | 解决路径 |
|---|------|------|------|---------|
| **P0** | **miniapp CI 私钥未配置** | 技术 | 🔴 **缺失** | Alex 在 mp.weixin.qq.com → 开发管理 → 代码上传密钥 → 生成新密钥 |
| **P0** | 云函数未部署（依赖私钥） | 技术 | ⏳ 依赖#1 | `node scripts/deploy-cloudfunctions.js`（私钥就绪后 CI 自动） |
| **P0** | 代码未上传微信平台 | 技术 | ⏳ 依赖#1 | `node scripts/upload.js`（私钥就绪后 CI 自动） |
| **P1** | 微信商户号（WX Pay） | 外部 | 🔴 **外部阻断** | 登录 pay.weixin.qq.com 申请（需数天审核） |
| **P2** | 微信平台信息填写 | 运营 | ⏳ 待操作 | mp.weixin.qq.com → 设置（名称/图标/分类）|
| **P2** | 真机兼容性测试 | 测试 | ⏳ 依赖云函数部署 | iOS + Android 各 1 台扫码 |
| **P2** | 内测发布（体验版） | 运营 | ⏳ 依赖平台信息 | 邀请 5-10 内测用户 |

---

## CI 私钥获取步骤（P0 解除方法）

```bash
# Step 1：Alex 手动操作（浏览器）
# 访问 https://mp.weixin.qq.com → 开发 → 开发管理 → 开发设置
# → 小程序代码上传密钥 → 生成密钥 → 下载 private.wx98c067e00cce09da.key

# Step 2：存入 1Password（在 xian-m4 上执行）
source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN
PRIVATE_KEY=$(cat ~/Downloads/private.wx98c067e00cce09da.key)
op item create --vault CS --category "API Credential" \
  --title "ZenithJoy Miniapp CI Key" \
  --tags "miniapp,zenithjoy,dev" \
  "private_key=$PRIVATE_KEY"

# Step 3：写入本地凭据
cat > ~/.credentials/wechat-miniapp.env <<EOF
MINIAPP_APPID=wx98c067e00cce09da
MINIAPP_PRIVATE_KEY=$(cat ~/Downloads/private.wx98c067e00cce09da.key)
MINIAPP_CLOUD_ENV=zenithjoycloud-8g4ca5pbb5b027e8
EOF
chmod 600 ~/.credentials/wechat-miniapp.env

# Step 4：部署云函数（全部 19 个）
cd ~/perfect21/zenithjoy-miniapp
source ~/.credentials/wechat-miniapp.env
node scripts/deploy-cloudfunctions.js

# Step 5：上传小程序代码
node scripts/upload.js
```

---

## 2 周冲刺计划（2026-05-16 ~ 2026-05-30）

**目标：从当前 75% → 100%（正式上线）**

### Week 1（5/16-5/22）：部署就绪

| 日期 | 任务 | 执行者 | 前置 |
|------|------|--------|------|
| 5/16 | 生成 miniapp CI 私钥 | Alex（手动） | 无 |
| 5/16 | 存入 1Password，配置 wechat-miniapp.env | 自动 | 私钥就绪 |
| 5/17 | 部署全部 19 个云函数 | CI（deploy-cloudfunctions.js） | 私钥 |
| 5/17 | 上传小程序代码至微信平台 | CI（upload.js） | 私钥 |
| 5/18 | 填写微信平台信息（名称/图标/分类） | Alex（手动） | 代码上传 |
| 5/18 | 体验版邀请内测（5-10 人） | Alex | 平台信息 |
| 5/18~（并行） | WX Pay 商户号申请 | Alex（外部流程） | 无 |
| 5/19-5/20 | 真机测试（iOS + Android） | | 体验版 |

### Week 2（5/23-5/30）：测试 & 审核

| 日期 | 任务 | 执行者 | 前置 |
|------|------|--------|------|
| 5/23-5/24 | Bug 修复（内测反馈） | Dev | 内测 |
| 5/24 | WX Pay 配置（若商户号已到） | Dev | 商户号 |
| 5/24 | 提交微信审核 | Alex | Bug 修复 |
| 5/25-5/29 | 等待审核（通常 3-7 天） | — | — |
| 5/30 | 审核通过 → 正式发布 🚀 | Alex | 审核 |

### 关键路径

```
CI 私钥生成（Alex, D1）
    ↓
云函数部署（D2）→ 代码上传（D2）→ 体验版（D3）→ 测试（D4-5）→ Bug修复（W2D1-2）→ 审核（W2D3）→ 上线（W2D5+）
         ↘
          WX Pay 申请（并行，不阻断非支付功能测试）
```

---

## 当前配置状态

```bash
# 检查当前配置（Brain 重启后有效）
curl localhost:5221/api/brain/kr3/check-config
# → { adminOidReady: true, wxPayConfigured: false, allReady: false }
```

| 项目 | 状态 | 说明 |
|------|------|------|
| 管理员 OpenID | ✅ 就绪 | checkAdmin 三层 fallback 已生效 |
| CI 私钥 | ❌ **未配置** | 需从 mp.weixin.qq.com 生成下载 |
| 云函数部署 | ❌ 未部署 | 等 CI 私钥 |
| 代码上传 | ❌ 未上传 | 等 CI 私钥 |
| 支付商户号 | ❌ 外部阻断 | 需申请微信商户平台账号 |

---

## WX Pay 外部阻断（维持原状）

**缺失的外部凭据**（需从微信商户平台获取）：

| 变量 | 来源 | 状态 |
|------|------|------|
| `WX_PAY_MCHID` | 微信商户平台 → 账户中心 → 商户信息 | ❌ 未申请 |
| `WX_PAY_V3_KEY` | 微信商户平台 → API安全 → 设置密钥 | ❌ 未申请 |
| `WX_PAY_SERIAL_NO` | 微信商户平台 → API安全 → 证书序列号 | ❌ 未申请 |
| `WX_PAY_PRIVATE_KEY` | `~/.credentials/apiclient_key.pem` | ✅ 已就绪 |
| `WX_PAY_NOTIFY_URL` | notifyPayment HTTP 触发器 URL（部署后填写） | ⏳ 待部署 |

---

## 历史进展

| PR | 内容 | 状态 |
|----|------|------|
| cecelia#2329-#2359 | Brain KR3 配置检查 + WX Pay 配置工具 | ✅ MERGED |
| miniapp#1-#28 | 核心功能全量 + Pencil UI 重设计 | ✅ MERGED |

> **阶段 1a（云函数 + 内测）不依赖 WX Pay**，支付功能暂不可用不影响 AI 聊天/文案/文章库等核心功能的内测。
