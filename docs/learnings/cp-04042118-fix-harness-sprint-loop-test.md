### 根本原因

`harness-sprint-loop.test.js` 第 239、241 行对 task-router.js 的断言写死了 `/sprint-generator`，但 task-router.js 实际实现是将 `sprint_generate` 和 `sprint_fix` 路由到 `/dev`（Generator 用 /dev 全流程），只有 `sprint_evaluate` 路由到 `/sprint-evaluator`。测试编写时引用了过时或错误的设计文档，导致 CI 测试与代码实际行为不一致。

### 下次预防

- [ ] sprint_* 任务类型路由定义以 task-router.js 为 SSOT，写测试前先读代码
- [ ] executor.js skillMap 注释明确说明 sprint_* 在 preparePrompt() 中提前处理，避免误导
- [ ] Harness 流程图/文档中明确标注：Generator = /dev，Evaluator = /sprint-evaluator
