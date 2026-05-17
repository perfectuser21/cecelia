# Learning: KR Verification 闭环 — 防止进度虚报

分支: cp-03212146-kr-verifier-system
日期: 2026-03-21

## 变更内容

- 新建 kr_verifiers 表：每个 KR 绑定一个 SQL 查询自动采集指标
- 新建 kr-verifier.js：运行 SQL 查询，用公式计算 progress
- 堵死 decision-executor.js 的 update_okr_progress 直接写 progress
- tick.js 集成：每小时运行 verifier

### 根本原因

所有 10 个 KR 显示 progress=100%，但实际指标全是 0（发布 0 条、汇报 1 次、自修 0 次）。原因链：
1. initiative-closer.js 只数 task 状态，1-2 个 task 完成就标 Initiative completed
2. Project 所有 Initiative completed → Project completed
3. kr-progress.js 数 Initiative 完成率 → 100%
4. 丘脑 update_okr_progress action 能直接写 progress 值，绕过一切

核心问题：Activity-driven（数完成数）而非 Metric-driven（看指标值）。行业最佳实践（Google/Amazon）要求 KR 进度基于不可伪造的外部指标。

### 下次预防

- [ ] 新增 KR 时必须同时创建 kr_verifier，否则 decomp-check 应 reject
- [ ] 任何写 goals.progress 的代码路径都要审查是否绕过了 verifier
- [ ] 定期检查 kr_verifiers.last_error，确保查询没有静默失败
