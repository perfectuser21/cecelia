## Brain {VERSION} — drift-sentinel 补部署改 detached、超时只告警不杀进程；部署 Bark 告警在容器内真能推出去

任务 B5（根因单 e2fc7076 / d1ec834d 剩余项，同类孤儿 pending 第二来源）。

- `packages/brain/src/cron/drift-sentinel.js`：补部署由 `exec('bash scripts/brain-deploy.sh', { timeout: 300000 })` 改为 detached `spawn` 拉起 `REPO_ROOT/scripts/brain-deploy.sh`（与 POST /api/brain/deploy 同口径，输出落 `REPO_ROOT/logs/cecelia-drift-redeploy-*.log`），不设硬超时、不等部署结束。旧写法构建超过 5 分钟即 SIGTERM，brain-deploy.sh 在 begin 后被杀留孤儿 pending；旧写法还以 Brain 进程 cwd（容器内 /app）找相对路径脚本，路径本就不存在。运行超过 `DRIFT_DEPLOY_WARN_MS`（默认 20 分钟）只 raise P2 `drift_redeploy_slow`，非 0 退出 raise P2 `drift_redeploy_failed`；被杀/中断的台账 pending 由部署脚本 trap 或下一次 begin 的带外 reconcile（#6321）结算。
- `scripts/lib/url-encode.sh`（新）：纯 bash 百分号编码。Brain 镜像（alpine）没有 jq 也没有 python3，旧 `_url_encode` 原样返回中文+空格，send_bark / sidecar 告警 URL 被 curl 拒收，部署日志只剩"[bark] 推送失败(不阻塞)"。`bluegreen.sh` 与 `bluegreen-sidecar.sh` 改用同一编码器。
