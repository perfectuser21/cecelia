# Brain 被环境勒索停派 — Memory Health Evaluator

## PIVOT 记录

原假设：Brain 有内存泄漏，RSS 涨到 449MB+ 触发 `memory_available_mb < 600` → `dispatchAllowed=false`。

实测推翻：
- Brain 进程（重启后）RSS = **631MB**（正常基线，不是泄漏）
- 本机 Mac 16GB，当前 used 15.2GB（95.3%）
- 真正吃内存：多个 claude session（~1.7GB）+ Virtualization.framework 628MB + mds_stores 597MB 等系统进程
- `memory_available_mb=274 < threshold=600` → `slot_budget.dispatchAllowed=false`（间歇）→ Brain 停派
- **Brain 不是泄漏方，是受害者**

## 根本原因

Brain 用系统全局 `os.freemem()` / `memory_available_mb` 决定是否派任务。在多 session / 多 app 的开发机上，任何其他软件吃内存都会让 Brain 停派——"Brain 被环境勒索"。

两个 halt 路径：

1. `packages/brain/src/executor.js:checkServerResources()` — `freeMem < MEM_AVAILABLE_MIN_MB` 时 `effectiveSlots=0`，整个资源检查返回 `ok:false`
2. `packages/brain/src/slot-allocator.js:getBackpressureState()` — `memory_available_mb < MEMORY_PRESSURE_THRESHOLD_MB` 时 `memory_pressure=true` → `active=true` → 降 burst limit

两者都只看系统全局，不区分 Brain 自己 RSS 健康还是系统噪声。

## 修复方案

新增 `evaluateMemoryHealth()` helper（`packages/brain/src/platform-utils.js`），返回三态 action：

- `proceed` — Brain OK + 系统 OK
- `warn` — Brain OK + 系统低（只 warn log，**不停派**）
- `halt` — Brain RSS > 1.5GB（真泄漏）

阈值：
- `BRAIN_RSS_DANGER_MB = 1500`（真泄漏）
- `BRAIN_RSS_WARN_MB = 1000`（警告但继续派）
- 系统阈值动态：`max(600MB floor, totalMem * 5%)` — 16GB Mac → 819MB；4GB VPS → 600MB

两处接入点都改：
- `executor.js:checkServerResources()` — 系统内存低但 Brain 正常时把 memPressure 封顶 0.6（保守缩容但不清零 effectiveSlots）
- `slot-allocator.js:getBackpressureState()` — `memory_pressure` 只在 Brain 自己 RSS 越 danger 线时为 true

## 场景表格（Before vs After）

| Brain RSS | 系统 available | 旧行为 | 新行为 |
|-----------|---------------|--------|--------|
| 631MB     | 274MB         | `dispatchAllowed=false`（停派） | `action=warn`，继续派 |
| 500MB     | 2000MB        | OK | OK |
| 1600MB（真泄漏） | 8000MB | OK（漏了） | `action=halt`，停派 |
| 2000MB    | 200MB         | 停派 | `action=halt`，停派 |
| 1200MB    | 8000MB        | OK | `action=warn`，继续派 |

## 根本原因

Brain 资源调度把"系统全局可用内存"当成自身健康指标，忽视了多应用开发机上其他进程噪声正常。应区分 Brain 进程 RSS（真泄漏信号）vs 系统可用内存（环境噪声）。

## 下次预防

- [ ] 新增"Brain 是受害者还是凶手"判断：任何以 `os.freemem()` / 系统内存决定 Brain 动作的地方，都应同时读 Brain 自己 `process.memoryUsage().rss`
- [ ] 阈值按硬件比例动态：固定 MB 在 16GB Mac vs 4GB VPS 含义不同
- [ ] warn vs halt 分两级：系统低但 Brain 正常 → warn；Brain 自己越线 → halt
- [ ] Alertness metrics.js 已经用 `process.memoryUsage().rss`，watchdog.js 监控任务子进程 RSS，两处是对的；今后新加内存相关代码按此模板

## 其他嫌疑（未修复，做成 follow-up）

- `slot-allocator.js` MEMORY_PRESSURE_THRESHOLD_MB=600 现在只作 system floor 参数；余下 burst limit 逻辑未碰
- `watchdog.js` RSS_KILL_MB 用 `totalMem * 0.35` 动态计算，已经是比例式，无需改
- `alertness/metrics.js` Brain 自身 memory 阈值 normal=150MB 偏低（Brain 基线 631MB 永远 danger），但那是告警系统、不是派发门禁，不影响本 PR 目标
