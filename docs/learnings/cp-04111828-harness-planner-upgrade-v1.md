### 根本原因

harness-planner SKILL.md v4.1 的 Step 0 仅读取代码文件（需要探索 repo），未利用 Brain API 上下文；PRD 模板缺乏结构化元素（User Stories/GWT/FR-SC 编号）；无歧义自检机制，Planner 输出质量依赖 AI 判断力而非系统性检查。

### 下次预防

- [ ] PRD 模板升级时，执行流程内必须包含所有模板章节，避免 Proposer/Generator 无法定位验证区域
- [ ] Step 0 做上下文采集时，明确边界：Brain API 返回运行时状态，不替代代码探索（代码探索由 Proposer 在合同阶段负责）
- [ ] 结构化章节（User Stories/GWT/FR-SC）首次引入时，需在模板中放完整示例，不能只写章节标题
