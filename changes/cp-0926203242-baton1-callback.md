## Brain {VERSION} — 棒1 回执线：execution-callback 回执保 stage/metrics + internal token 鉴权（链 bf5088a3，决策 702949b6/280bd091）

- `POST /api/brain/execution-callback` 挂 `internalAuthOrLoopback`：`CECELIA_INTERNAL_TOKEN` 配置后严格验 `Authorization: Bearer <token>` / `x-internal-token`（缺/错 → 401 `UNAUTHORIZED`）；未配置只放行非 production 本机回环（否则 503 `INTERNAL_AUTH_NOT_CONFIGURED`）
- `recordRunFromCallback` 终态回执从 `result` 提炼 `{stage, stage_status, metrics, evidence, probes}`（只取存在的键；evidence/probes 只留引用形态：字符串或 `{ref|url|path|name|key|observed|probed_at|error}`，不落大 blob）经 `finishRun` 新增的 `result` 入参合进 `task_runs.result`；`exit_code`/`artifacts`/`pr_url` 逻辑原样
- 内部调用方补 Bearer（token 只从 env 读）：`cecelia-run.sh` / `flush-callback-queue.sh` 回执 curl、`executor.js` codex review fetch×2 + 本地 codex 回执 curl + docker 容器 env 透传 `CECELIA_INTERNAL_TOKEN`、`cecelia-bridge.js` 宿主 env 透传、`verify-billing-pause-e2e.js`
- 新增 smoke `callback-stage-receipt-smoke.sh`（假 pool 跑真逻辑 + 真 HTTP 打真中间件 + 接线查验）
- 未修（棒后续）：zenithjoy `brain-device-job-mirror.ts` psql 直写 tasks 绕过 task_runs 的漏
