# DoD — KR3 小程序上线配置工具

**Branch**: cp-0414210945-bd26c40f-2a4c-4677-bab6-a33ae9
**Task ID**: bd26c40f-2a4c-4677-bab6-a33ae993c9b5

## 验收条目

- [x] [ARTIFACT] `zenithjoy-miniapp/scripts/setup-credentials.js` 存在且可执行
  - Test: `manual:node -e "require('fs').accessSync(require('path').join(require('os').homedir(),'perfect21/zenithjoy-miniapp/scripts/setup-credentials.js'))"`

- [x] [ARTIFACT] `~/.credentials/wechat-pay.env` 已创建，包含 WX_PAY_PRIVATE_KEY
  - Test: `manual:node -e "const c=require('fs').readFileSync(require('path').join(require('os').homedir(),'.credentials/wechat-pay.env'),'utf8');if(!c.includes('WX_PAY_PRIVATE_KEY'))process.exit(1)"`

- [x] [BEHAVIOR] `setup-credentials.js --dry-run` 输出配置状态检查报告
  - Test: `manual:node -e "const {execSync}=require('child_process');execSync('node scripts/setup-credentials.js --dry-run',{cwd:require('path').join(require('os').homedir(),'perfect21/zenithjoy-miniapp'),stdio:'pipe'})"`

- [x] [ARTIFACT] `zenithjoy-miniapp` PR #30 已创建
  - Test: `manual:node -e "const {execSync}=require('child_process');const r=execSync('gh pr view 30 --repo perfectuser21/zenithjoy-miniapp --json state -q .state',{encoding:'utf8'}).trim();if(r!=='OPEN'&&r!=='MERGED')process.exit(1)"`

## 阻断说明

以下步骤因 WeChat Cloud 平台限制需人工完成（`needs_human_review: true`）：
1. 从微信商户平台获取 MCHID/V3_KEY/SERIAL_NO 并填入 `~/.credentials/wechat-pay.env`
2. 通过微信开发者工具调用 `bootstrapAdmin` 云函数写入管理员 OpenID
3. 在云控制台配置 `createPaymentOrder` 环境变量
