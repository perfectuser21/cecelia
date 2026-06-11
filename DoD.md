# DoD — 对齐 phase-event/initiative_run_events stale 测试至新 SSOT 契约

**范围**: 4 个测试文件的 stale skill-content 断言改写为断言 Brain 侧 owner（events/initiativeRunEvents.js）。纯测试对齐，不改 src/skill。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] harness.test.js 不再读 skill SKILL.md 做断言，改断言 Brain 侧 owner
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/__tests__/harness.test.js','utf8');if(c.includes('skills/harness-report/SKILL.md'))process.exit(1);if(!c.includes('events/initiativeRunEvents.js'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] skill-phase-event-calls.test.ts 改断言 Brain 侧 owner（不再 grep SKILL.md）
  Test: manual:node -e "const c=require('fs').readFileSync('sprints/06040940-harness-phase-metrics/tests/skill-phase-event-calls.test.ts','utf8');if(!c.includes('initiativeRunEvents.js'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] report-step6-refs-events.test.ts 改断言 events/initiativeRunEvents.js（不再读 harness-report SKILL.md）
  Test: manual:node -e "const c=require('fs').readFileSync('sprints/06040940-harness-phase-metrics/tests/report-step6-refs-events.test.ts','utf8');if(c.includes('harness-report/SKILL.md'))process.exit(1);if(!c.includes('initiativeRunEvents.js'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] harness-phase-event.test.ts 的 stale 「skill 含 phase-event 字面」断言已清除并替换为 Brain 侧 owner 断言（brain-unit CI --changed 实跑这 4 个测试文件验证全绿）
  Test: manual:node -e "const c=require('fs').readFileSync('sprints/06040940-harness-phase-metrics/tests/harness-phase-event.test.ts','utf8');if(c.includes('skills/${skill}/SKILL.md'))process.exit(1);if(!c.includes('INSERT INTO initiative_run_events'))process.exit(1);console.log('OK')"
