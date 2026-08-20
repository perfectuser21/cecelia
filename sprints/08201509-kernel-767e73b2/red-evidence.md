# Red 证据 — Diff Impact Gate 步骤 3a

## 合同测试（sprints/.../tests/diff-gate-reason-code.test.js）
实测：`Tests 3 failed | 1 passed (4)` — 符合合同预期红证据。

- FAIL 确定性终态 unknown → retryable:false 透传 reason_code（现状 reason_code undefined）
- FAIL 瞬态 stale → reason_code=fact_snapshot_stale（现状 undefined）
- FAIL reason_code 缺失兜底 → retryable:false（现状 3a 一律 retryable:true）
- PASS revision_mismatch 出口语义不回退（3b 回归护栏，未改动）

现状 diff-gate.js 步骤 3a 对任何 freshness.status !== 'fresh' 一律返回
`{ reason:'mapper_stale', retryable:true }`，丢弃 reason_code 且对确定性终态误标可重试。
