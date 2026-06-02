# Learning: GAN 移除强制收敛 + 新增 Pipeline 进度百分比端点

### 根本原因
1. GAN forced-approval 是 Proposer 漂移的应急阀，不是真正的收敛——Proposer 每轮改动超出 Reviewer feedback 范围，导致振荡无法自然收敛
2. Pipeline 进度只能靠 Brain 日志推断，没有 API 接口给 Dashboard 消费

### 下次预防
- [ ] Proposer B52 精简纪律（每轮只改 Reviewer 明确指出的内容）是防振荡的真正根因修复
- [ ] `detectConvergenceTrend` 保留诊断日志（DIAG 级别），不再 force APPROVED
- [ ] `GET /api/brain/harness/runs/:id/progress` 端点可供 Dashboard 轮询显示百分比
- [ ] NODE_PCT_MAP 节点顺序与 LangGraph 图节点名称一一对应，增加新节点时同步更新
