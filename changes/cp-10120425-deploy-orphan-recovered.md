## Brain {VERSION} — 部署台账孤儿 pending 带外结算为 recovered（修部署进程被 SIGKILL 后 DEPLOYMENT_PENDING 永久卡死）

任务 B3（根因单 e2fc7076 / d1ec834d，事故 a80485b3）。部署进程跑在它要替换的 Brain 容器里，容器重启时被 SIGKILL，`trap EXIT` 不执行，pending 留在 ledger；原 reconcile 只会结算 success，容器仍是旧镜像时必然核验失败，之后每次部署都撞 DEPLOYMENT_PENDING。

- `scripts/brain-image-retention/ledger.mjs`：`reconcile()` 按运行容器镜像分流——已是 pending 目标 → `success`；仍是 previous（镜像 id + git_sha 一致）→ `recovered`（只清 pending、不写成功史）；其余抛 `DEPLOYMENT_RECONCILE_UNKNOWN` 不改状态。新鲜期（15 分钟）与恢复中拒绝不变。
- 同文件 `finish(recovered)`：版本 tag 核验改用 begin 时记下的 previous 快照 tags（身份仍由镜像 id + git_sha + 健康确定），同版本号重建把 tag 抢走后也能结算（a80485b3 当时只能人工挪 tag）。
- `scripts/lib/brain-image-retention.sh`：自动补收账接受 `<id> recovered`，日志注明“上次部署中途死亡，容器仍为旧版”。
- `scripts/lib/internal-auth-token.sh`：先 `stat -c`（GNU）再 `stat -f`（BSD），GNU 下不再每次误判权限去 chmod；文件只读时跳过 chmod 并提示。
