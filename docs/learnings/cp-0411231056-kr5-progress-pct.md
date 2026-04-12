# Learning: KR 进度显示错误 — progress_pct 字段缺失

**分支**: cp-0411231056-f0828f8f-15fa-404d-b9c5-7f7ce4
**日期**: 2026-04-12

### 根本原因

`key_results` 表有两种进度数据：
- `current_value`：实际计量值（如"5条内容"、"9条内容"），不是百分比
- `progress`：手动设置的真实进度百分比（100% for KR1/KR2）

`task-goals.js` 的 `KR_SELECT` 没有暴露 `progress` 列（即 `progress_pct`），只暴露了 `current_value`。前端 PR #2269 修复 OKR 进度时假设"无 target_value 时 current_value 直接为百分比"，但 KR1/KR2 的 current_value 是发布条数（5/9），不是百分比，导致显示 5% 和 9% 而非正确的 100%。

受影响页面：LiveMonitor（OKR 总览区域）、Roadmap（KR 进度条）

### 下次预防

- [ ] `/api/brain/goals` 端点需要同时返回 `progress_pct`（已修复）
- [ ] 写涉及 KR 进度的代码前先检查：`key_results` 有三个进度相关字段：`current_value`（原始值）、`target_value`（目标值）、`progress`（手动百分比）。正确优先级：`progress` > `current_value/target_value` > 0
- [ ] `/api/brain/okr/current` 已正确计算 progress_pct，可作为参考标准验证前端显示是否正确
