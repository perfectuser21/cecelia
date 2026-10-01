# kernel run 越过准入后 19 跳死于 assembly_fault:FROZEN_CONTRACT_ARTIFACTS_MISSING（run 60c1f156）

## Objective
2026-09-24 13:06 run 60c1f156（任务 3f7a3e71，接替 c74ca12f）在 MMV 越过节点准入，commander/planner 共 6 次 attempt LAUNCHED（hop 1/6/11/13/19/24），13:17 exit assembly_fault FROZEN_CONTRACT_ARTIFACTS_MISSING（hops=19）。这是准入之后的下一道闸：合同冻结产物未落地就进入装配。需看 kernel 日志 /var/lib/cecelia/fleet-worker/state/orchestrator-logs/kernel-60c1f156-*.log 与 materialize-frozen-contract-artifacts.cjs，先写能复现的 failing test。

## Frozen authority
- execution_profile: hotfix-v1
- routing_receipt_id: e3230ac8-af1d-4812-b2f0-134aa5248fb1
- impact_contract_id: 950482f0-975f-47ff-8548-0ca289101c62
- input_base_sha: b4ee97ccc89c2f8ff5335ea975fd3acb6b78dd09