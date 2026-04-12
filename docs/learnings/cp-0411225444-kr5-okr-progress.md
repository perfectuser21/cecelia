# Learning: KR5 Live Monitor OKR 进度 0% Bug

**分支**: cp-0411225444-f0828f8f-15fa-404d-b9c5-7f7ce4
**日期**: 2026-04-12

## 根本原因

`/api/brain/goals` 端点返回的数据中：
- `objectives` (area_okr) 无 `progress` 字段（DB 表无此列）
- `key_results` (area_kr) 有 `current_value` 和 `target_value`，但无 `progress` 字段

前端用 `g.progress ?? 0` 导致所有 OKR 进度显示 0%。

同时，活跃 KR 计数过滤用 `in_progress|ready` 但实际 KR 状态是 `active`，导致显示 "0 活跃 KR"。

## 下次预防

- [ ] 写 Live Monitor OKR 相关代码时，先 `curl localhost:5221/api/brain/goals` 确认字段名（`current_value` 而不是 `progress`）
- [ ] Brain goals API 返回的 KR status 枚举是 `active/completed/archived`，不是 `in_progress/ready`
- [ ] area_okr 无 `progress` 字段，需从子 KR 的 `current_value` 聚合（无 `target_value` 时 `current_value` 直接是百分比）
