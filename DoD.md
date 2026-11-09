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
