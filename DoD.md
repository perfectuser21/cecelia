# DoD: 修复 self_drive_health 链路探针故障

- [ ] [PRESERVE] 现有 PROBES 数组定义不变（rumination/evolution/consolidation 探针保持原样）
  Test: tests/capability-probe-highlevel.test.js

- [ ] [ARTIFACT] 创建 `packages/brain/migrations/192_fix_thalamus_model.sql`，重置 profile-anthropic 的 thalamus 为 anthropic/claude-haiku-4-5-20251001
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/192_fix_thalamus_model.sql','utf8');if(!c.includes('claude-haiku-4-5-20251001'))process.exit(1);if(!c.includes('profile-anthropic'))process.exit(1);console.log('OK')"

- [ ] [BEHAVIOR] `probeSelfDriveHealth` 查询逻辑更新为：有 cycle_complete 或 no_action 事件即返回 ok:true
  Test: tests/capability-probe-highlevel.test.js

- [ ] [ARTIFACT] `capability-probe-highlevel.test.js` 新增至少 2 个 self_drive_health 场景单测（成功路径 + 失败路径）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/capability-probe-highlevel.test.js','utf8');const m=c.match(/self_drive_health/g);if(!m||m.length<2)process.exit(1);console.log('OK: self_drive_health tests found: '+m.length)"

- [ ] [GATE] 所有现有测试通过
  Test: tests/capability-probe-highlevel.test.js
