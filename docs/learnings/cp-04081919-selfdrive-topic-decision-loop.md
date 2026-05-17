# Learning: 选题决策闭环引擎 MVP

**Branch**: cp-04081919-13a53b05-35a7-40d3-8554-92eced  
**Date**: 2026-04-08

## 做了什么

为现有的 topic 选题系统补充了"闭环"能力：

1. `migrations/231` — `topic_suggestions` 加 `rejection_reason TEXT` 字段
2. `topic-gap-analyzer.js` — 分析近 7 日 content-pipeline tasks 的内容类型分布，识别产出偏少的类型
3. `topic-selector.js` — `generateTopics()` 注入 gap 信号，引导 LLM 优先补充欠缺类型
4. `topic-suggestion-manager.js` — `rejectSuggestion()` 新增 `reason` 参数，将拒绝原因存入 DB
5. `routes/topics.js` — `POST /reject` 接收 `rejection_reason`；新增 `GET /analytics` 返回通过率

### 根本原因

系统已能生成选题、让人工审核，但缺少：
- 拒绝原因的记录（没有字段）
- 内容类型偏向的自动识别（没有 gap 分析）
- 审核通过率的可查询统计（没有 analytics 端点）

三者缺失导致"闭环"断路：每日选题没有从历史审核结果学习。

### 下次预防

- [ ] 新增选题信号时，先问"现有数据结构是否支持存储这个信号"，缺字段则先加迁移
- [ ] gap 分析的"均衡阈值"（当前 80%）可能过于宽松，下次可根据实际通过率调整
- [ ] `rejection_reason` 存入 DB 后，下一步应在 `topic-selector.js` 的 Prompt 里注入"近期被拒绝的原因"，形成完整的 avoid 信号（本次 MVP 未做）
