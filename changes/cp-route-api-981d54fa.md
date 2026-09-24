## Brain {VERSION} — approved 合同冻结产物未落地时 derive 直接终局

- 修 run 60c1f156 热循环：合同已 approved 但冻结产物表零行（materialize 未落地）时，
  derive 在派 generator 前观测到 `contract.artifacts` 空数组即 `mark_failed`
  (`frozen_contract_artifacts_missing`)，不再照常派 generator → 装配层
  FROZEN_CONTRACT_ARTIFACTS_MISSING pre-attempt BLOCKED → 越过节点准入后 19 跳
  热循环烧到 deadline。
