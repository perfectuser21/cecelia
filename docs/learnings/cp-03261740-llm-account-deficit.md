# Learning: LLM 账号选择算法改进（进度对齐 Deficit 排序）

## 背景

原算法仅按当前使用率排序（最低优先），导致窗口即将到期的账号配额浪费。
新算法引入"进度对齐"（deficit）概念，优先使用落后于时间目标的账号。

### 根本原因

原 `selectBestAccountFromLocal`（executor.js）只读 `primary_window.used_percent`，
不考虑 `secondary_window`（7d）的时间窗口进度。原 `selectBestAccount`（account-usage.js）
虽然 DB 中已存 `seven_day_resets_at` 字段，但排序逻辑从未使用该字段，
导致无法感知各账号窗口的进度差异，造成配额利用率不均。

### 解决方案

Deficit 公式：`deficit = (elapsed/window_duration)*100 - actual_used_pct`

- elapsed = window_duration - reset_after_seconds（Codex）
- elapsed = now - (resets_at - 7d)（Claude Code，使用 DB 存储的 seven_day_resets_at）

两处均改为 deficit DESC 排序，5h 窗口保持 gate filter（>95% 跳过）。

## 实现细节

### Codex executor.js

```js
const fiveHourPct = data.rate_limit?.primary_window?.used_percent ?? 100;
if (fiveHourPct > 95) return null; // gate filter
const sw = data.rate_limit?.secondary_window;
const elapsedSecs = SEVEN_DAY_SECS - (sw?.reset_after_seconds ?? 0);
const deficit = (elapsedSecs / SEVEN_DAY_SECS) * 100 - (sw?.used_percent ?? 0);
// 排序：deficit DESC
```

### Claude Code account-usage.js

```js
const resetsAtMs = new Date(u.seven_day_resets_at).getTime();
const windowStart = resetsAtMs - SEVEN_DAY_MS;
const elapsedMs = now - windowStart;
const targetPct = Math.max(0, Math.min(100, (elapsedMs / SEVEN_DAY_MS) * 100));
const deficit = targetPct - sevenDayPct;
// 排序：deficit DESC, ePct ASC
```

## 下次预防

- [ ] 新增账号使用率相关排序时，应同时考虑时间窗口进度（不只看绝对用量）
- [ ] 账号选择算法变更时，需更新对应的单元测试期望值
- [ ] `seven_day_resets_at` 等已存字段如未使用，应在代码注释中说明原因
