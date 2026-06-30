# PROBE_FAIL_EVOLUTION scanner_stale — 进化扫描器死循环在 executeTick 修复经验

**日期**: 2026-06-30  
**PR**: #3490  
**Branch**: cp-06301637-probe-rumination-self-heal  

## 故障现象

capability probe "evolution" 返回:
```
ok=false, detail=7d_pr_evolutions=0 last_date=never last_scan=2026-06-18(12d_ago) (scanner_stale)
```

进化扫描器自 2026-06-18 起不再运行（12 天未更新 `evolution_last_scan_date` working_memory 门控）。

## 根因（双重历史积累）

### 根因 1：Wave 2 架构迁移（2026-05-04）
`tick-loop.js` 从调用 `executeTick()` 改为调用 `runScheduler()`，`executeTick()` 成为死代码。
但 `scanEvolutionIfNeeded` 原先也不在 `executeTick()` 内（在 consciousness-loop 路径）。

### 根因 2：PR #3469 的误放置（2026-06-28）
PR #3469（PROBE_FAIL_EVOLUTION 上一次修复）将 scanner 从 consciousness-loop 移入 `executeTick()`，
目的是"移出 consciousness 守护"，但 `executeTick()` 本身已是死代码。
结果：scanner 从 consciousness-loop 消失，又没有进入任何活跃代码路径。

### 导致链
```
PR #3469 合并 (2026-06-28)
  → scanEvolutionIfNeeded 从 consciousness-loop 移走
  → 放入 executeTick()（死代码）
  → scanner 从 2026-06-18 之后从未运行
  → probe PROBE_FAIL_EVOLUTION(scanner_stale)
  → Brain 自驱系统派发本次修复任务（2026-06-30）
```

## 修复方案

创建 `evolution-scanner-loop.js` 独立 setInterval 循环（每 30 分钟），在 `startTickLoop()` 接入。

**模式来源**：完全仿照既有模式：
- `harness-watchdog-loop.js`（2026-06-13 接回）
- `recovery-loop.js`（2026-06-27 接回）
- `pipeline-patrol-loop.js`（2026-06-27 接回）

**关键设计**：
- 独立 setInterval（不依赖 runScheduler 跑完，不被 circuit_open / no_goals 早 return 跳过）
- `scanEvolutionIfNeeded` 内部已有每日门控（working_memory），30 分钟间隔不会轰炸 GitHub API
- 两条（scan + synthesis）独立 try/catch，一条失败不影响另一条

## 代码变更

| 文件 | 改动 |
|------|------|
| `packages/brain/src/evolution-scanner-loop.js` | 新建：runEvolutionScanOnce / start/stop EvolutionScannerLoop |
| `packages/brain/src/tick-loop.js` | import + startEvolutionScannerLoop() + stopEvolutionScannerLoop() |
| `packages/brain/src/tick-runner.js` | 移除死代码调用（注释说明） |
| `packages/brain/src/__tests__/evolution-scanner-loop.test.js` | 新建：6 个测试 |
| `packages/brain/src/__tests__/tick-loop.test.js` | 新增 2 个回归断言 |

## 经验教训

**规律**：任何原先只挂在 `executeTick()` 的功能，在 Wave 2 之后都成了死代码。
修复这类功能时，必须放入独立 setInterval 循环，而不是放回 `executeTick()`。

**检查清单**（适用于所有新的 Brain 周期性功能）：
1. 不要把周期性任务放进 `executeTick()`（死代码）
2. 创建独立的 `*-loop.js` 文件
3. 在 `startTickLoop()` 接入
4. 在 `stopTickLoop()` 对称停止
5. 在 `tick-loop.test.js` 验证被接上

## 识别信号

以下 probe 错误 = scanner 不在活跃代码路径：
- `scanner_stale`（门控日期超过 2 天未更新）
- `last_scan=YYYY-MM-DD(Nd_ago)` 其中 N > 2
