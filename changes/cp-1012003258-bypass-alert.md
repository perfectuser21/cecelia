## Brain {VERSION} — 旁路报警：动手机/对外推送无 Brain 任务号即告警（派发总闸 H，任务 865b502c）

- 新 `bypass-audit.js`：关联判定一律在 Brain 侧（tasks.id / payload.run_id / qiumi|wfd-<任务号前8位> 前缀），追不到才写 `cecelia_events(event_type='bypass_action', source=phone_lock|phone_outward|openclaw_push)`，dedupe_key 2 天内去重；先只告警不拦截
- `POST /api/brain/device-locks/acquire` 抢锁成功后异步交旁路审计（body 可带 task_id/run_id/host 留痕）：执行机 crontab 经 brain-lock.sh 领锁、持有者非 Brain 任务 → 记 phone_lock
- 新路由 `POST /api/brain/bypass-actions/report`（执行机控制器上报手机对外动作/本地领锁）与 `GET /api/brain/bypass-actions/summary`（运维视图：近 N 天按日×类别+最近 20 条）
- 新 scheduler job `bypass-audit`（自 gate 5 分钟）：ssh mmv 只读扫 OpenClaw 审计库 message 调用（Brain 派发会话 agent:<dept>:<run_id> 不记、主会话与主理人对话不记）；按上海日汇总 runs `bypass-audit:<日期>`（有旁路 outcome=fail → 现有「最近执行」投影可见）；手机对外动作 ≥1 / OpenClaw 推送 ≥5 才 Bark（`BYPASS_BARK_PHONE_OUTWARD` / `BYPASS_BARK_OPENCLAW_PUSH` 可调），领锁类不推主理人（决策 d3e7746c）
- smoke `bypass-audit-smoke` 登记 allowlist / write-targets
