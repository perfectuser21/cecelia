## Brain {VERSION} — 部署收账有界重试 + 失败告警 + 陈旧 pending 核验补收账（修部署链 DEPLOYMENT_PENDING 卡死）

任务 502f2852。10-09 三次（15:02/16:11/19:51Z）sidecar 收账只试一次失败即退出、不留 stderr，台账 pending 不清，后续部署全部 DEPLOYMENT_PENDING，Gate 3 红约 7 小时。

- `scripts/lib/bluegreen-sidecar.sh`：`retention_finish` 改为有界重试（默认 5 次，退避 3/6/12/24s，总时长上限 180s，单次 CLI 60s 超时；`RETENTION_FINISH_ATTEMPTS`/`RETENTION_FINISH_DEADLINE_SECS` 可调），每次失败把 CLI 退出码与 stderr 写 `logs/cecelia-deploy-sidecar-failures.log`（`[completion-retry]`）；容器身份漂移不重试。最终仍失败写 `[completion-fail] ... attempts= exit= stderr=` 并 Bark 告警，pending 原样保留。
- `scripts/brain-image-retention`：新增 `ledger.reconcile()` 与 CLI `reconcile`。只当 pending 不在恢复中、begin 起已超过 15 分钟（无 `begun_at` 的旧 pending 视为陈旧），且 `finish(pending, success)` 自带核验通过（运行容器镜像/tag/git_sha 与 pending 目标一致且健康）才清 pending；核验不过抛错、不改状态。新 pending 记 `begun_at`。
- `scripts/lib/brain-image-retention.sh`：`retention_begin` 遇 `DEPLOYMENT_PENDING` 先跑 `cli reconcile`，通过才重试一次 begin；不通过保持失败、打印原因，并调用 `send_bark` 告警（fail-safe）。
