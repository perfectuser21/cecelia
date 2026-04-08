# Learning: SelfDrive 任务成功率统计 Bug 修复

**分支**: cp-04080128-a4df60a9-94b4-4ca9-8cce-bf1b04
**日期**: 2026-04-08

### 根本原因

`routes/stats.js` 的 `GET /dev-success-rate` API 成功率分母计算错误，导致 39.7% 虚报（实际终态成功率 64%）：

1. **`canceled`（美式拼写）未排除** — 20 个 dev 任务留在分母但既不是 success 也不是 failure
2. **`paused` 未排除** — 20 个暂停任务拉低分母
3. **`queued`/`in_progress` 未排除** — 6 个未完成任务计入分母
4. **`failure_reasons` 分类全为 `other`** — `classifyFailureReason` 只读 `metadata->>'failure_reason'`，但 watchdog kills 的错误在 `error_message` 字段

### 下次预防

- [ ] 新增状态类型时，同时更新 `isExcludedStatus()` 逻辑
- [ ] 成功率统计应只计算"终态"任务（completed + failed/quarantined），不包含 in-flight 任务
- [ ] 失败分类函数应同时读取 `metadata->>'failure_reason'` 和 `error_message`
- [ ] `error_message` 优先于 `failure_reason`（watchdog kills 在 error_message，业务失败在 failure_reason）
