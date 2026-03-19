# Learning: 质检报告上传 Brain dev-logs API

## 分支
cp-03192200-report-upload-brain

## 变更摘要
在 generate-report.sh 末尾添加 curl POST 上传质检报告到 Brain dev-logs API，实现质检数据集中存储和趋势分析。

### 根本原因
generate-report.sh 生成的 JSON 质检报告只存储在本地 `.dev-runs/` 目录，Brain 虽然有 `dev_execution_logs` 表和 `/api/brain/dev-logs` POST 端点，但从未被调用。导致质检数据分散在各个 worktree/agent，无法集中分析成功率和失败分布。

### 下次预防
- [ ] 新增 API 端点时，同步在调用方添加集成代码
- [ ] 数据流闭环检查：数据生产方（generate-report）和消费方（Brain API）必须在同一个 PR 中打通
- [ ] 非阻塞集成模式：外部服务调用一律加 --max-time 和 warning-only 错误处理
