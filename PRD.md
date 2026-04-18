# PRD: Brain 区分进程健康 vs 系统全局内存压力

## 背景

Brain 用系统全局 `memory_available_mb` 决定是否派任务。在多 session / 多 app 的开发机上任何其他软件吃内存都会让 Brain 停派（`slot_budget.dispatchAllowed=false`），形成"Brain 被环境勒索"。

实测：
- Brain 进程（重启后）RSS = **631MB**（正常基线）
- 本机 Mac 16GB，used 15.2GB（95.3%）是多 claude session + Virtualization.framework + mds_stores 吃掉的
- `memory_available_mb=274 < threshold=600` → Brain 停派

Brain 不是泄漏方，是受害者。

## 成功标准

- Brain RSS 正常（< 1.5GB）+ 系统内存低 → 继续派，只发 warn log
- Brain RSS 超 1.5GB → halt 停派（真泄漏）
- 系统阈值按硬件比例动态：`max(600MB, totalMem * 5%)`
- 新增 `evaluateMemoryHealth()` helper 返回 `{brain_memory_ok, system_memory_ok, action: 'proceed'|'warn'|'halt'}`
- 两处接入点（`checkServerResources`、`getBackpressureState`）都走新 helper
- 单测覆盖 4 种组合
