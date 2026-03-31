# Learning: pipeline orchestrator 存储 rule_scores/llm_reviewed + stages API 返回字段

分支: cp-03311215-pipeline-review-scores
日期: 2026-03-31

## 变更内容

- `content-pipeline-orchestrator.js`：`_executeStageTask` 存储 `rule_scores`、`llm_reviewed` 到 `tasks.payload` JSONB，并将 `execResult.llm_review` 对象统一映射为 `llm_reviewed: true`
- `routes/content-pipeline.js`：`/stages` API 的 SQL SELECT 新增 `rule_scores`/`llm_reviewed` 字段，response entry 中条件附加这两个字段

## 根本原因

`executeCopyReview`/`executeImageReview` 接入 callLLM 后开始返回 `rule_scores`/`llm_reviewed`/`llm_review` 字段，但 orchestrator 存储时只用了固定结构 `{ review_issues, review_passed }`，其余字段被丢弃。

stages API 的 SQL SELECT 语句只查询了已知字段，没有跟随 executor 的返回结构更新，导致新字段无法透传到前台。

此外 `executeImageReview` 返回的是 `llm_review` 对象（详细审查数据），而 `executeCopyReview` 返回 `llm_reviewed` 布尔值，命名不一致需要在 orchestrator 层统一映射。

## 下次预防

- [ ] executor 返回新字段时，同步检查 orchestrator 的 payload 写入逻辑是否覆盖了新字段
- [ ] executor 返回的字段名不一致（如 `llm_review` vs `llm_reviewed`）时，在 orchestrator 统一做映射，不要让差异传播到 API 层
