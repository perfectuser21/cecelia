## Sprint Report 自动生成（2026-03-31）

### 根本原因

/dev Pipeline 的三角对抗机制（Planner/Generator/Evaluator）执行完毕后，所有过程数据都是临时的：seal 文件留在本地、Learning 只记录结论、用户无法事后查看"经历了几轮对抗、最终合同是什么"。核心问题是**过程无留痕**——机制有效果，但效果不可见。

### 下次预防

- [ ] Sprint Report 必须在第一次 push **之前**生成并 add 进 commit；顺序铁律：generate → git add → git push
- [ ] DoD 测试中用 `indexOf` 验证顺序而非仅 `includes` 检查存在性——顺序语义更强
- [ ] 脚本中如需引用命名约定（如 `.seal` 文件），在代码注释中使用精确字面量（`.seal`），确保测试断言能匹配
- [ ] Sprint Contract 第一轮产生分歧（WARNING）是正常的——Evaluator 提出更严格检查属于有价值的独立观点，需要 Generator 第二轮修正才能收敛
