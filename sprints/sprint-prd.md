# Sprint PRD

## 产品目标

验证 Harness v4.0 pipeline 全阶段端到端自动运行能力：从 planner 接受需求，经过 GAN 对抗合同生成，到 generator 实现、CI 监控、evaluator 评估、auto-merge 合并，最终 deploy_watch 部署监控并输出报告——整个流程无需人工干预，PR 自动合并到 main。

目标用户：Cecelia 系统运维者，验证 Harness 自驱能力是否具备生产可用性。

## 功能清单

- [ ] Feature 1: Pipeline 全链路自动触发 — planner 完成后自动激活 GAN 阶段，每阶段完成自动触发下一阶段，无需人工点击
- [ ] Feature 2: GAN 对抗合同生成 — Proposer 与 Reviewer 完成至少一轮对抗，产出经审查批准的 sprint-contract.md
- [ ] Feature 3: Generator 自动实现 — 读取批准合同，自动生成代码变更并推送 PR
- [ ] Feature 4: CI 监控自动等待 — ci_watch 阶段等待 GitHub Actions 全部通过，CI 失败时上报并阻断
- [ ] Feature 5: Evaluator 自动评分 — 按合同验收标准逐条评估 PR，输出通过/失败结论
- [ ] Feature 6: Auto-merge 自动合并 — evaluator 通过后，PR 自动合并到 main，无需人工 review
- [ ] Feature 7: Deploy watch 自动监控 — 合并后监控部署状态，确认服务健康
- [ ] Feature 8: Report 自动输出 — 全流程完成后生成完整报告，记录每阶段耗时和结论

## 验收标准（用户视角）

### Feature 1: Pipeline 全链路自动触发
- 用户触发 planner 后，无需任何手动操作，Brain 自动创建并派发后续所有阶段任务
- 用户在 Brain 任务列表中可以看到每个阶段的状态更新

### Feature 2: GAN 对抗合同生成
- sprint-contract.md 文件出现在 sprints/ 目录，状态标记为 APPROVED
- 合同中包含具体的功能描述和验收命令

### Feature 3: Generator 自动实现
- GitHub 上出现一个新 PR，包含代码变更
- PR 描述与 sprint-contract.md 中的目标一致

### Feature 4: CI 监控自动等待
- PR 上的所有 CI checks 变为绿色后，pipeline 自动继续
- CI 失败时，用户收到告警，pipeline 暂停（不自动重试）

### Feature 5: Evaluator 自动评分
- sprints/ 目录下出现评估报告，包含每条验收标准的通过/失败状态
- 所有标准通过时，evaluator 输出 PASS 结论

### Feature 6: Auto-merge 自动合并
- PR 在 evaluator PASS 后 5 分钟内自动合并到 main
- 合并后 PR 状态变为 merged，无 "waiting for review" 状态

### Feature 7: Deploy watch 自动监控
- 合并后系统自动检查 Brain 服务健康状态（/api/health）
- 服务健康时，deploy_watch 标记为 SUCCESS

### Feature 8: Report 自动输出
- sprints/sprint-report.md 更新，包含本次运行的完整记录
- 报告包含：总耗时、各阶段耗时、GAN 对抗轮次、最终结论

## AI 集成点

- GAN 阶段：Proposer（Generator）和 Reviewer（Evaluator）均为独立 AI Agent，对抗轮次无上限直到合同批准
- Evaluator：AI 读取合同验收标准，机械执行验证命令，不主观判断

## 不在范围内

- 不验证多并发 pipeline 场景（本次只跑单条链路）
- 不测试 CI 失败后的自动修复（只验证绿灯路径）
- 不改变 Harness 现有架构（只验证，不重构）
- 不包含 rollback 机制验证
