# Red 证据 — Diff Impact Gate reason_code 透传（r19/r28）

对 unmodified packages/brain/src/impact-contract/diff-gate.js 跑合同回归测试：

```
sprints/08201318-kernel-b7aecbef/tests/diff-gate-mapper-stale-reason-code.test.js
Test Files 1 failed
Tests  4 failed | 0 passed (4)
```

全部 4 条 B-01/B-02/B-03/B-04 均 FAIL —— 现行步骤 3a 把所有非 fresh 折叠成裸 mapper_stale+retryable:true，未透传 reason_code。符合 TDD Red 预期。
