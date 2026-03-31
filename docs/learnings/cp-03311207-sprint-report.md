## Sprint Report 自动生成（2026-03-31）

### 根本原因

/dev Pipeline 的三角对抗机制（Planner/Generator/Evaluator）执行完毕后，所有过程数据都是临时的：seal 文件留在本地、Learning 只记录结论、用户无法事后查看"经历了几轮对抗、最终合同是什么"。核心问题是**过程无留痕**——机制有效果，但效果不可见。

Sprint Contract 轮次、分歧点、Planner 隔离情况等关键质量指标在 PR 合并后无法复查，导致机制改进缺乏数据支撑。

PR `dirty` 状态（合并冲突）会阻止 GitHub Actions 的 `pull_request` 事件触发，导致 CI 完全不运行——表象是"CI 不触发"而非"CI 失败"，容易被误判为 GitHub 系统问题。

### 下次预防

- [ ] Sprint Report 必须在第一次 push **之前**生成并 add 进 commit；顺序铁律：generate → git add → git push
- [ ] DoD 测试中用 `indexOf` 验证顺序而非仅 `includes` 检查存在性——顺序语义更强
- [ ] 脚本中如需引用命名约定（如 `.seal` 文件），在代码注释中使用精确字面量（`.seal`），确保测试断言能匹配
- [ ] Sprint Contract 第一轮产生分歧（WARNING）是正常的——Evaluator 提出更严格检查属于有价值的独立观点，需要 Generator 第二轮修正才能收敛
