# 设计：strategist 容器执行零落库 + completed↔queued 振荡修复

任务：7addad72-60b3-4369-8747-c4fa3c64a12b（issue 219a9efc 结案实证）

## 根因（已用真库/真容器实证）

### Bug1 容器零落库
- `executor.js:3458-3459` docker 分支注入 `WEBHOOK_URL/CECELIA_CORE_API = ${BRAIN_URL || 'http://localhost:5221'}`，brain 容器内 `BRAIN_URL` 为空 → 容器拿到 `localhost:5221`。
- 任务容器 NetworkMode=bridge，容器内实测 `curl localhost:5221` → 000（不通）；`host.docker.internal:5221` → 通（`--add-host host.docker.internal:host-gateway` 已存在，docker-executor.js:434）。
- `line-strategist/SKILL.md` 硬编码 13 处 `localhost:5221`（ci-patrol 等容器内 skill 同病）——所有写库 curl 静默失败，skill 照常走完 exit 0。
- callback 由宿主侧 `writeDockerCallback` 写 callback_queue，与容器网络无关 → 「exit 0 + completed + 零落库」。
- 正确先例：`harness-skill-relay.js:223` 注入 `BRAIN_URL=http://host.docker.internal:5221`。

### Bug2 completed→queued 振荡
- run `1181b7f7`：容器 08:04 退出后 run_events 行仍 status='running'（无人关闭），heartbeat 停在 08:04:45。
- `monitor-loop.js detectStuckRuns` 只查 `run_events.status='running' AND heartbeat 过期`，**不看 tasks.status**。
- 08:10:14 monitor 判 stuck，`handleStuckRun` retry_count=0 → `updateTask({status:'queued'})`，其动态 SQL 与 `_ghost_audit` 记录4指纹逐字吻合（ts_end/reason_code=MONITOR_RESTART 时间戳精确对上）。

## 修法（防御纵深）

### Bug1
1. **executor.js docker 分支**：`WEBHOOK_URL/CECELIA_CORE_API` 默认值 `http://localhost:5221` → `http://host.docker.internal:5221`（仅 docker 分支；`BRAIN_URL` env 仍可显式覆盖），并同时注入 `BRAIN_URL` 进容器 env（与 relay 先例对齐）。
2. **runner 镜像通治层**：Dockerfile 加 `socat`；entrypoint.sh 在启动 claude 前后台起回环转发：
   `socat TCP-LISTEN:5221,bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:5221 &`
   （host.docker.internal 不可解析时跳过，不阻塞）。效果：所有硬编码 `localhost:5221` 的 skill（line-strategist/ci-patrol/db-update…）在容器内直接可用，不必逐个改 SKILL.md。
3. 合并后重建 runner 镜像（`cecelia/runner:latest` 需手动 rebuild，memory 已载）。

### Bug2
1. **actions.js updateTask 铁闸**：status→'queued' 时 WHERE 追加 `AND status NOT IN ('completed','cancelled')`——所有程序化调用方（monitor RESTART/decision-executor retry_task/dispatcher）统一被挡；显式人工 psql 不受影响（符合"除非显式人工"）。0 行命中返回明确 error。
2. **monitor-loop handleStuckRun 终态调和**：入口先查 tasks.status；终态（completed/failed/cancelled）→ 不重启，只关闭 stale run_events（reason_code='MONITOR_STALE_RUN_RECONCILED'，completed→'completed'，其余→'failed'）并 return。

## 不做（YAGNI）
- 不改 line-strategist SKILL.md 的 13 处 localhost（socat 层通治；skill SSOT 在 zenithjoy-skills，另立不阻塞本修）。
- 不深挖"为什么 trace.end 没关 run_events"的全链（monitor 调和 + updateTask 铁闸已使振荡结构性不可能；若复发有 _ghost_audit 留痕）。

## 测试策略
- **unit（CI 回归，必 commit）**：
  - `actions.updateTask`：completed 任务转 queued 被拒（SQL 含状态守卫 + 0 行返回 error）；failed→queued 仍放行。
  - `monitor-loop.handleStuckRun`：task=completed 时不调 updateTask、run_events 被关闭为 reconciled；task=in_progress 时保持原重启行为。
  - `executor` docker env：默认 `host.docker.internal:5221`（抽 `resolveDockerBrainBase()` 纯函数测试）；`BRAIN_URL` 显式设置时尊重覆盖。
  - 守卫文件断言（CI 兼容 node -e）：entrypoint.sh 含 socat 转发行；Dockerfile 含 socat 安装。
- **E2E proven-to-fire（merge+部署+重建镜像后，真容器真库）**：重放一条真实 strategist_decision（ce22c955 同参），验收三条：①decisions/notes 有军师落库 ②task.result 非空 ③completed 后 10 分钟不被打回。守卫报红实证：修复前容器内 curl 000 已亲眼确认（本次调查即 fire 证据）；updateTask 铁闸用失败 unit test 先行（TDD commit-1）。
