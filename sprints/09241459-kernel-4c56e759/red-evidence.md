# Red 证据 — run 60c1f156 assembly_fault:FROZEN_CONTRACT_ARTIFACTS_MISSING 复现

实现前（derive 缺终局守卫）跑合同断言 + derive 单测：
total 200 / passed 198 / failed 2

复现该 bug 的新回归测试（实现前应红）：
- RED-FAIL: approved 但 contract.artifacts 为空数组 → MARK_FAILED，绝不 spawn:generator
- RED-FAIL: approved 合同但冻结产物表零行 → derive 派 generator 前直接终局，不进装配热循环（run 60c1f156）

根因：approved 合同冻结产物未落地（artifacts 空数组）时 deriveTask 仍派 fresh generator，
装配层抛 FROZEN_CONTRACT_ARTIFACTS_MISSING、pre-attempt BLOCKED 不置 generatorSpawned，
下一跳重派 → 越过节点准入后 19 跳热循环。修法：deriveTask 3a 在派 generator 前，
观测到 contract.artifacts 为空数组即 MARK_FAILED(frozen_contract_artifacts_missing)。
