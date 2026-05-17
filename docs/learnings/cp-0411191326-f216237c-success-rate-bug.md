# Learning: 成功率虚报69% 根因分析与三连修

## 任务背景

Brain 报告任务成功率 69%，触发诊断告警循环。实际业务正常。

## 根本原因

### 根本原因 1：`getTaskStats24h()` 时间过滤逻辑错误

`total`/`failed`/`auth_failed` 的 filter 条件用了 `OR updated_at`：

```sql
AND (completed_at > NOW() - INTERVAL '24 hours' OR updated_at > NOW() - INTERVAL '24 hours')
```

`updated_at` 会被任何状态变更（如重试、暂停、恢复）刷新，导致大量**早于24小时前创建但被最近操作触碰过**的旧任务混入分母。只有 `completed_at` 才真正代表"在过去24小时内完成"。

### 根本原因 2：`pauseLowPriorityTasks` 未排除 content-pipeline

告警升级时，`pause_low_priority` 动作会暂停低优先级任务，但排除列表缺少 content-pipeline 相关类型，导致内容任务被误暂停。

### 根本原因 3：`branch-protect.sh` 正则只匹配8位时间戳

新的分支命名格式使用了 MMDDHHMMSS（10位）时间戳，但正则 `{8}` 只允许8位，导致分支被 branch-protect hook 拦截，无法在 worktree 中编辑代码。

## 修复方案

1. `self-drive.js`：`getTaskStats24h()` 去掉 `OR updated_at`，只用 `completed_at`
2. `escalation.js`：`pauseLowPriorityTasks` 排除列表新增 content-pipeline/content-research 等7个类型
3. `hooks/branch-protect.sh`（两处）：`{8}` → `{8,10}`

## 下次预防

- [ ] 时间范围 filter 只用终态时间戳（`completed_at`），不用可变字段（`updated_at`）
- [ ] 新增 task_type 时同步更新 `escalation.js` 的保护列表
- [ ] 分支命名格式变更时，第一步更新 branch-protect 正则
- [ ] 成功率指标有异动时，先查询分母构成，再判断是测量问题还是真实失败
