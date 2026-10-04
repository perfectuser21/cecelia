## Brain {VERSION} — 蓝绿 sidecar 健康确认折算「有意封停 tick」的 degraded

- `scripts/lib/bluegreen-sidecar.sh` 的 `_sidecar_health` 内联 node 也硬要求 `/health` 为 healthy：tick 被有意封停（决策 751f73be）后恒为 degraded，新容器已起来，sidecar 却在「等 healthz」一步判 `healthz_poll_timeout_or_identity_mismatch` 退出——drain 不恢复、台账不收账（#5947 只修了官方收账 CLI 这一处，2026-10-04 部署 1.371.1 时暴露第二处）。
- 改为复用 `policy.deployHealth`（路径可由 `CECELIA_RETENTION_POLICY` 覆盖，默认 `/app/scripts/brain-image-retention/policy.mjs`）；导入失败 = 严格口径；version/git_sha/tags 逐项核对不变。
- 回归：`scripts/bluegreen-sidecar-completion.test.mjs` 新增 `sealed-degraded`（成功收尾）与 `sealed-open-breaker`（仍非零保持 pending）两个场景（任务 a9adc667）。
