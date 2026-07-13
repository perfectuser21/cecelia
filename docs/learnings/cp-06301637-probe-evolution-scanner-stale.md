# PROBE_FAIL_EVOLUTION scanner_stale 修复经验

**日期**: 2026-06-30  
**PR**: #3490  
**分支**: cp-06301637-probe-rumination-self-heal

## 问题

能力探针 `evolution` 报 `scanner_stale`：
```
7d_pr_evolutions=0 last_date=never last_scan=2026-06-18(12d_ago) (scanner_stale)
```

## 根因

**两个叠加问题**：

### 1. executeTick() 是死代码（主因）
`PR #3469` 将 `scanEvolutionIfNeeded` 移入 `executeTick()`，但 Wave 2（2026-05-04）起 `tick-loop.js` 改调 `runScheduler()`（`tick-scheduler.js`），`executeTick` 从不被调用。scanner 自 2026-06-18 停跑。

### 2. component_evolutions 缺 source_repo 列（次因）
scanner 查重 SQL：`WHERE source_repo=$1 AND pr_number=$2`，但 `source_repo` 列未建，SQL 报错 → scanner 失败写 error 到 working_memory → 探针变 `scan_error`（但因首因未运行，实际触发的是 scanner_stale）。

## 修复

1. **新增 `evolution-scanner-loop.js`**：独立 `setInterval`（30min），仿 `recovery-loop` / `pipeline-patrol-loop` 模式，不挂死代码 tick，不受 `runScheduler` 早 return 影响。

2. **`tick-loop.js`**：`startTickLoop()` + `stopTickLoop()` 对称接入。

3. **migration 309**：`ALTER TABLE component_evolutions ADD COLUMN IF NOT EXISTS source_repo VARCHAR(100)`，补历史默认值 + 索引。

## 关键模式

**独立循环模式**：不要挂到 tick 内部（受各种早 return 控制），对"必须周期性运行"的轻量任务（GitHub API、SQL、health check）用独立 `setInterval`，在 `startTickLoop()` 接入。已有模式：

- `harness-watchdog-loop.js`
- `recovery-loop.js`
- `pipeline-patrol-loop.js`
- `evolution-scanner-loop.js`（本次新增）

## 教训

每次把新功能加到 `executeTick()` 前，先确认 `executeTick` 是否真的被调用（Wave 2 后已改 `runScheduler`）。凡需要"每日必跑"的功能，用独立 loop 而非 tick 内部。
