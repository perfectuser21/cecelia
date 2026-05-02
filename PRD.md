# PRD: brain-test-pyramid Layer 3 PR2 — Learning Loop 集成测试

## 目标
为知识留存 learning loop 添加集成测试：design-doc 日志持久化 + strategic-decision 创建 + decisions/match 召回。

## 背景
Brain 的知识留存路径：POST design-doc 记录学习 → POST strategic-decision 固化决策 → POST decisions/match 召回约束。此路径无集成测试，任何 DB 字段变更或 matchDecisions 逻辑修改都可能静默破坏知识检索。

## 成功标准
- design-doc POST/GET/list 全链路验证
- decision 创建后可被 matchDecisions 按 topic 关键词召回
- 参数校验返回 400
