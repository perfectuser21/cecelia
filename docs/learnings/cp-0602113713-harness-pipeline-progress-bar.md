# Learning: Harness Pipeline 进度条加到 Dashboard

### 根本原因
`GET /api/brain/harness/runs/:id/progress` 端点已上线（B52），但前端没有任何组件消费它，用户在 Dashboard 看不到进度。

### 下次预防
- [ ] 后端新增端点时同步评估是否需要前端展示，当天一起做
- [ ] `PipelineProgressBar` 只在 `status === 'in_progress'` 时挂载轮询，避免已完成任务产生多余请求
- [ ] `NODE_LABEL` 映射与 Brain 端点的 `NODE_PCT_MAP` 节点名保持一致，两处同步修改
