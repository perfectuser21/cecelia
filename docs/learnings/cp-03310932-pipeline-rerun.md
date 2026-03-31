## content-pipeline /run 支持重新生成已完成的 pipeline（2026-03-31）

**分支**: cp-03310932-pipeline-rerun
**PR**: #1727

### 根本原因

`POST /api/brain/pipelines/:id/run` 端点对 `completed` 状态的 pipeline 直接返回 400，拒绝执行。
用户从前端点击「重新生成」时 pipeline 状态为 `completed`，触发此拦截，UI 显示「触发失败」。
`completed` 是最终状态，但并不意味着不可重跑，状态机设计未区分「终态」与「不可重入」两个概念。

### 下次预防

- [ ] 设计状态机时，区分「终态」（pipeline 完成）和「不可重入」（正在运行中），completed ≠ 不可重新触发
- [ ] 重跑逻辑应在端点入口处重置状态（queued），而不是直接拒绝
- [ ] 前端触发失败时，优先查 nginx 日志确认 HTTP 状态码，再定位是前端还是后端问题
