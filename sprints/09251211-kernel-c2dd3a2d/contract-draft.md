# Direct profile contract

Policy: direct-profile-contract-policy/v1
Objective: 实证 2026-09-25：us-vps curl http://100.71.151.105:5231/health 首发 6.65s，其后 0.11s（缓存 30s，DEFAULT_HEALTH_CACHE_TTL_MS）；Brain fleet-cache 日志在 1/3 与 2/3 在线之间抖；bug 任务 b85faf28 的 run d6acfb0d reviewer 一跳 capability preflight probe_detail machine_health.signature=machine_offline / machine_capacity.available=0 → all_execution_targets_exhausted → infrastructure backoff。fleet-worker.cjs 注释已自认：完整探测（git worktree + docker）单发 4-6s 超过 admission client 5s。修法二选一先做便宜的：①健康探测改后台定时刷新（永远回缓存，附 observed_at），准入读取零等待；②准入客户端超时 5s→15s 并对首发失败重试一次。验收：连续 30 分钟 fleet-cache 无 1/3 抖动；capability preflight 无 machine_offline 假阳性。先写复现测试。

## Active impact contract
```json
{
  "affected_capabilities": [
    {
      "capability_id": "G1",
      "capability_name": "指挥舱",
      "impact_level": "direct"
    }
  ],
  "base_revision": "ce587e5699b0d507d2fea4f815d69b5ecad81a0a",
  "change_kind": "bugfix",
  "fact_revisions": {
    "cecelia": "ce587e5699b0d507d2fea4f815d69b5ecad81a0a"
  },
  "freshness_evidence": {
    "checked_at": "2026-09-25T04:28:37.801Z",
    "mapper_revision": "ce587e5699b0d507d2fea4f815d69b5ecad81a0a",
    "reason_code": "snapshots_fresh",
    "status": "fresh"
  },
  "inapplicable_items": [],
  "manifest_digest": "9f7439561bcd3ccb8dc7c4a6383bda1d857551a945a6d38a4725913c043f1258",
  "metadata": {
    "map_scope": [
      "G1"
    ],
    "scope_key": "cecelia"
  },
  "projection_digest": "ff41b1b677ff2fb218550b21a61bd96b3573b0d668c5e940096227cdee30fa38",
  "repo": "cecelia",
  "required_assertions": [
    {
      "assertion_digest": "ae34f3dc0a40ba90a2bae65f4ac573c73db2b9863bb9fbee3248daa869e13779",
      "assertion_id": "apps/dashboard/src/pages/map/MapPage.test.tsx",
      "assertion_revision": 2,
      "command": "npx vitest run apps/dashboard/src/pages/map/MapPage.test.tsx",
      "covers_capability_ids": [
        "G1"
      ],
      "journey_step_link_id": "1731f1d9-84b7-4f46-a60e-8a8fdd369390",
      "source_bindings": [
        {
          "assertion_digest": "ae34f3dc0a40ba90a2bae65f4ac573c73db2b9863bb9fbee3248daa869e13779",
          "assertion_revision": 2,
          "journey_step_link_id": "1731f1d9-84b7-4f46-a60e-8a8fdd369390"
        }
      ]
    }
  ],
  "schema_version": 1,
  "task_id": "c2dd3a2d-c12e-4ccc-92fc-89695b447eb1"
}
```