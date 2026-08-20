# Red 证据 — Diff Impact Gate 确定性结论 fail-closed 有界出口

当前实现（diff-gate.js step 3a 一律折叠 mapper_stale + retryable:true）下，
直调真实 evaluateDiffGate，四类非 fresh 输入全部错误折叠：

| 输入 freshness | 期望（合同） | 当前实现（Red） |
|---|---|---|
| status=stale, reason_code=revision_mismatch | reason=revision_mismatch, retryable=false | reason=mapper_stale, retryable=true ❌ |
| status=unknown, reason_code=fail_current_revision | reason=fail_current_revision, retryable=false | reason=mapper_stale, retryable=true ❌ |
| status=stale, reason_code=fact_snapshot_stale | reason=mapper_stale, retryable=true | reason=mapper_stale, retryable=true ✅（回归绿，防误伤）|
| status=stale, reason_code=null | retryable=false, reason≠mapper_stale | reason=mapper_stale, retryable=true ❌ |

确定性 reason_code 被折叠成 retryable 的 mapper_stale → deny:impact:mapper_stale 无限重试空转（runs f62c7e87/d1360a48 复现）。
本 sprint 修 step 3a：确定性透传 reason_code + retryable:false，真·瞬态白名单保留 mapper_stale + retryable:true。
