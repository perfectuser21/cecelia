# DoD — rescan测试远端夹具（79ed8593）

- [ ] [BEHAVIOR] boundary 固定测试ls-remote、真实转发其他git，稳定推进时12case全执行、无离线跳过；产品脚本不变。
  Test: manual:node --test scripts/__tests__/rescan-fixture-isolation.test.mjs
- [ ] [BEHAVIOR] native 原生入口执行永久边界回归，非零或skip不能通过。
  Test: manual:npx vitest run sprints/10020146-rescan-remote-fixture/tests/rescan-remote-fixture.test.mjs --maxWorkers=1 --minWorkers=1
- [ ] [BEHAVIOR] gates 事实、版本、DoD与TestContract通过。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && node packages/engine/scripts/devgate/check-test-coverage.cjs sprints/10020146-rescan-remote-fixture/contract-draft.md"
