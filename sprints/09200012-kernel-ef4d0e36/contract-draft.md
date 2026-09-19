# Direct profile contract

Policy: direct-profile-contract-policy/v1
Objective: 2026-09-19 实证（run 0f36a253 hop 20/27）：us-mac-m4 worker 健康探测冷启动 2.4-6s（fleet-worker.cjs 注释自述 4-6s），node-admission-client 5s 超时 → machine_health signature=machine_offline → 派发 BLOCKED 进 infrastructure backoff，1-2 分钟后自愈；每轮 attempt 都可能白等。修法二选一并加测试：(a) worker /health 在探测进行中先返回上一份缓存报告（带 observed_at）而不是阻塞到探测完；(b) admission client（packages/brain/src/orchestrator/fleet-node/node-admission-client.js）超时上调到 ≥10s 并对 probe 超时与真离线分类区分。（r1/r2 base_sha 被 auto-version 顶掉、r3 归位 execution_pool 无断言 impact_assertion_missing；本条归位 F1，同时作为 bugfix 快车道修复 #5429 的实弹验证）

## Active impact contract
```json
{
  "affected_capabilities": [
    {
      "capability_id": "F1",
      "capability_name": "开发闭环",
      "impact_level": "direct"
    }
  ],
  "base_revision": "5102860a5f7b40303e77e3d2ab2d824f27e89a7e",
  "change_kind": "bugfix",
  "fact_revisions": {
    "cecelia": "5102860a5f7b40303e77e3d2ab2d824f27e89a7e"
  },
  "freshness_evidence": {
    "checked_at": "2026-09-19T16:12:15.652Z",
    "mapper_revision": "5102860a5f7b40303e77e3d2ab2d824f27e89a7e",
    "reason_code": "snapshots_fresh",
    "status": "fresh"
  },
  "inapplicable_items": [],
  "manifest_digest": "9f7439561bcd3ccb8dc7c4a6383bda1d857551a945a6d38a4725913c043f1258",
  "metadata": {
    "map_scope": [
      "F1"
    ],
    "scope_key": "cecelia"
  },
  "projection_digest": "30bea37abd8a7fa67bfd3ccfc2bd0c23abb1a8dfaa293b332a3f1975821eb1ad",
  "repo": "cecelia",
  "required_assertions": [
    {
      "assertion_digest": "366b4d8735dae1ee8aab81856aec83b66dc86bd5b2dc2a28cfeab1aa0eca771d",
      "assertion_id": "packages/brain/src/orchestrator/__tests__/ground-truth.test.js",
      "assertion_revision": 3,
      "command": "npx vitest run packages/brain/src/orchestrator/__tests__/ground-truth.test.js",
      "covers_capability_ids": [
        "F1"
      ],
      "journey_step_link_id": "c99aaaae-0eb3-4fce-980f-0a8a3ab6569a",
      "source_bindings": [
        {
          "assertion_digest": "366b4d8735dae1ee8aab81856aec83b66dc86bd5b2dc2a28cfeab1aa0eca771d",
          "assertion_revision": 3,
          "journey_step_link_id": "c99aaaae-0eb3-4fce-980f-0a8a3ab6569a"
        }
      ]
    }
  ],
  "schema_version": 1,
  "task_id": "ef4d0e36-765a-4850-bfeb-701ff0b022f8"
}
```