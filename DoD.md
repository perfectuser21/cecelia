# DoD：清退旧Harness正文自证

- [x] [ARTIFACT] 删除九份显式正文自证与无现役调用者的旧changed-test-router，清理精确选择项和专属调用；中央Skill正文保持固定来源。
  Test: manual:bash -c 'git diff --check'
- [x] [BEHAVIOR] 实际Skill加载、版本与路径穿越拒绝、派发路由和退役无头入口拒绝继续执行。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/orchestrator/__tests__/skill-bundle.test.js src/lib/__tests__/dispatch-route.test.js src/__tests__/harness-orchestrator-lockdown.test.js src/__tests__/ci-defense.test.ts
- [x] [BEHAVIOR] 新selector与正文选择读取器仅作为精确完整组合接受；历史组合可回放，缺失/篡改/未知混配仍拒绝，16文件与500行边界保留。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js src/lib/__tests__/existing-ops-workspace-source.test.js
  Test: manual:node --test scripts/ci/__tests__/basic-auto-version-retirement.test.mjs scripts/ci/__tests__/basic-skill-source-coverage.test.mjs
- [x] [BEHAVIOR] 剩余固定来源Skill专项真实恢复并运行；scripts默认集合、修复selector定向及剩余检查通过，Nightly walking和W19入口不变。
  Test: manual:node scripts/ci/run-skill-source-check.mjs brain
  Test: manual:node scripts/ci/run-skill-source-check.mjs root
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node --test scripts/ci/__tests__/basic-legacy-test-retirement.test.mjs

## 第四批：去掉重复入口与接入回归

- [x] [BEHAVIOR] 所有权Python原有单测并入scripts真实job，并沿用Skill source ownership必需名称；扫描继续执行，独立重复workflow删除。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/basic-auto-version-retirement.test.mjs
- [x] [BEHAVIOR] 删除NodeOnboarding中普通CI已选中的unit/UI/Linux重复调用，保留独有采集凭据fixture，接入真实PG补足registry-adoption并保留Linux三份真实PG。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/node-onboarding/__tests__/service.test.js src/node-onboarding/__tests__/settlement.test.js src/node-onboarding/__tests__/service-completion-isolation.test.js src/node-onboarding/__tests__/registry-adoption.test.js
  Test: manual:npm exec --workspace cecelia-brain -- vitest run --config vitest.integration.config.js src/__tests__/integration/linux-controller-contract.pg.integration.test.js src/__tests__/integration/linux-onboarding-flow.pg.integration.test.js src/__tests__/integration/linux-script-authorization.pg.integration.test.js
- [x] [BEHAVIOR] 新runner仅以完整来源组认领，历史组及未知混配拒绝保留；原生16文件、500行边界与辅助来源无悬空。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js

## W19：历史输入未变时结束逐字校验

- [x] [BEHAVIOR] 实际GitHub PR/push事件的固定base未触playground时明确结束逐字校验；历史code/依赖/README角色变化仍拒绝，坏事件或非commit基线不得通过；本地与显式root仍执行完整原校验。
  Test: manual:node --test scripts/ci/__tests__/basic-w19-freeze.test.mjs
- [x] [BEHAVIOR] 新guard/test只以完整已审组认领，旧完整组回放及未知混配拒绝保持；不增加工作流、矩阵或移除既有scripts实际调用。
  Test: manual:node --test scripts/ci/__tests__/basic-auto-version-retirement.test.mjs
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js
