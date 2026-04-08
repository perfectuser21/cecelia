# Learning: CI 绿灯率 KR 卡死 33% 的两个根因

**Branch**: cp-04080846-abc1d1bd-2365-4d3c-ac8b-6bb545  
**Date**: 2026-04-08

---

### 根本原因

**根因 1 — kr-verifier.js `$3` 类型推断失败**  
`jsonb_build_object('metric_current', $3)` 中 `$3` 为 JavaScript `String(currentValue)` — PostgreSQL 在 `jsonb_build_object` 的值参数位置无法自动推断 text 类型，抛出 `could not determine data type of parameter $3`。  
结果：UPDATE key_results 失败，KR current_value 永远停留在旧值（33），而 kr_verifiers 里 current_value 已更新到 50，两表不一致。

**根因 2 — shepherd.js 遗漏 pr_status=NULL 的任务**  
Shepherd 只扫描 `pr_status IN ('open', 'ci_pending')`，pr_url 已设但 pr_status 为 NULL 的任务（任务在 PR 创建时未先设置 'open'）不会被跟踪。结果：PR #1904、#1896 实际已 merged 但 pr_status=NULL，拉低了 KR verifier 的 merge rate 指标。

---

### 下次预防

- [ ] kr-verifier.js 中所有传给 PostgreSQL 的不确定类型参数，在 SQL 里加显式 cast（`$2::text`、`$2::numeric` 等）
- [ ] 任务创建 PR 时必须同时把 pr_status 置为 'open'，确保 shepherd 能接手
- [ ] 新增 shepherd：也扫描 `pr_status IS NULL AND pr_url IS NOT NULL`，兜底没有初始化状态的 PR
- [ ] kr_verifiers last_error 不为空时告警 — 当前错误静默，需要巡检发现
