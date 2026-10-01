# Direct profile contract

Policy: direct-profile-contract-policy/v1
Objective: 2026-09-24 13:06 run 60c1f156（任务 3f7a3e71，接替 c74ca12f）在 MMV 越过节点准入，commander/planner 共 6 次 attempt LAUNCHED（hop 1/6/11/13/19/24），13:17 exit assembly_fault FROZEN_CONTRACT_ARTIFACTS_MISSING（hops=19）。这是准入之后的下一道闸：合同冻结产物未落地就进入装配。需看 kernel 日志 /var/lib/cecelia/fleet-worker/state/orchestrator-logs/kernel-60c1f156-*.log 与 materialize-frozen-contract-artifacts.cjs，先写能复现的 failing test。

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
  "base_revision": "b4ee97ccc89c2f8ff5335ea975fd3acb6b78dd09",
  "change_kind": "bugfix",
  "fact_revisions": {
    "cecelia": "b4ee97ccc89c2f8ff5335ea975fd3acb6b78dd09"
  },
  "freshness_evidence": {
    "checked_at": "2026-09-24T06:59:10.859Z",
    "mapper_revision": "b4ee97ccc89c2f8ff5335ea975fd3acb6b78dd09",
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
  "projection_digest": "e5949c4cfa7dd1486a65ca51bddb297d5bf976c2868e72c18b17a39fbf5a3912",
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
  "task_id": "4c56e759-5518-495e-bc35-59250e31b47a"
}
```