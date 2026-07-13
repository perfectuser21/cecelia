# Learning: strategist 容器执行零落库 + completed↔queued 振荡（issue 219a9efc）

## 症状
strategist_decision 任务派进 docker relay 容器，284s exit 0，callback success→completed，但 result 空、零 DB 侧写；随后 4 分钟内被打回 queued 形成振荡循环。

### 根本原因
两个独立 bug 叠加：

1. **容器零落库**：executor.js docker 分支给容器注入 `CECELIA_CORE_API/WEBHOOK_URL=http://localhost:5221`（`BRAIN_URL` 未设置时的兜底），而任务容器是 bridge 网络——容器内 localhost 是容器自己，实测 curl 000 完全不通。叠加 line-strategist 等 SKILL.md 硬编码 13 处 `localhost:5221`，全部 `curl -s` 静默失败、skill 照常走完。callback 由宿主侧 writeDockerCallback 写队列所以"成功"——完美伪装成任务正常完成。
2. **振荡打回**：callback 把任务标 completed 但没人关闭 run_events 行（仍 status='running'），monitor-loop 的 detectStuckRuns 只查 run_events + 心跳过期、从不看 tasks.status → handleStuckRun 把 completed 任务当 1st-stuck RESTART 打回 queued（`_ghost_audit` 记录4 与 run 1181b7f7 的 ts_end/reason_code=MONITOR_RESTART 时间戳精确互证）。

### 修复（防御纵深四刀）
- actions.updateTask 转 queued 加 `AND status NOT IN ('completed','cancelled')` 原子守卫（含 monitor 2nd-stuck 裸 SQL 同守卫）
- monitor handleStuckRun 入口终态短路：只关 stale run（MONITOR_STALE_RUN_RECONCILED）不 requeue
- executor docker env 默认 `host.docker.internal:5221`（resolveBrainBaseUrl，BRAIN_URL 可覆盖）
- runner 镜像加 socat 回环转发 `127.0.0.1:5221 → host.docker.internal:${BRAIN_URL 端口}`，通治所有硬编码 localhost 的 skill

### 下次预防
- [ ] 容器内跑的 skill 出现「exit 0 但零产出」→ 第一怀疑容器网络可达性（`docker exec <c> curl -m3 localhost:5221` 十秒定案），不要先怀疑 LLM 行为
- [ ] callback 成功 ≠ 容器内 API 可达：callback 是宿主侧写的，两条链路完全独立
- [ ] 任何「completed 任务回到 queued」先查 `_ghost_audit` / run_events 的 reason_code，SQL 指纹比日志可靠
- [ ] 新增容器派发路径时 env 注入必须用 resolveBrainBaseUrl，禁止再写 localhost:5221 兜底（docker-brain-url.test.js 已守卫）
- [ ] merge 后必须重建 runner 镜像（socat 层才生效）：`docker build -t cecelia/runner:latest docker/cecelia-runner/`
