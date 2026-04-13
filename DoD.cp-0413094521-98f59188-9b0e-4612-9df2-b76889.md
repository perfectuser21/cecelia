# DoD — KR3 状态更新：post-PR#2329 全量合并记录

**Branch**: cp-0413094521-98f59188-9b0e-4612-9df2-b76889
**Task**: [SelfDrive] KR3 小程序：加速完成上线前置条件（商户号 + OpenID 替换）

## 交付物

- [x] `docs/current/kr3-status.md` 更新为 post-PR#2329 状态（含 Brain API 调用示例）

## [ARTIFACT] kr3-status.md 已更新含 Brain kr3 API 参考

Test: `manual:node -e "const c=require('fs').readFileSync('docs/current/kr3-status.md','utf8');if(!c.includes('kr3-config-checker')||!c.includes('mark-wx-pay'))process.exit(1);console.log('ok')"`

## [BEHAVIOR] kr3-status.md 记录了 cecelia#2329 合并状态

Test: `manual:node -e "const c=require('fs').readFileSync('docs/current/kr3-status.md','utf8');if(!c.includes('cecelia#2329')||!c.includes('MERGED'))process.exit(1);console.log('ok')"`
