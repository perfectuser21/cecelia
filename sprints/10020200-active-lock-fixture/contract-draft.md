# 冻结合同：b9ce7deb 活跃锁测试边界

范围仅 tests/integration/startup-recovery-active-lock.test.js 与对应 Sprint 永久入口、DoD。仅 Docker ps 边界可控；Git 和真实文件系统不模拟。生产 packages/brain/src/startup-recovery.js 必须与基线 40a52856e609f8a4085ca2f3b3991fd524e48f1f 逐字节相同。

## Test Contract

| Workstream | Test File | BEHAVIOR | Red |
|---|---|---|---|
| 探活隔离真实验收 | `sprints/10020200-active-lock-fixture/tests/docker-boundary.test.mjs` | `active-lock fixture isolates Docker failure and preserves real filesystem checks` | 30546d01df；真实故障注入导致旧套件 1 红 8 绿，目录仍保留 |

## E2E 验收

```bash
set -euo pipefail
npx vitest run sprints/10020200-active-lock-fixture/tests/docker-boundary.test.mjs --maxWorkers=1 --minWorkers=1
cd packages/brain
TZ=UTC DB_NAME=cecelia_scratch DB=cecelia_scratch npx vitest run ../../tests/integration/startup-recovery-active-lock.test.js --maxWorkers=1 --minWorkers=1
```

真实验收为十条文件系统回归全部通过；Docker 未知时目录保留且 removed=0。正式 Controller、合同封存、Evaluator/Judge 与当前 SHA CI 均须完整通过，不能借旧失败身份或旧审批。
