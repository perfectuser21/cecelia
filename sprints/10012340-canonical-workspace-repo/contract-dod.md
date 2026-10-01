# 合同 DoD

- [x] [BEHAVIOR] native entry verifies canonical repository and legacy safeguards
  Test: manual:npx vitest run sprints/10012340-canonical-workspace-repo/tests/canonical-repo.test.mjs --maxWorkers=1 --minWorkers=1
- [x] [BEHAVIOR] facts/version/DoD真实一致，正式身份来自 e83 任务/run/controller。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs"
