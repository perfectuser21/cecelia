# fleet-worker 冷探测 4-6s 超过 kernel 准入客户端 5s 超时→瞬时 machine_offline（r4）

## Objective
2026-09-19 实证（run 0f36a253 hop 20/27）：us-mac-m4 worker 健康探测冷启动 2.4-6s（fleet-worker.cjs 注释自述 4-6s），node-admission-client 5s 超时 → machine_health signature=machine_offline → 派发 BLOCKED 进 infrastructure backoff，1-2 分钟后自愈；每轮 attempt 都可能白等。修法二选一并加测试：(a) worker /health 在探测进行中先返回上一份缓存报告（带 observed_at）而不是阻塞到探测完；(b) admission client（packages/brain/src/orchestrator/fleet-node/node-admission-client.js）超时上调到 ≥10s 并对 probe 超时与真离线分类区分。（r1/r2 base_sha 被 auto-version 顶掉、r3 归位 execution_pool 无断言 impact_assertion_missing；本条归位 F1，同时作为 bugfix 快车道修复 #5429 的实弹验证）

## Frozen authority
- execution_profile: hotfix-v1
- routing_receipt_id: 5f159048-e463-4c03-90a6-f3ea32adbedd
- impact_contract_id: 19804db8-e971-4bae-9300-1577996a7a9f
- input_base_sha: 5102860a5f7b40303e77e3d2ab2d824f27e89a7e