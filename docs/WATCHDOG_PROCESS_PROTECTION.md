---
id: watchdog-process-protection
version: 1.1.0
created: 2026-02-06
updated: 2026-02-06
changelog:
  - 1.1.0: 8 处修正 - jq 原子写、kill-0 语义、crisis 候选集、info.json 字段、宽限期起点、PAGE_SIZE、next_run_at 安全、隔离阈值对齐
  - 1.0.0: 初始版本 - 三层进程保护系统
---

# Watchdog 进程保护系统

## 概述

Cecelia Brain 的进程资源看门狗，解决「任务进程失控时无法精确处理」的问题。

### 问题（Before）

| 场景 | 原有行为 | 后果 |
|------|----------|------|
| claude 进程内存泄漏到 2GB+ | 无检测，等 Linux OOM killer | OOM 随机杀进程，可能杀健康任务 |
| CPU 死循环 | 只有 60min 超时兜底 | 浪费 60 分钟算力 |
| 需要杀一个失控进程 | `kill pid` 杀主进程，子进程变孤儿 | 孤儿进程继续占资源 |
| 被杀的任务 | 标记 failed，需要手动重跑 | 人工介入，不自动 |
| 系统资源紧张 | 只在入口限流（拒绝新任务） | 已在跑的任务不受控 |

### 解决方案（After）

| 场景 | 新行为 | 效果 |
|------|--------|------|
| 内存泄漏到 2GB+ | watchdog 每 tick 采样 /proc，超阈值立即 kill | 精确杀失控进程，保护健康任务 |
| CPU 死循环 + 系统紧张 | 持续 30s 高 CPU + 系统压力 > 0.7 才杀 | 不误杀短暂 CPU burst |
| 需要杀进程 | `kill -TERM -pgid` → 等 10s → `kill -9 -pgid` | 进程组整体干净退出 |
| 被杀的任务 | 自动重排队 + 退避（2min） | 自动恢复，不需人工 |
| 连续被杀 2 次 | 第 1 次 → retry，第 2 次 → quarantine | 防止反复浪费资源 |
| 系统极端压力 | 只杀 RSS 最大的 1 个，下 tick 再评估 | 避免连杀多个造成雪崩 |

---

## 架构：三层防护

```
┌──────────────────────────────────────────────────────────────┐
│                    Layer A: 进程组隔离                         │
│                    (cecelia-run)                              │
│                                                              │
│   setsid 创建独立进程组 → info.json 记录 pgid                 │
│   cleanup trap 用 kill -pgid 杀整个进程组                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                    Layer B: 资源看门狗                         │
│                    (watchdog.js)                              │
│                                                              │
│   每 tick 采样 /proc/{pid}/statm + /proc/{pid}/stat          │
│   三级响应：Normal → Tense → Crisis                           │
│   动态阈值：RSS_KILL = min(35% 总内存, 2400MB)               │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                    Layer C: Kill + 自动重排                    │
│                    (executor.js + tick.js)                    │
│                                                              │
│   killProcessTwoStage: SIGTERM → 10s → SIGKILL → 验证        │
│   requeueTask: 退避 + 超限隔离                                │
└──────────────────────────────────────────────────────────────┘
```

---

## Layer A: 进程组隔离

### 改动文件

`/home/xx/bin/cecelia-run`

### Before

```bash
# 直接后台执行，进程组 = 父进程
(cd "$ACTUAL_WORK_DIR" && CECELIA_HEADLESS=true claude -p "..." ...) &
CHILD_PID=$!

# cleanup 只杀单个 PID
cleanup() {
  if kill -0 "$CHILD_PID"; then
    kill -TERM "$CHILD_PID"
    sleep 1
    kill -9 "$CHILD_PID"
  fi
}
```

**问题**：
- claude 进程会 fork 子进程（git, npm, etc.），`kill CHILD_PID` 只杀主进程
- 子进程成为孤儿，继续占用资源
- info.json 没有 pgid，外部无法按进程组 kill

### After

```bash
# setsid 创建独立进程组
setsid bash -c "cd '$ACTUAL_WORK_DIR' && CECELIA_HEADLESS=true claude -p ..." &
CHILD_PID=$!

# 获取实际 PGID（不假设 pgid==pid）
sleep 0.2
CHILD_PGID=$(ps -o pgid= -p "$CHILD_PID" | tr -d ' ')

# 原子写入 info.json（tmp→mv，防止半写）
tmp_info=$(mktemp)
jq --argjson cpid "$CHILD_PID" --argjson pgid "$CHILD_PGID" \
  '. + {child_pid: $cpid, pgid: $pgid}' "$SLOT/info.json" > "$tmp_info" \
  && mv "$tmp_info" "$SLOT/info.json"

# cleanup 用进程组 kill
cleanup() {
  local pgid=${CHILD_PGID:-$CHILD_PID}
  kill -TERM -"$pgid"    # 负号 = 杀整个进程组
  sleep 2
  kill -9 -"$pgid"       # 强制
}
```

### info.json 完整字段

cecelia-run 在 `get_lock()` 时写入初始 info.json，然后在 spawn 后更新：

| 字段 | 来源 | 说明 |
|------|------|------|
| `task_id` | 参数 $1 | 任务 ID |
| `checkpoint_id` | 参数 $2 | 检查点 ID |
| `mode` | 固定 `"headless"` | 执行模式 |
| `pid` | `$$` | cecelia-run 自身 PID |
| `started` | `date -Iseconds` | ISO-8601 UTC 启动时间 |
| `child_pid` | `$!` (setsid 后) | claude 进程 PID |
| `pgid` | `ps -o pgid=` | 进程组 ID |

**watchdog 依赖 `started` 字段计算宽限期**。

### 改进

- `setsid` 确保 claude 及其子进程都在同一个新进程组
- info.json 显式记录 `child_pid` 和 `pgid`，watchdog 可以读取
- jq 写入用 `mktemp` + `mv` 保证原子性
- cleanup 用 `kill -TERM/-9 -pgid` 一次杀掉整棵进程树

---

## Layer B: 资源看门狗

### 新建文件

`brain/src/watchdog.js`（~240 行）

### 动态阈值

| 参数 | 公式 | 16GB 机器 | 8GB 机器 | 4GB 机器 |
|------|------|-----------|----------|----------|
| RSS_KILL | min(35% 总内存, 2400MB) | 2400MB | 2400MB | 1433MB |
| RSS_WARN | 75% x RSS_KILL | 1800MB | 1800MB | 1075MB |
| CPU_SUSTAINED | 95% 单核，持续 6 tick (30s) | - | - | - |
| GRACE_PERIOD | 启动后 60 秒不检查 | - | - | - |

### /proc 采样

```
/proc/{pid}/statm → RSS = resident_pages x PAGE_SIZE
/proc/{pid}/stat  → utime + stime (CPU ticks)

PAGE_SIZE = getconf PAGE_SIZE（启动时读取，默认 4096）
CPU% = (tick_delta / USER_HZ / wall_seconds) x 100
单核满载 = 100%，双核 = 200%，USER_HZ = 100 (Linux default)
```

**P0 #3 修复**：`/proc/{pid}/stat` 的 comm 字段 `(process name)` 可能含空格和括号，
必须用 `lastIndexOf(')')` 找到最后一个右括号再 split。

**页大小**：通过 `getconf PAGE_SIZE` 从系统读取，不硬编码 4096。
x86_64 默认 4096，ARM64 可能是 65536。读取失败则 fallback 4096。

### 宽限期规则

| 条件 | 行为 |
|------|------|
| `info.json.started` 存在且在 60s 内 | **宽限期**：跳过检查（除了 RSS 硬上限） |
| `info.json.started` 存在且超过 60s | **正常检查** |
| `info.json.started` 缺失 | **无宽限**：视为已过宽限期（runtimeSec=Infinity） |

起点是 `info.json.started`（ISO-8601 UTC），由 cecelia-run 在 `get_lock()` 时写入。

### 三级响应

```
             系统压力 (max_pressure from checkServerResources)
                │
    ┌───────────┼───────────────┬──────────────┐
    ▼           ▼               ▼              ▼
  < 0.7       0.7 ~ 1.0       >= 1.0       任何时候
  Normal       Tense           Crisis      RSS >= KILL
    │           │               │              │
  只警告     RSS高+CPU持续     只杀 top1     无条件 kill
  (warn)      30s → kill       RSS 最大     (即使在
              其他不动         一次一刀      宽限期内)
                              下 tick 再评
```

**Crisis 候选集合**：仅从「当前 in_progress 且 pgid 存在且 `/proc/<pid>` 可见」的任务中选。
stale slot（进程已消失）不会进入候选，由 liveness probe 单独处理。
每 tick 最多 kill 1 个，下 tick 重新评估——避免连杀造成雪崩。

### Before vs After 对比

| 维度 | Before | After |
|------|--------|-------|
| 检测方式 | 无（只有 60min 超时兜底） | 每 tick 从 /proc 采样 RSS + CPU |
| 响应速度 | 60 分钟 | 5 秒内发现，下一个 tick 执行 kill |
| 误杀保护 | 无 | 60s 宽限期 + 双条件（RSS+CPU） + crisis 只杀 1 个 |
| 阈值 | 无 | 动态计算，适应不同内存/页大小 |
| CPU 判定 | 无 | 必须持续 30 秒高 CPU，短暂 burst 不触发 |

---

## Layer C: 两段式 Kill + 自动重排

### 改动文件

`brain/src/executor.js`（新增 2 个函数）

### killProcessTwoStage(taskId, pgid)

```
SIGTERM -pgid          等 10 秒            SIGKILL -pgid        等 2 秒
    │                     │                     │                   │
    ▼                     ▼                     ▼                   ▼
 给进程机会          检查 leader 是否        强制杀死           验证 /proc
 优雅退出           还活着                  (不留活口)          消失了吗？
                   process.kill(pgid, 0)
                   ↑ 正数=检查单个PID
                   (leader 死了=组消失)
```

**存活检查方式**：`process.kill(pgid, 0)` 发送信号 0 到 pgid（作为正数=单个 PID=组 leader）。
如果 leader 进程不存在（ESRCH），整个进程组已清除。
如果需要确认组内是否还有残留，可用 `pgrep -g <pgid>`。

**P2 #8**：SIGKILL 后等 2 秒再检查 `/proc`，确认进程确实死了。如果还活着，
记录 `kill_failed`（理论上不应该发生，但防御性编程）。

### Before vs After

| 维度 | Before (killProcess) | After (killProcessTwoStage) |
|------|---------------------|----------------------------|
| 信号 | 只发 SIGTERM | SIGTERM → 等 → SIGKILL |
| 目标 | 单个 PID | 进程组 (-pgid) |
| 验证 | 不验证是否死了 | process.kill(pgid, 0) + /proc 确认 |
| 返回 | boolean | { killed, stage } 详细结果 |

### requeueTask(taskId, reason, evidence)

```
被 watchdog 杀掉的任务
    │
    ├─ 状态不是 in_progress → 不操作（防竞态）
    │
    ├─ 第 1 次 kill (retry_count=1) → 重排队 + 等 2 分钟
    │
    └─ 第 2 次 kill (retry_count>=2) → 隔离 (quarantined)
        reason: resource_hog
```

**规则**：`retry_count >= 2 → quarantine`。即：第 1 次 kill → retry；第 2 次 kill → quarantine。

**P0 #2 防竞态**：
- `WHERE status = 'in_progress'` 防止复活已完成的任务
- 检查 `rowCount` 防止并发更新冲突
- payload 写入完整证据链（`watchdog_kill`, `watchdog_last_sample`, `watchdog_retry_count`）

### next_run_at 格式规约

| 项 | 规定 |
|----|------|
| 格式 | UTC ISO-8601：`new Date().toISOString()` |
| 写入方 | 只有 `requeueTask()` 写入 |
| 解析 | PG `::timestamptz` cast，NULL 和空字符串视为无退避 |
| 失败处理 | 非法值不应出现（writer 唯一且受控），如出现视为无退避放行 |

### Before vs After

| 维度 | Before | After |
|------|--------|-------|
| 被杀后 | 标记 failed，等人工处理 | 自动 retry 1 次 + 退避，第 2 次 kill 直接隔离 |
| 退避 | 无 | 2 分钟（指数退避，但第 2 次直接隔离） |
| 证据 | error_details 简单文本 | payload 完整证据链（RSS/CPU/pressure/reason） |
| 竞态保护 | 无 | WHERE status 条件 + rowCount 检查 |

---

## Tick 集成

### 改动文件

`brain/src/tick.js`

### 执行顺序

```
executeTick()
  │
  ├── step 0:  Alertness check
  ├── step 1:  Decision engine
  ├── step 2.5: Feature tick
  ├── step 3:  Daily focus
  ├── step 4:  Query tasks
  ├── step 5:  Auto-fail timeout (60min)
  ├── step 5b: Liveness probe (进程存在性)
  ├── step 5c: Watchdog (资源监控) ← 新增
  ├── step 6:  Planning
  ├── step 7:  Dispatch
  └── step 8:  Update tick state
```

### selectNextDispatchableTask 退避过滤

```sql
-- Before: 直接选所有 queued 任务
WHERE t.status = 'queued'

-- After: 跳过退避期未到的任务
-- next_run_at 始终为 UTC ISO-8601，由 requeueTask() 唯一写入
-- NULL/空字符串 = 无退避，直接放行
WHERE t.status = 'queued'
  AND (
    t.payload->>'next_run_at' IS NULL
    OR t.payload->>'next_run_at' = ''
    OR (t.payload->>'next_run_at')::timestamptz <= NOW()
  )
```

---

## 诊断 API

### GET /api/brain/watchdog

```json
{
  "success": true,
  "thresholds": {
    "rss_kill_mb": 2400,
    "rss_warn_mb": 1800,
    "cpu_sustained_pct": 95,
    "cpu_sustained_ticks": 6,
    "startup_grace_sec": 60,
    "total_mem_mb": 15989
  },
  "tasks": [
    {
      "task_id": "abc-123",
      "pid": 12345,
      "pgid": 12345,
      "slot": "slot-1",
      "started": "2026-02-06T09:00:00Z",
      "samples_count": 42,
      "last_rss_mb": 650,
      "last_cpu_pct": 35,
      "last_sampled_at": "2026-02-06T09:03:30Z"
    }
  ],
  "stale_slots": []
}
```

---

## 测试覆盖

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|----------|
| `watchdog.test.js` | 28 | 阈值计算、PAGE_SIZE 系统读取、CPU% 算法、/proc 解析、宽限期（含缺失 started）、三级响应、crisis top-1、诊断 API |

### 关键测试场景

1. **CPU 计算**：单核 100%、半核 50%、多核 200%、5s tick 间隔
2. **/proc 解析 P0 #3**：comm 字段含空格和括号 `(my process (v2))`
3. **宽限期**：启动 30s 内不被杀（除了 RSS 硬上限）
4. **宽限期缺失**：`started` 字段缺失时不授予宽限（直接检查）
5. **Crisis 模式 P1 #6**：两个任务同时超标，只杀 RSS 最大的 1 个
6. **PAGE_SIZE**：从系统读取且为 2 的幂
7. **Stale slot**：进程已消失但 lock 目录还在的处理

---

## 文件清单

| 文件 | 类型 | 行数 | 说明 |
|------|------|------|------|
| `/home/xx/bin/cecelia-run` | 修改 | ~20 行改动 | setsid + pgid + 原子 jq + 进程组 kill |
| `brain/src/watchdog.js` | **新建** | ~240 行 | PAGE_SIZE 系统读取 + 采样 + 检测 + 三级响应 |
| `brain/src/executor.js` | 修改 | ~120 行新增 | killProcessTwoStage (leader 检查) + requeueTask (>=2 隔离) |
| `brain/src/tick.js` | 修改 | ~30 行新增 | step 5c + next_run_at 安全过滤 |
| `brain/src/routes.js` | 修改 | ~15 行新增 | GET /api/brain/watchdog |
| `brain/src/__tests__/watchdog.test.js` | **新建** | ~310 行 | 28 个单元测试 |

---

## 与现有系统的关系

```
                    Cecelia Brain 防护体系
                    ═══════════════════════

入口层（已有）          运行层（新增）           退出层（已有）
───────────            ───────────            ───────────
checkServerResources    Watchdog               Liveness Probe
  压力 >= 1.0           /proc 采样             进程存在性检查
  → 拒绝新任务          三级响应               double-confirm
                       killProcessTwoStage     → auto-fail
Alertness System       requeueTask
  COMA → 停止派发       退避 + 隔离            Auto-fail Timeout
  ALERT → 50% 派发                            60min 超时兜底

Circuit Breaker                                Quarantine
  连续失败 → 断路                               隔离问题任务
```

**Watchdog 填补了「运行层」的空白**——以前只有「入口限流」和「退出检测」，
中间跑着的任务是盲区。

---

## 不做的事

| 方案 | 为什么不做 |
|------|-----------|
| cgroup | 需要 root 权限，/proc + pgid 已够用 |
| DB migration | next_run_at 存 payload JSONB，不需要新列 |
| 改 alertness | watchdog 直接读 systemPressure，避免循环依赖 |
| 改 cecelia-bridge | 只是 HTTP 中转，不需要改 |
| 单凭 CPU 高就杀 | 必须 RSS+CPU 双条件，或 RSS 超硬上限 |

---

## P0~P2 修复对照

| 编号 | 问题 | 修复 |
|------|------|------|
| P0 #1 | pgid!=pid 风险 | info.json 显式记录 pgid，kill 用 pgid |
| P0 #2 | requeueTask 竞态 | WHERE status='in_progress' + rowCount 检查 |
| P0 #3 | /proc/stat 解析 | lastIndexOf(')') 后再 split |
| P0 #4 | CPU% 含义 | 单核=100%，delta_ticks/hz/wall_sec*100 |
| P1 #5 | 启动时误杀 | runtime < 60s 宽限期；缺失 started → 无宽限 |
| P1 #6 | 崩溃模式连杀 | 只杀 top1 RSS（候选=in_progress+pgid+/proc 可见），下 tick 再评估 |
| P1 #7 | 陈旧 lock | 检查 /proc/pid 存在性 |
| P2 #8 | kill 验证 | process.kill(pgid, 0) 检查 leader + SIGKILL 后等 2s 确认 |
| P2 #9 | 证据链 | payload 写 watchdog_kill + last_sample |
| Fix #1 | jq 写入不原子 | mktemp + mv 原子写入 |
| Fix #2 | kill -0 语义 | 明确：process.kill(pgid, 0) 检查 leader PID，非进程组 |
| Fix #3 | Crisis 候选不明 | 候选=in_progress+pgid+/proc 可见 |
| Fix #4 | info.json 字段不全 | 文档明确全部 7 个字段 |
| Fix #5 | 宽限期起点不明 | started 缺失→Infinity→无宽限 |
| Fix #6 | PAGE_SIZE 硬编码 | getconf PAGE_SIZE 启动读取，fallback 4096 |
| Fix #7 | next_run_at 安全 | SQL 加 empty string 检查，规约只写 ISO UTC |
| Fix #8 | 隔离阈值不一致 | retry_count >= 2 → quarantine（第 1 次 retry，第 2 次隔离） |
