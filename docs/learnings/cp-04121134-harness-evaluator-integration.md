# Learning — cp-04121134-harness-evaluator-integration

**Branch**: cp-04121134-harness-evaluator-integration
**Task**: Harness Pipeline 加入 Evaluator 步骤

### 根本原因

原架构决策（2026-04-09）砍掉独立 Evaluator，用 CI 替代。但 CI 只能跑预定义命令（文件检查），无法做运行时验证（启动服务、调 API、打开页面）。导致 Pipeline 产出的代码经常无法在生产环境使用——Brain 没重启、Dashboard 没部署、API 返回结构不符预期。

Anthropic 官方设计中 Evaluator 使用 Playwright MCP 与运行中的应用交互，是独立于 Generator 的对抗性 QA Agent。

### 下次预防

- [ ] Evaluator 和 CI 是互补关系（CI=代码质量，Evaluator=功能交付），不能用一个替代另一个
- [ ] 合同验收标准用 Given-When-Then 自然语言，不写 bash 命令；怎么验由 Evaluator 运行时决定
- [ ] fix 循环设上限（3 轮），超限标记 needs_human_review
