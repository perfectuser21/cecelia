# DoD — KR3 小程序上线前置条件：商户号 + OpenID 配置检测

**Branch**: cp-0413080107-98f59188-9b0e-4612-9df2-b76889
**Task**: [SelfDrive] KR3 小程序：加速完成上线前置条件

## 交付物

- [x] `packages/brain/src/kr3-config-checker.js` 存在且导出 `checkKR3Config()`
- [x] `packages/brain/src/routes/kr3.js` 存在且含 `/check-config` 端点
- [x] `packages/brain/src/routes.js` 注册 `kr3Router` 于 `/kr3`
- [x] `packages/brain/src/kr3-progress-scheduler.js` 集成 config 状态到日报输出

## [BEHAVIOR] kr3-config-checker 导出 checkKR3Config 且返回正确布尔字段

Test: `manual:node -e "import('./packages/brain/src/kr3-config-checker.js').then(m => { const r = m.checkKR3Config(); if (typeof r.wxPayConfigured !== 'boolean') process.exit(1); console.log('ok'); })"`

## [BEHAVIOR] kr3-config-checker.js 含 WX_PAY_READY_KEY 和 ADMIN_OID_READY_KEY 常量

Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/kr3-config-checker.js','utf8');if(!c.includes('kr3_wx_pay_configured')||!c.includes('kr3_admin_oid_initialized'))process.exit(1);console.log('ok')"`

## [BEHAVIOR] routes/kr3.js 含三个端点定义

Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/kr3.js','utf8');if(!c.includes('check-config')||!c.includes('mark-wx-pay')||!c.includes('mark-admin-oid'))process.exit(1);console.log('ok')"`

## [ARTIFACT] routes.js 已注册 kr3Router

Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');if(!c.includes('kr3Router'))process.exit(1);console.log('ok')"`

## [BEHAVIOR] kr3-progress-scheduler.js 集成 checkKR3ConfigDB 调用

Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/kr3-progress-scheduler.js','utf8');if(!c.includes('checkKR3ConfigDB')||!c.includes('configStatus.summary'))process.exit(1);console.log('ok')"`

