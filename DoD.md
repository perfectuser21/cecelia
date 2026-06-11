contract_branch: cp-06120358-ws-52441a6e-ws1
sprint_dir: sprints/06120010-e2e-exec-judge-r2

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: evaluate 职责分离（代码执行 E2E + 轻量 LLM 裁读）

**范围**: `evaluateContractNode` 节点重构 — 代码层执行 BEHAVIOR 命令 + 结构化执行记录落盘 + LLM 裁读记录 + Brain 代码覆盖校验
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `harness-final-e2e.js` 导出三个新函数（executeContractCommands / validateCoverageTable / isLegacyMode）
  Test: node -e "const src=require('fs').readFileSync('packages/brain/src/harness-final-e2e.js','utf8');if(!src.includes('executeContractCommands'))process.exit(1);if(!src.includes('validateCoverageTable'))process.exit(1);if(!src.includes('isLegacyMode'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `harness-initiative-evaluate-exec-judge.test.js` 回归测试文件存在且含覆盖校验用例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-initiative-evaluate-exec-judge.test.js','utf8');if(!c.includes('executeContractCommands'))process.exit(1);if(!c.includes('validateCoverageTable'))process.exit(1);if(!c.includes('EVALUATOR_LEGACY'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

（详见 sprints/06120010-e2e-exec-judge-r2/contract-dod.md）
