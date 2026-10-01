# Contract：根 Sprint 正式登记

范围 scripts/lib/test-contract-paths.cjs 与既有永久 scripts/__tests__/test-pyramid-guard.test.sh；既有三模板与.dod同步，冻结原生入口委托同一永久套件。子Sprint及archive守卫保留，根只拥有sprints/tests，不借根合同吸收子目录测试。

## Test Contract

| Workstream | Test File | BEHAVIOR | Red |
|---|---|---|---|
| 根登记真验收 | `sprints/tests/root-contract.test.mjs` | `根合同登记通过且子Sprint孤儿仍被真实守卫拒绝` | d27e16cacb 9通过2失败 |
| 永久金字塔回归 | `scripts/__tests__/test-pyramid-guard.test.sh` | root_contract | 永久红日志 /tmp/cecelia-root-contract-red.log |

## E2E 验收

```bash
set -euo pipefail
bash scripts/__tests__/test-pyramid-guard.test.sh
bash scripts/__tests__/ratchet-guard.test.sh
```

真守卫在隔离fixture读取真实合同/测试文件，根测试不再误判孤儿；子Sprint缺自身合同仍实际退出失败。原生evaluator/Judge必须按实际head执行，不把独审当裁决。
