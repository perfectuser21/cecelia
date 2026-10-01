# DoD — Commander 公开授权说明分类

- [ ] [BEHAVIOR] narrative 真实任务授权说明在默认与显式 hybrid profile 中均可解析，原 payload 保持；凭据说明、对象、超长说明及其他秘密键拒绝。
  Test: manual:bash -c "cd packages/brain && DB_NAME=cecelia_scratch npx vitest run src/orchestrator/__tests__/commander-profile.test.js src/orchestrator/__tests__/commander-contract.test.js src/orchestrator/__tests__/commander-bundle.test.js src/orchestrator/__tests__/commander-store.test.js --maxWorkers=1 --minWorkers=1"
- [ ] [BEHAVIOR] native 原生 Sprint 入口运行永久 profile 与安全套件，进程非零或无测试拒绝。
  Test: manual:bash -c "DB_NAME=cecelia_scratch npx vitest run sprints/10012235-commander-authorization/tests/commander-authorization.test.mjs --maxWorkers=1 --minWorkers=1"
- [ ] [BEHAVIOR] gates 事实、Brain 六面版本、DoD 映射和 Test Contract 通过。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && node packages/engine/scripts/devgate/check-test-coverage.cjs sprints/10012235-commander-authorization/contract-draft.md"
