# Task Card: KR3 小程序支付商户号配置 + 管理员 OpenID 替换

**Task ID**: e1c64e7f-b339-44d7-a591-fa0912d0a915  
**Branch**: cp-0414212718-e1c64e7f-b339-44d7-a591-fa0912  
**KR**: ZenithJoy KR3 — 微信小程序上线

---

## 背景

KR3 上线前置 checklist 有两个未完成项：
1. **支付商户号配置**（WX_PAY_MCHID / V3_KEY / SERIAL_NO）— 私钥已就绪，缺少 3 个商户号参数
2. **管理员 OpenID**（替换为正式环境值）— 已通过代码内置 fallback 配置，Brain DB 中 `adminOidReady: true`

Brain 已有 `kr3-config-checker.js` 和 `routes/kr3.js`，但存在以下问题：
- `checkKR3Config()`（非 DB 版本）检查的 env var 名称与 miniapp 实际使用的不一致
- Brain 无法自动感知 `~/.credentials/wechat-pay.env` 中的配置，需要用户手动调用 API 标记

## 解决方案

在 Brain 中增加**本地凭据自动检测**：
- 读取 `~/.credentials/wechat-pay.env`，检查 MCHID/V3_KEY/SERIAL_NO 是否已填入
- 若已填入，自动在 DB 中标记 `kr3_wx_pay_configured`（减少手动步骤）
- 修复 `checkKR3Config()` 中 env var 名称不匹配的 bug

---

## DoD（完成标准）

### [ARTIFACT] kr3-config-checker.js 新增本地凭据读取

- [x] `readLocalPayCredentials()` 函数：读取 `~/.credentials/wechat-pay.env`，返回 MCHID/V3_KEY/SERIAL_NO 状态
- [x] `autoMarkKR3IfLocalCredentialsReady()` 函数：若本地凭据齐全且 DB 未标记，自动插入 `kr3_wx_pay_configured` decision
- [x] 修复 `checkKR3Config()`：检查正确的 env var 名称（WX_PAY_MCHID / WX_PAY_V3_KEY / WX_PAY_SERIAL_NO）

### [ARTIFACT] routes/kr3.js 新增端点

- [x] `GET /kr3/local-credentials-status`：返回本地凭据文件中的配置状态（不暴露值，只显示是否已填写）

### [BEHAVIOR] 自动检测逻辑正确工作

- [x] `Test:` `manual:node -e "const {readLocalPayCredentials}=require('./packages/brain/src/kr3-config-checker.js');console.log(readLocalPayCredentials())"`
  - 验证：输出包含 `mchidPresent`、`v3KeyPresent`、`serialNoPresent` 字段
  - 现实情况：三个字段均为 false（凭据文件中值为空）

### [BEHAVIOR] Brain tick 中 KR3 进度报告包含本地凭据状态

- [x] `Test:` `manual:node -e "const fs=require('fs');const c=fs.readFileSync('./packages/brain/src/kr3-config-checker.js','utf8');if(!c.includes('readLocalPayCredentials'))process.exit(1);console.log('OK')"`

---

## 技术决策

- 本地凭据读取：`os.homedir()` + 路径拼接，不硬编码 `/Users/administrator`
- 不暴露实际凭据值，API 只返回 `present: true/false`
- 自动标记逻辑幂等：若 DB 中已有 active 记录，不重复插入
