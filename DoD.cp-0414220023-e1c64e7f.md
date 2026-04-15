# DoD: KR3 小程序支付商户号配置 + 管理员 OpenID 标记

## Definition of Done

- [x] [ARTIFACT] `scripts/kr3-setup-wx-pay.sh` 新增 `--mark-admin-oid` 选项
  Test: `manual:node -e "const c=require('fs').readFileSync('scripts/kr3-setup-wx-pay.sh','utf8');if(!c.includes('--mark-admin-oid'))process.exit(1);console.log('✅ --mark-admin-oid option exists')"`

- [x] [BEHAVIOR] Brain DB `kr3_admin_oid_initialized` decision 已写入 active 状态
  Test: `manual:node -e "const {execSync}=require('child_process');const r=execSync('psql -d cecelia -At -c \"SELECT COUNT(*) FROM decisions WHERE topic=\\'kr3_admin_oid_initialized\\' AND status=\\'active\\'\"').toString().trim();if(r==='0')process.exit(1);console.log('✅ kr3_admin_oid_initialized active count:',r)"`

- [x] [ARTIFACT] `zenithjoy-miniapp/docs/launch-checklist.md` 管理员 OpenID 项目更新为功能就绪
  Test: `manual:node -e "const c=require('fs').readFileSync('/Users/administrator/perfect21/zenithjoy-miniapp/docs/launch-checklist.md','utf8');if(!c.includes('checkAdmin 内置 fallback 功能就绪'))process.exit(1);console.log('✅ checklist updated')"`

- [x] [BEHAVIOR] `GET /api/brain/kr3/check-config` 返回 `adminOidReady: true`
  Test: `manual:node -e "const {execSync}=require('child_process');const r=JSON.parse(execSync('curl -sf localhost:5221/api/brain/kr3/check-config').toString());if(!r.adminOidReady)process.exit(1);console.log('✅ adminOidReady:true')"`

## 成功标准

- `kr3-setup-wx-pay.sh --mark-admin-oid` 可正确写入 Brain DB 并输出成功提示
- Brain API `/kr3/check-config` 返回 `adminOidReady: true`
- zenithjoy-miniapp checklist 管理员 OpenID 项标注为功能就绪
