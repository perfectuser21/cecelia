# DoD — fix(brain): executor.js verdict 传递修复（W20 Bug 3）

## ARTIFACT 条目

- [x] [ARTIFACT] executor.js 含 computeHarnessInitiativeOk export
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('export function computeHarnessInitiativeOk'))process.exit(1)"`

- [x] [ARTIFACT] executor.js 含 computeHarnessInitiativeError export
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('export function computeHarnessInitiativeError'))process.exit(1)"`

- [x] [ARTIFACT] executor.js line 2894 区域用 computeHarnessInitiativeOk(final) 替代 !final?.error
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('ok: computeHarnessInitiativeOk(final)'))process.exit(1)"`

- [x] [ARTIFACT] harness-initiative.graph.js reportNode 含 FAIL 防御日志
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('Bug 3 防御性日志'))process.exit(1)"`

- [x] [ARTIFACT] 单元测试文件存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/executor-harness-initiative-ok.test.js')"`

- [x] [ARTIFACT] Learning 文件存在含必备段
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0510204528-brain-executor-final-evaluate-verdict-fix.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] computeHarnessInitiativeOk({final_e2e_verdict:'FAIL'}) === false（Bug 3 regression）
  Test: tests/executor-harness-initiative-ok.test.js
  期望: 18 passed (含 'final_e2e_verdict=FAIL → ok=false (Bug 3 regression)')

- [x] [BEHAVIOR] computeHarnessInitiativeError 在 FAIL verdict 时返含 failed_scenarios names 的 message
  Test: tests/executor-harness-initiative-ok.test.js

## 成功标准（runtime acceptance — PR 合并后由 W21 验）

- [ ] PR 创建 + CI 全绿（无 admin merge）
- [ ] PR merged 到 main
- [ ] 派 W21 严 schema /multiply：generator 漂移 → final_evaluate FAIL → task.status='failed'

## 不做

- 不改 finalEvaluateDispatchNode 设 error
- 不改 sub-task evaluate 路由
- 不动 PR A skill 修订（已合 #2879）
