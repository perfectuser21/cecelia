# TDD Red 证据 — sprint 08201044-kernel-425c5279

frozen test: sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts
命令: npx vitest run sprints/08201044-kernel-425c5279/tests/
结果: total 5 / passed 1 / failed 4（4 红符合预期，唯一绿=stale 无码瞬态兜底巧合命中）

```
 × sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > 确定性 unknown 返回 retryable false 且透传具体 reason_code 非 mapper_stale
 × sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > 瞬态 stale 返回 retryable true 且透传具体 reason_code
 × sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > unknown 缺 reason_code 用确定性兜底码 mapper_unknown 且 retryable false
 × sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > freshness 缺失维持 fail-closed retryable false 绝不 mapper_stale 绝不 pass
 ✓ sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > stale 缺 reason_code 用瞬态兜底码 mapper_stale 且 retryable true
 FAIL  sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > 确定性 unknown 返回 retryable false 且透传具体 reason_code 非 mapper_stale
 FAIL  sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > 瞬态 stale 返回 retryable true 且透传具体 reason_code
 FAIL  sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > unknown 缺 reason_code 用确定性兜底码 mapper_unknown 且 retryable false
 FAIL  sprints/08201044-kernel-425c5279/tests/diff-gate-reason-passthrough.test.ts > Diff Impact Gate 非 fresh 分支 [BEHAVIOR] > freshness 缺失维持 fail-closed retryable false 绝不 mapper_stale 绝不 pass
 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
```
