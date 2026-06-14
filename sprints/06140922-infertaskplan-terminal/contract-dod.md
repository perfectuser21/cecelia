---
skeleton: false
journey_type: autonomous
---
# Contract DoD — inferTaskPlan 坏产物改 terminal 失败，止住无限 fresh-start

**范围**: 仅改 packages/brain/src/workflows/harness-initiative.graph.js 的 inferTaskPlanNode（不可恢复失败标 task failed + 返回 error.terminal=true）+ 新增 regression test。不改 watchdog / dbUpsert / GAN graph。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] inferTaskPlanNode 含 failTerminal（标 status='failed' + error.terminal）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('failTerminal'))process.exit(1);if(!/status='failed'[\s\S]*infer_task_plan|infer_task_plan[\s\S]*status='failed'/.test(c))process.exit(1)"

- [x] [ARTIFACT] regression 测试文件存在
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-infertaskplan-terminal.test.js','utf8');if(!c.includes('terminal')||!/describe|it\(/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous — 真实 node 进程/退出码）

- [x] [BEHAVIOR] inferTaskPlanNode 空 tasks / 解析失败 / 无 propose_branch → 返回 error.terminal=true 且标 task status='failed'（不再非终态无限 fresh-start）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!/tasks\.length === 0|plan\.tasks\)\s*\|\|\s*plan\.tasks\.length === 0/.test(c))process.exit(1);if(!/error:\s*\{[^}]*terminal:\s*true/.test(c))process.exit(1)"
  期望: exit 0（空 tasks 判定 + terminal:true error 同时存在）

- [x] [BEHAVIOR] git-show/网络 I/O 失败保持非终态（不误杀瞬时失败）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/git show origin[\s\S]{0,200}/);if(!m||/terminal:\s*true/.test(m[0]))process.exit(1)"
  期望: exit 0（git show 失败分支不带 terminal:true，保持可重试）

- [x] [BEHAVIOR] regression 测试覆盖「空 tasks→terminal+failed」「正常 tasks 不标 failed」行为（brain-ci 跑 vitest 验证）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-infertaskplan-terminal.test.js','utf8');if(!c.includes(\"status='failed'\")||!c.includes('terminal')||!c.includes('不标 failed'))process.exit(1)"
  期望: exit 0（测试含 terminal+failed 正反向断言）
