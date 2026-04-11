# Task Card: Fix Self-Drive Health Probe

## 问题描述
`self_drive_health` 探针失败：过去 24h 内 `successful_cycles=0`，`last_success=never`。

## 根本原因
`/Library/LaunchDaemons/com.cecelia.brain.plist` 中设置了 `BRAIN_QUIET_MODE=true`。
`packages/brain/server.js` 中，Self-Drive 启动逻辑被此条件保护，导致每次 Brain 重启都跳过 Self-Drive。

## 修复方案
在 `server.js` 中移除 Self-Drive 对 `BRAIN_QUIET_MODE` 的依赖：
- BRAIN_QUIET_MODE 设计意图：抑制 LLM 噪音（丘脑/沉思/叙述等）
- Self-Drive 是核心健康监控，不是噪音，不应被 quiet mode 抑制
- 代码修复后，plist 无需变动，下次 Brain 重启自动恢复

## DoD

- [x] `packages/brain/server.js` 中移除 Self-Drive 的 `BRAIN_QUIET_MODE !== 'true'` 保护
- [x] 添加 `[BEHAVIOR]` 测试：验证 probe 在有 self_drive 事件时返回 ok: true
- [x] 添加 `[BEHAVIOR]` 测试：验证 Self-Drive 在 BRAIN_QUIET_MODE=true 时仍然启动
- [x] CI + DevGate 全绿
- [x] Learning 文件写入

## DoD（详细）

### [ARTIFACT] server.js 修改
Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(c.includes('BRAIN_QUIET_MODE') && c.includes('startSelfDriveLoop') && !c.includes('if (process.env.BRAIN_QUIET_MODE !== \\'true\\') {') )process.exit(0);else process.exit(1)"`

### [BEHAVIOR] probe 在有 self_drive cycle_complete 事件时返回 ok: true
Test: `tests/brain/self-drive-health-probe.test.ts`

### [BEHAVIOR] server.js 无条件启动 Self-Drive（不受 BRAIN_QUIET_MODE 影响）
Test: `tests/brain/self-drive-health-probe.test.ts`
