## Brain {VERSION} — bugfix 快车道修通：直配合同产物根目录改用任务 sprint_dir

- 2026-09-19 run 35c352b3 实证：hotfix-v1 直配合同把四份产物落在 `direct-contracts/<receipt>/`（含 `tests/impact-contract.md`），而 runner `materialize-frozen-contract-artifacts` 只认 `${sprint_dir}/tests/`、`${sprint_dir}/` 前缀 → `invalid frozen test descriptor` → generator 每次启动即 `frozen_contract_artifacts_invalid` 循环烧额度，bugfix 类任务在 kernel 里从未跑通。
- 修：`direct-profile-contract.js` 产物根目录优先任务 `payload.sprint_dir`（校验绝对路径/`..`/反斜杠/空段，非法回退 `direct-contracts/<receipt>`）；task 查询只多取 `payload->>'sprint_dir'`，description/thin_prd 仍不入合同。
