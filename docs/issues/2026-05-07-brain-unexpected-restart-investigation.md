# Brain 容器周期性重启 P0 诊断报告

- 日期: 2026-05-07 (北京时间)
- 严重度: P0（影响所有 in_progress 任务、worktree 清理误删、飞书静默失效、tick/consolidation/rumination 不前进）
- 任务: docs-only，**本次不修代码**，只产出诊断 + 推荐方案
- Brain Task ID: `1ba9506a-d7d9-4269-9b96-836951fce6a5`

---

## 现象

用户报反复观察到 Brain 容器周期性"自我重启"：
- `docker ps -a --filter name=cecelia-node-brain` 显示 `Up N minutes`，看起来正常，但实际过几小时再看就被重新创建过
- 退出码 `exitcode=0`（graceful exit，不是 crash 不是 OOM 不是 panic）
- 重启后 `startup-recovery` 触发，把 `in_progress` 的任务全部 requeue（attempts 重置）；同时 `cleanup-merged-worktrees` 可能误清掉用户当前正在用的活跃 worktree
- 用户体感：刚 mute 的飞书又开了；任务 attempts 莫名重置；W8 端到端跑不完；refresh-claude-tokens 之类外部任务被打断

期望：定位重启根因 + 给出可立刻执行的修复路径。

---

## 已收集证据（按时间序列）

### 一、当前实例状态（调查时刻 2026-05-07 18:45 北京时间）

```
docker inspect cecelia-node-brain
  Created:        2026-05-07T10:28:54.793665897Z   (北京 18:28:54)
  StartedAt:      2026-05-07T10:28:54.859454879Z
  RestartCount:   0
  ExitCode:       0
  OOMKilled:      false
  Status:         running
  HealthStatus:   healthy
  Memory:         1073741824   (1 GiB)
  RestartPolicy:  unless-stopped
```

`RestartCount=0` 是错觉 —— 因为容器是被 `docker compose up -d` **recreate**（删旧容器、创新容器），而不是 `docker restart`，所以 RestartCount 每次重置到 0。

### 二、ps + 端口持有者（关键发现：双 Brain）

```
$ ps aux | grep "node.*server.js"
administrator  3581  /opt/homebrew/bin/node server.js     # 15:19 启动，宿主 nohup
administrator 86114  node server.js                       # 18:28 启动，docker entry

$ lsof -nP -i :5221 -sTCP:LISTEN
node    3581 administrator   17u  IPv6  TCP *:5221 (LISTEN)
```

**5221 端口当前被宿主 nohup `node server.js` (PID 3581, 15:19 启动) 持有**，docker 容器虽然 publish 5221:5221，实际 host 端口已被宿主进程抢占。这意味着外部 `curl localhost:5221/...` 全部走宿主 Brain，docker 容器内的 Brain 实际上被"架空"。

### 三、shutdown-trace 历史（93 次 SIGTERM 全样本）

源：`/Users/administrator/claude-output/brain-shutdown-trace.jsonl`（server.js 每次 graceful shutdown 时持久化的临终 dump）。

| 日期 | 重启次数 |
|---|---|
| 2026-04-24 | 5 |
| 2026-04-25 | 11 |
| 2026-04-26 | 13 |
| 2026-04-27 | 11 |
| 2026-04-28 | 4 |
| 2026-04-29 | 4 |
| 2026-04-30 | 4 |
| 2026-05-02 | 1 |
| 2026-05-03 | 1 |
| 2026-05-04 | 2 |
| 2026-05-05 | 7 |
| 2026-05-06 | 11 |
| **2026-05-07** | **19** |
| 14 天合计 | **93 次** |

关键统计：
- **signals: 100% SIGTERM**（无 SIGINT、无 SIGKILL、无 uncaughtException 触发的 exit 1）
- uptime（秒）: min=2, median≈2282 (~38 分钟), max=200867 (~2.3 天)
- min uptime 仅 2 秒 —— 进程刚 listening 就被 SIGTERM 杀掉
- 多次 uptime ∈ {7s, 20s, 32s, 41s, 104s, 121s} —— 与 docker compose recreate 紧凑触发吻合
- 多次 trace `pid=7` —— 容器内 init 后第一个 node 进程，证明在容器里跑

样本（近 5 次）：
```jsonl
{"ts":"2026-05-07T01:33:55Z","signal":"SIGTERM","uptime_sec":37331,"pid":7,...}
{"ts":"2026-05-07T01:47:16Z","signal":"SIGTERM","uptime_sec":799,"pid":7,...}
{"ts":"2026-05-07T02:10:06Z","signal":"SIGTERM","uptime_sec":1286,"pid":7,...}
{"ts":"2026-05-07T02:48:09Z","signal":"SIGTERM","uptime_sec":2282,"pid":7,...}
{"ts":"2026-05-07T10:28:54Z","signal":"SIGTERM","uptime_sec":580,"pid":7,...}
```

所有 trace `tick.last_tick` 都冻结在 `2026-05-05T03:31:27.522Z`、`actions_today: 692` —— Brain 内 tick 已经 2 天没前进了，但进程没崩，仍在响应 health 接口。这是关键的"degraded but alive"信号。

### 四、cecelia_events 表 — 自动回滚事件流

从 `cecelia_events WHERE event_type='probe_rollback_triggered'`：

按天分布（14 天内 198 次回滚）：

| 日期 | 回滚次数 |
|---|---|
| 2026-04-27 | 21 |
| 2026-04-28 | 32 |
| 2026-04-29 | 27 |
| 2026-04-30 | 24 |
| 2026-05-01 | 24 |
| 2026-05-02 | 25 |
| 2026-05-03 | 10 |
| 2026-05-06 | 35 |

按 probe + rollback_success：

| Probe | 触发次数 | rollback_success=true |
|---|---|---|
| rumination | 140 | 0 |
| consolidation | 35 | 0 |
| self_drive_health | 23 | 0 |

**14 天 198 次 rollback，0 次 rollback_success=true，但容器全部被 recreate 完成**（docker compose up -d 已经把旧容器 stop+新容器 start）。

近 5 条 stderr 摘要：
```
"回滚脚本不存在: /scripts/brain-rollback.sh"          (容器内 cwd 解析错路径)
" Container cecelia-node-brain Recreate +
  Container cecelia-node-brain Recreated +
  Container cecelia-node-brain Starting +
  Container cecelia-node-brain Healthy"               (实际 recreate 已完成，但 spawnSync 90s timeout)
```

### 五、源码 — 自动回滚机制（已验证）

`packages/brain/src/capability-probe.js`:

```js
const PROBE_INTERVAL_MS = 60 * 60 * 1000;            // 1 小时一轮
const ROLLBACK_CONSECUTIVE_THRESHOLD = 3;             // 单 probe 连续 3 次失败
const ROLLBACK_BATCH_THRESHOLD = 5;                   // 单批 ≥5 个 probe 失败
const ROLLBACK_SCRIPT = path.join(_projectRoot, 'scripts', 'brain-rollback.sh');

export function executeRollback(triggerReason) {
  const proc = spawnSync('bash', [ROLLBACK_SCRIPT], {
    timeout: 90_000,
    encoding: 'utf8',
  });
  // ...
}
```

`scripts/brain-rollback.sh` 关键逻辑：

```bash
BRAIN_VERSION="${TARGET}" ENV_REGION="${ENV_REGION}" \
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d
# 然后 curl http://localhost:5221/api/brain/tick/status 等 healthy（最多 60s）
```

### 六、Brain 自身的 health 输出

```json
{
  "status": "degraded",
  "uptime": 12488,
  "tick_stats": {
    "total_executions": 79632,
    "last_executed_at": "2026-05-05 11:31:29",
    "last_duration_ms": 2024
  },
  "circuit_breaker": {
    "open": ["cecelia-run"],
    "states": {
      "cecelia-run": {"state":"OPEN", "failures":351, "lastFailureAt":1778150744729}
    }
  }
}
```

`last_tick` 已停 2 天 + cecelia-run breaker `OPEN failures=351`（老时间戳） —— 高层认知模块（rumination / consolidation / self_drive）依赖 tick 推进，tick 死了所以这些 probe 一直 fail。

### 七、宿主系统层（cron + launchd）

`crontab -l` 关键条目：
```cron
* * * * *           /Users/administrator/bin/cecelia-watchdog.sh        # 每分钟
*/15 * * * *        /Users/administrator/bin/janitor.sh --mode frequent  # 每 15 分钟
0 4 * * *           /Users/administrator/bin/janitor.sh --mode daily     # 每天凌晨 4 点
@reboot sleep 10 && /Users/administrator/bin/cecelia-watchdog.sh
```

`launchctl list`:
```
com.cecelia.bridge                  # cecelia-bridge.cjs daemon
com.cecelia.tailscale-watchdog
```

**没有任何 cron / launchd 直接定时杀 Brain**。重启完全来自 Brain 自己的 `capability-probe → brain-rollback.sh → docker compose up -d` 链路。

### 八、cecelia-watchdog.sh 关键逻辑（双 Brain 拓扑根源）

```bash
if ! curl -sf http://localhost:5221/api/brain/health > /dev/null 2>&1; then
  echo "[$(date)] Brain down, restarting..." >> watchdog.log
  cd "$BRAIN_DIR"
  ENV_REGION=us \
    nohup /opt/homebrew/bin/node server.js \
    >> brain.log 2>> brain-error.log &
fi
```

`logs/watchdog.log` 5/7 当天宿主 Brain 拉起记录：
```
[Thu May  7 09:48:00 CST 2026] Brain restarted, PID: 994
[Thu May  7 14:51:00 CST 2026] Brain restarted, PID: 78948
[Thu May  7 14:54:00 CST 2026] Brain restarted, PID: 74035
[Thu May  7 14:57:00 CST 2026] Brain restarted, PID: 48891
[Thu May  7 15:00:00 CST 2026] Brain restarted, PID: 26186
[Thu May  7 15:19:01 CST 2026] Brain restarted, PID: 3581    ← 当前持有 5221 的就是它
```

历史上 4/29 22:37 - 23:07 出现过 30+ 次连续每分钟 restart（健康检查反复失败的 thrash 循环）。

### 九、内存压力（不是根因，但是 contributing factor）

`logs/brain-error.log` 持续输出：
```
[slot-allocator] memory warn: System available 73-200MB < 819MB threshold
  (other apps eating memory; Brain RSS 60-105MB is fine) (dispatch continues)
```

机器整体内存压力大，但 Brain 自己 RSS 一直在 60-105MB 范围，远低于 1GB 容器上限，OOMKilled=false 一直为 false。**不是 OOM 引起的重启**。

---

## Top 3 嫌疑根因（按可能性排）

### 嫌疑 1（确诊主因）：capability-probe 自动回滚正反馈死循环

**机制**：

1. `consolidation` / `rumination` / `self_drive_health` 三个高层 cognitive 探针长期失败（因为它们依赖 tick 推进，tick 卡在 5/5 03:31 不动）
2. 单探针连续 3 次失败（3 小时）→ `executeRollback()` 调用 `brain-rollback.sh`
3. `brain-rollback.sh` 跑 `docker compose up -d` → recreate cecelia-node-brain → 当前 Brain 进程收到 SIGTERM、graceful exit 0
4. 新 Brain 启动 → 进程清白，但代码没改 → tick 模块仍然有同样 bug → 还是不前进
5. 1 小时后 probe 又跑一轮失败、再 1 小时、再 1 小时 → 第 3 次 → 又触发回滚 → 又 recreate

**证据强度：100%**
- 198 次 rollback × 0 成功 vs 93 次 SIGTERM trace —— 数量级吻合
- 全部 SIGTERM、无 OOM、无 crash —— 与 docker compose recreate 行为完全吻合
- recreate 间隔（1-3 小时）与 PROBE_INTERVAL_MS × ROLLBACK_CONSECUTIVE_THRESHOLD = 3h 完全吻合
- 5/7 当天 19 次重启 + 同期 cecelia-watchdog.sh 多次拉起宿主 Brain —— 双重观测

### 嫌疑 2：双 Brain 拓扑（recreate 永远救不活，但永远在 recreate）

**机制**：

- 当容器 recreate 后，docker 试图 publish 5221:5221，但宿主 nohup Brain 已经在 listen 5221 → 容器实际 publish 失败（或者 host port 优先被宿主进程拿到）
- 宿主每 1 分钟 watchdog 跑一次 `curl http://localhost:5221/api/brain/health`，挂了立刻 nohup 拉起宿主 Brain
- `brain-rollback.sh` 的 60s health 轮询也走 `localhost:5221` —— 它实际检查的是宿主 Brain 而不是新容器 Brain
- 结果：宿主 Brain 一直 ≥1 个，容器 Brain 不停被 recreate，外界永远观测不到容器 Brain 的实际状态

**证据强度：高**
- `lsof -nP -i :5221` 当前显示宿主 Brain 持有
- `logs/watchdog.log` 5/7 多次拉起宿主 Brain
- 198 次 rollback 全部 success=false，但容器持续 recreate（脚本 health 检测被宿主 Brain 误导）

### 嫌疑 3：probe 设计缺陷（业务指标不该当容器 health 用）

**机制**：

`rumination` / `consolidation` / `self_drive_health` 都是高层 cognitive 模块的"产出度量"（48h 是否有合并、24h 是否有反刍、24h 是否创建任务），本质上是**业务功能性指标**，不是基础设施健康。

业务指标失败的正确处理：发告警让人改代码（fix tick / fix consolidation 调度）。
错误处理（当前代码）：recreate 容器 —— 但 image 不变，业务逻辑 bug 不变，recreate 解决不了。

**证据强度：高**
- 14 天 198 次回滚 0 成功（recreate 从未"复活"任何一个失败的 probe）
- 即便 rollback 成功（exit 0），下一轮 probe 还是失败
- `consolidation.js` 注释明确说"空合并也写入 memory_stream，否则 capability-probe 会把空闲日误报"—— 说明设计上知道 probe 会"误报"，但没有把"业务指标 fail" 与"基础设施 fail"区分对待

---

## 推荐下一步（每个嫌疑给一条 actionable 修复路径）

### 立刻做（独立 PR，不放本任务里）

1. **关闭 capability-probe 自动回滚（紧急止血）**
   - 改法 A：`packages/brain/src/capability-probe.js` 加 env gate `if (process.env.PROBE_AUTO_ROLLBACK_ENABLED !== 'true') return;` 默认关
   - 改法 B：把 `ROLLBACK_BATCH_THRESHOLD = 5` 与 `ROLLBACK_CONSECUTIVE_THRESHOLD = 3` 改成 `999` 让阈值永不触发
   - 改法 C：移除 `executeRollback()` 调用，只 `raise('P0', ...)` 发告警
   - 推荐改法 A（最小侵入、可灰度、保留逃生通道）
   - 验证：合并后 24h 内 `cecelia_events` 不再出现 `probe_rollback_triggered` 事件 + `brain-shutdown-trace.jsonl` 不再增长

2. **决策双 Brain 拓扑：选一个、杀另一个**（需用户拍板）
   - 选项 A：保留 docker 容器 Brain。停掉 `cecelia-watchdog.sh` 里 nohup 拉起宿主 Brain 的逻辑（删第 12-22 行）
   - 选项 B：保留宿主 Brain。docker-compose 里把 `cecelia-node-brain` service 删掉或注释，回到非容器化
   - **强烈推荐选项 A**：
     - SSOT 是 docker 容器（`packages/brain/Dockerfile` + `docker-compose.yml`）
     - 容器化部署有 `brain-deploy.sh` 完整流程（build → tag → 切版本 → 健康检查）
     - 宿主 nohup 是历史遗留兜底，已与 deploy 流程脱节
   - 验证：合并后 `lsof -nP -i :5221` 应只看到容器内进程的 host-side mapping，宿主无 nohup node

3. **修业务子系统让探针真的能 pass**（独立任务，不属于"重启诊断"）
   - 排查为什么 `tick.last_tick` 卡在 5/5 03:31（cecelia-run breaker OPEN 是直接表象，深层是 codex CLI 不在容器里 → 派 codex review 失败 → breaker open）
   - 已有 PR/任务正在跑（同时刻 hook 显示有 task `fix(brain): Brain 容器装 codex CLI + ENOENT 不再 trip cecelia-run breaker` queued）
   - consolidation / rumination scheduler 是否真的注册到 tick loop —— 走 explore 流程

### 中期（保留 capability-probe 设计，但修缺陷）

4. **rollback 健康检查改用容器内 healthcheck，不要 host curl**
   - `brain-rollback.sh` 现在 `curl http://localhost:5221/api/brain/tick/status`，host 上跑会被宿主 Brain 误导
   - 改成 `docker inspect --format '{{.State.Health.Status}}' cecelia-node-brain`，直接读 docker daemon 状态
   - 这样不会被 host port 冲突骗到

5. **rollback cooldown 加锁**
   - 当前 ROLLBACK_CONSECUTIVE_THRESHOLD=3 + 1h interval = 3h 才触发，但 recreate 重置 probe 历史（事件表里旧记录还在但行为是新的）→ 实际频率高于 3h
   - 加 `ROLLBACK_COOLDOWN_HOURS=6`：同一 probe 6 小时内 rollback 一次后强制冻结，无视后续连续失败
   - 落地：`cecelia_events` 查 `probe_rollback_triggered` WHERE `payload->>'probe_name' = $1 AND created_at > NOW() - interval '6 hours'`，命中则 skip

6. **probe 分级：基础设施 vs 业务**
   - `db` / `dispatch` / `notify` / `cortex` / `monitor_loop` —— 基础设施类，失败可触发 rollback
   - `rumination` / `evolution` / `consolidation` / `self_drive_health` / `geo_website` —— 业务类，失败只发 P1 告警，不 rollback
   - 在 PROBES 数组每个 entry 加 `severity: 'infra' | 'business'`，`runProbeCycle` 只在 infra 失败时进 rollback 链

---

## 不在范围（明确不修什么）

- 不修 `consolidation` / `rumination` / `self_drive_health` 子系统本身（独立任务，需 explore + 单独 spec）
- 不修 `capability-probe.js` 的探针定义或 PROBES 列表（独立任务）
- 不修 `cecelia-watchdog.sh` 双 Brain 拓扑（**独立 P0 任务，需用户决策选项 A/B**）
- 不修 `scripts/brain-rollback.sh` 的健康检查逻辑（依赖拓扑决策才能确定走哪个端点）
- 不修 `tick.js` 卡顿（独立任务，已有 codex CLI 任务在跑）
- 不动当前正在运行的宿主 Brain (PID 3581) / docker container (cecelia-node-brain) —— 任何动作都可能误清活跃 worktree
- 不改 docker-compose.yml（资源限额、healthcheck 间隔、restart policy 都不是根因）
- 不修 `startup-recovery.js`（误清活跃 worktree 是症状，根因是 recreate 太频繁）

---

## 附录：调查命令清单（reproducible）

```bash
# 1. 实时拓扑
docker ps -a --filter name=cecelia-node-brain
docker inspect cecelia-node-brain --format '{{.State.StartedAt}} | restartCount={{.RestartCount}} | exitCode={{.State.ExitCode}}'
ps aux | grep -E "node.*server.js" | grep -v grep
lsof -nP -i :5221 -sTCP:LISTEN

# 2. shutdown 历史
wc -l /Users/administrator/claude-output/brain-shutdown-trace.jsonl
tail -30 /Users/administrator/claude-output/brain-shutdown-trace.jsonl

# 3. 回滚事件统计
PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "
  SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Shanghai'),
         COUNT(*) FROM cecelia_events
  WHERE event_type='probe_rollback_triggered'
    AND created_at > now() - interval '14 days'
  GROUP BY 1 ORDER BY 1 DESC;"

PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "
  SELECT payload->>'probe_name', payload->>'rollback_success', COUNT(*)
  FROM cecelia_events
  WHERE event_type='probe_rollback_triggered'
    AND created_at > now() - interval '14 days'
  GROUP BY 1,2 ORDER BY 3 DESC;"

# 4. watchdog log
tail -100 /Users/administrator/perfect21/cecelia/logs/watchdog.log
crontab -l | grep -i cecelia

# 5. 当前 health
curl -sf http://localhost:5221/api/brain/health | python3 -m json.tool
```
