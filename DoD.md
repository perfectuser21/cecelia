contract_branch: cp-route-api-981d54fa
sprint_dir: sprints/09241459-kernel-4c56e759

# Definition of Done

## packages/brain/src/orchestrator/__tests__/ground-truth.test.js
- command: npx vitest run packages/brain/src/orchestrator/__tests__/ground-truth.test.js
- covers: F1

## BEHAVIOR

- [x] [BEHAVIOR] approved 合同但冻结产物零行时 derive 直接终局，不进装配热循环（run 60c1f156）
  Test: manual:bash -c 'grep -q "frozen_contract_artifacts_missing" packages/brain/src/orchestrator/derive.js'
  期望: exit 0（derive.js 含 approved+空 artifacts → mark_failed 终局守卫）
