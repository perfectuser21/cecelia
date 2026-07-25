# Sprint PRD — One Session 编排门循环与 CI 合同闸 hotfix

## 目标

修复 PR #4336 暴露的三处机械门死锁，且不改 #4336 已批准合同或合同测试：

1. `test-pyramid-guard` / `ratchet-guard` 在 PR 阶段对当前 sprint 孤儿测试执行 `orphans=0`，与测试毕业固定在 merge 前的时序冲突。
2. `check-test-coverage.cjs` 只接受固定列序的 `Test Contract` 表，遇到已批准合同使用的 `功能 | BEHAVIOR 覆盖 | Test File | 预期红证据` 即误报“表为空”。
3. Harness v5 / DoD 动态命令链没有把真 PostgreSQL 所需 `DB_*`/`PG*` 环境完整透传到测试进程，导致 `role "root" does not exist` 与 `client password must be a string`。

## 非目标

- 不修改 PR #4336 的合同、DoD、sprint 测试或业务实现。
- 不提前毕业 sprint 测试，不抬高任何 baseline，不放宽合同覆盖语义。
- 不处理 review/merge 自动化。

## 锚定声明

- 锚定对象：PR #4336 `feat(kernel): durable resume across runs [f09c9e31]`，状态为 `OPEN`。
- 锚定症状：
  - `Test Contract 覆盖检查 (v5.0)` 报 `未找到 ## Test Contract 表或表为空`。
  - `Sprint Tests 实跑 (v5.0)` 日志出现 `FATAL: role "root" does not exist` 与 `client password must be a string`。
  - `测试金字塔守卫` / `棘轮统一台账守卫` 对 open PR 中尚未毕业的 sprint 测试执行 orphan=0。

## 验收

- 已批准合同使用列序 `功能 | BEHAVIOR 覆盖 | Test File | 预期红证据` 时，`check-test-coverage.cjs` 可正确识别 `Test File` 与 `BEHAVIOR 覆盖` 列并通过。
- CI 的 PR 场景中，`test-pyramid-guard` / `ratchet-guard` 忽略当前 PR 改动中的 sprint 目录；非 PR 或其他未改动 sprint 仍维持原有 orphan 闸。
- Harness v5 的 `Sprint Tests 实跑` 与 `ci.yml` 的 `dod-behavior-dynamic` 都把 `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` 与 `PGHOST/PGPORT/PGUSER/PGPASSWORD` 透传到子命令。

## NFR

NFR: N/A

journey_type: autonomous
target_environment: local_api
