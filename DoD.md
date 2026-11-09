# DoD：清退旧CI并统一PR入口

- [x] [ARTIFACT] 删除九份显式正文自证与无现役调用者的旧changed-test-router，清理精确选择项和专属调用；中央Skill正文保持固定来源。
  Test: manual:bash -c 'git diff --check'
- [x] [BEHAVIOR] 实际Skill加载、版本与路径穿越拒绝、派发路由和退役无头入口拒绝继续执行。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/orchestrator/__tests__/skill-bundle.test.js src/lib/__tests__/dispatch-route.test.js src/__tests__/harness-orchestrator-lockdown.test.js src/__tests__/ci-defense.test.ts
- [x] [BEHAVIOR] 新selector与正文选择读取器仅作为精确完整组合接受；历史组合可回放，缺失/篡改/未知混配仍拒绝，16文件与500行边界保留。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js src/lib/__tests__/existing-ops-workspace-source.test.js
  Test: manual:node --test scripts/ci/__tests__/basic-auto-version-retirement.test.mjs scripts/ci/__tests__/basic-skill-source-coverage.test.mjs
- [x] [BEHAVIOR] 剩余固定来源Skill专项真实恢复并运行；scripts默认集合、修复selector定向及剩余检查继续执行。固定历史W19输入未变时按真实事件差分结束逐字校验。
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


## 最终统一CI与真实运行保障

- [x] [BEHAVIOR] PR质量检查统一到ci.yml；旧专项与Preview wrapper删除，原Node版本、PG服务、命令、artifact、固定Skill三OS恢复及身份保持。所有质量父job严格汇总，fail/cancel/skip/missing/extra均拒绝；现有三个required名称仍对应真实执行。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/basic-results.test.mjs scripts/ci/__tests__/basic-skill-source-coverage.test.mjs scripts/ci/__tests__/basic-resource-canary.test.mjs scripts/ci/__tests__/basic-pwa-ci-budget.test.mjs
- [x] [BEHAVIOR] 真实工作流扫描仅准ci.yml接PR/PR-target，job不得复用其他workflow；CodeQL三语言保留默认查询、远端威胁模型和weekly扫描，schedule只执行CodeQL；closed只执行独立Preview cleanup，隔离并发域。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs
- [x] [BEHAVIOR] Preview仍只在真实UI/API差分下部署，full质量选择不扩大发布；本地composite保留原HTTP、身份、磁盘与清理行为。
  Test: manual:node --test scripts/ci/__tests__/basic-scope.test.mjs scripts/ci/__tests__/basic-preview-deploy.test.mjs scripts/ci/__tests__/basic-preview-cleanup.test.mjs
  Test: manual:bash scripts/__tests__/preview-deploy-harness-gate.test.sh
- [x] [BEHAVIOR] 新统一Skill jobs仅凭完整精确来源组合认领，旧完整历史组保留；旧新混配、缺失、篡改拒绝。原生reader仍16文件、单模块500行内，悬空关系清理。
  Test: manual:node --test scripts/ci/__tests__/basic-auto-version-retirement.test.mjs scripts/ci/__tests__/factory-workflow-config-source.test.mjs
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js src/lib/__tests__/existing-ops-workspace-source.test.js src/lib/__tests__/existing-ops-w19-freeze-cohort.test.js
- [x] [BEHAVIOR] 退役walking样机后，真实consciousness消费者验证PG跨进程读取、fresh graph恢复且无重放；唯一UUID thread隔离并精确清理三张checkpoint表，本地仅cecelia_scratch可执行，坏地址/query/远端拒绝保留。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run --config vitest.integration.config.js src/__tests__/integration/consciousness-checkpoint.pg.integration.test.js
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/workflows/__tests__/consciousness.graph.test.js src/orchestrator/__tests__/pg-checkpointer.test.js

- [x] [ARTIFACT] 无当前HEAD调用者的implementation-impact入口及专属壳自证清退；ZJ仍使用095d816固定历史接口，真实CLI、HTTP、ZIP与来源拒绝测试继续执行，必要配置回放固定已合并aa217。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/basic-impact-explicit-call.test.mjs scripts/ci/__tests__/implementation-main-snapshot.test.mjs scripts/ci/__tests__/implementation-infra-artifact.test.mjs scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/lib/__tests__/implementation-ci-workflow.test.js
