## Brain {VERSION} — 部署收账不再被「有意封停 tick」的 degraded 卡死

- `scripts/brain-image-retention/policy.mjs` 新增 `deployHealth`：`/health` 的 healthy 要求 tick 循环在跑，tick 被有意封停（决策 751f73be）后恒为 degraded，导致部署换容器成功、`ledger.finish` 却永远收不了账，台账 `pending` 卡死，其后全部部署以 `DEPLOYMENT_PENDING` 失败（2026-10-04 03:49 起 Gate 3 全红）。仅当 degraded 唯一原因是调度器被有意关闭（`scheduler.enabled=false`，断路器无 OPEN，docker/fleet 无异常）才折算为 healthy；缺字段/形状不明不折算。
- `runtime.mjs readHealth` 与 `docker.mjs containerHealth` 两条读取路径统一走 `deployHealth`；version/git_sha 原样返回，收账仍逐项核对部署身份。
- 回归：`scripts/brain-image-retention-health.test.mjs`（任务 a9adc667）。
