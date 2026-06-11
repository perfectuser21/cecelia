# DoD — runHarnessInitiativeRouter 图级并发 invoke 互斥（P1）

**范围**: executor.js runHarnessInitiativeRouter 加 per-initiative 进程内执行锁，并发后到者跳过。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] executor.js 有 _activeInitiativeRuns 执行锁表 + 测试 reset hook
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('_activeInitiativeRuns')||!c.includes('_resetActiveInitiativeRunsForTests'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 并发后到者短路返回 skipped:already_running
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"reason: 'already_running'\")||!c.includes('skipped: true'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 锁在 finally 释放（含所有出口）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('_activeInitiativeRuns.delete(initiativeId)'))process.exit(1);if(!/finally\s*\{[\s\S]*_activeInitiativeRuns.delete/.test(c))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 并发互斥回归测试覆盖：并发两次→第二个 skipped+stream 只调一次 / 顺序两次都正常跑（brain-unit CI --changed 实跑此测试）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-resume-checkpoint-error-state.test.js','utf8');['图级并发 invoke 互斥','skipped).toBe(true','already_running','toHaveBeenCalledTimes(1)','顺序两次'].forEach(s=>{if(!c.includes(s))process.exit(1)});console.log('OK')"
