# Task Card: [Brain] credential-expiry-checker MINIMAL_MODE guard 修复

**任务 ID**: 929d4868-3ef2-4913-8ad3-f7748c97e370
**分支**: cp-04110834-929d4868-credential-expiry-minimal-mode-fix
**优先级**: P1

## 问题

`BRAIN_MINIMAL_MODE=true` 时，`tick.js` 第 1653 行的凭据有效期检查块未被 MINIMAL_MODE guard 覆盖。
导致每 30 分钟仍会调用 `checkAndAlertExpiringCredentials` 和 `scanAuthLayerHealth`，在 DB 创建告警任务，浪费 token。

## 修复范围

`packages/brain/src/tick.js` 第 1651–1689 行：
- `checkAndAlertExpiringCredentials`（创建告警任务）→ 加 `!MINIMAL_MODE` guard
- `scanAuthLayerHealth`（创建 auth 失败告警）→ 加 `!MINIMAL_MODE` guard
- `recoverAuthQuarantinedTasks`（恢复隔离任务，有益）→ 保留（不管 MINIMAL_MODE）
- `cleanupDuplicateRescueTasks`（清理重复任务，有益）→ 保留

## DoD

- [x] `[ARTIFACT]` tick.js 第 1653 行条件加 `!MINIMAL_MODE &&` guard
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes('!MINIMAL_MODE && credentialCheckElapsed'))process.exit(1);console.log('OK')"`

- [x] `[BEHAVIOR]` MINIMAL_MODE 下 checkAndAlertExpiringCredentials 不被调用
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const idx=c.split('\\n').findIndex(l=>l.includes('!MINIMAL_MODE && credentialCheckElapsed'));if(idx<0)process.exit(1);console.log('guard at line '+(idx+1))"`
