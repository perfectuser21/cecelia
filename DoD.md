# DoD — evaluate 节点 PR 已 merge 时短路 PASS

**范围**: evaluateContractNode 幂等门后加 merged-short-circuit（gh pr view state=MERGED → PASS）。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] evaluateContractNode 有 checkPrMerged + merged-short-circuit 返回 PASS
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('checkPrMerged')||!c.includes('merged-short-circuit'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] checkPrMerged 用 gh pr view --json state 且 fail-open
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes(\"'pr', 'view'\")||!c.includes(\"=== 'MERGED'\")||!c.includes('fail-open'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 短路回归测试文件存在
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-task-evaluator-merged-shortcircuit.test.js','utf8');if(!c.includes('checkPrMerged'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 短路回归测试覆盖：已 merge→PASS+不 spawn / 未 merge→照常 spawn / 幂等门优先不查状态（brain-unit CI --changed 实跑）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-task-evaluator-merged-shortcircuit.test.js','utf8');['verdict).toBe(\x27PASS\x27','not.toHaveBeenCalled','幂等门优先','toHaveBeenCalledOnce'].forEach(s=>{if(!c.includes(s))process.exit(1)});console.log('OK')"
