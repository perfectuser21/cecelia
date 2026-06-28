# LEARNINGS: PROBE_FAIL_EVOLUTION 修复记录

**分支**: cp-06281515-fix-evolution-v2  
**PR**: #3469  
**日期**: 2026-06-28

## 根因（双重）

### 根因 1：GitHub API 失败不更新门控 → 每 tick 重试 → rate limit → probe 永远 fail

`scanEvolutionIfNeeded` 的 `ghFetch` 调用没有 try-catch。当 GitHub API 失败时，函数直接 throw，`working_memory` 门控永远不更新。下一 tick 继续重试，继续失败，`component_evolutions` 表始终为空，probe 永远报 PROBE_FAIL_EVOLUTION。

**修复**：`ghFetch` PR 列表加 try-catch，API 失败时仍写入 `working_memory`（含 `error` 字段），防止每 tick 重试轰炸 GitHub API。

### 根因 2：scanner 被锁在 consciousness 守护块内 → consciousness=false 时永远不跑

`scanEvolutionIfNeeded` 之前包在 `if (isConsciousnessEnabled())` 块内。该函数是纯 GitHub API 扫描，不消耗 LLM token，不需要 consciousness 守护。一旦 consciousness 被禁用，scanner 永远不运行，probe 报 `scan=never`。

**修复**：将 `scanEvolutionIfNeeded` 移出 consciousness 守护块（`synthesizeEvolutionIfNeeded` 仍留在守护块内，因为它用 LLM）。

### 根因 3：首次扫描 / 长时间中断后无追溯 → 7 天窗口内始终为空

scanner 初始仅扫最近 2 天，首次运行或中断恢复后，`component_evolutions` 表为空，probe 失败。

**修复**：从 `working_memory` gate 推算 `lookbackDays`：
- 首次扫描（gate 为空）→ 30 天回溯
- 距上次扫描 >2 天 → `lookbackDays = min(daysSince+1, 30)` 填满空档

## probeEvolution 设计改进

修复前：`cnt=0` 时直接 `ok=false`，即使近期无 PR 合并（空闲态）也误报。

修复后区分四条路径：
- 7 天内有记录 → `ok=true`
- `cnt=0` + 扫描器 2 天内正常运行无错 → `ok=true`（`idle: no_merged_prs_in_window`）
- `cnt=0` + 扫描器从未运行 → `ok=false`（`scan=never`）
- `cnt=0` + 扫描器有 error / 超过 2 天未运行 → `ok=false`（`scan_error` / `scanner_stale`）

## 关键踩坑

1. **consciousness-tick-runtime 集成测试的 CONSCIOUSNESS_MOCKS**：移出 consciousness 守护后，`scanEvolutionIfNeeded` 不应出现在 `CONSCIOUSNESS_MOCKS` 数组里。最后一个提交修复了这个 mock 问题，否则 CI 测试会因 "spy called 1 time but expected 0" 失败。

2. **evolution-scanner.test.js 从 vitest exclude 中被排除**：vitest.config.js 把它排除了，需要移除排除规则让 CI 跑这个测试。

3. **ESLint `no-unused-vars`**：catch 块使用无参数写法 `catch { }` 而非 `catch (e) { }`。
