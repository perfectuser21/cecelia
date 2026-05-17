# Learning: 孤立 initiatives 归档自救

**分支**: cp-03211749-ad7d9520-3ec9-4a19-9309-75fbcb
**日期**: 2026-03-22

## 问题描述

KR1/2/3 全部取消后，属于这些 KR 的三个 initiatives 仍保持 `paused` 状态，占用部门 dev slots，导致配额从 2/2 升至 5/2，heartbeat 调度循环无法为新目标分配资源，系统故障超过 15h。

### 根本原因

KR 取消时，Brain 只更新了 KR (goals 表) 的状态，未级联更新其下属 initiatives (projects 表) 的状态。`paused` 不是终态，仍被计入占用 slots。

### 修复操作

执行 migration 171：将三个孤立 initiatives 标记为 `archived`（系统认可的终态），同时写入 `metadata.archived_reason = 'parent_kr_cancelled'` 作为审计记录。

## 下次预防

- [ ] KR 取消时，Brain 应自动级联将其下所有非终态 initiatives 标记为 `archived`
- [ ] 终态定义：`completed`、`archived`、`cancelled` 不占用 slots
- [ ] `paused` 状态的 initiative 若其 KR 已取消，应在下次 heartbeat 中自动清理
- [ ] 添加监控：当 KR.status = 'cancelled' 且其下仍有 paused initiatives 时告警

## 影响

- 三个 initiatives 归档后，部门配额从 5/2 恢复至 2/2
- heartbeat 循环可以正常为新目标分配资源
