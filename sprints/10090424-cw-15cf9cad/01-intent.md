---
task_id: 15cf9cad-f2a6-4e03-bb67-f2add83afecc
step: intent
upstream: []
---
# coding workflow 规格评审文档解析 lib/review.mjs

## 背景

合同对抗第一步：给 spec_review 活动准备 02-review.md 的解析与判定纯函数。

### I-1
新增 packages/brain/scripts/coding-workflow/lib/review.mjs，导出 parseReview(text, { specIds, intentIds }) 返回 { verdict, issues, errors }：02-review.md 正文含一行 `verdict: APPROVE` 或 `verdict: REVISE`（不区分大小写，字段行可带 markdown 加粗）；每个问题是 `### R-n` 小节，小节内一行 `针对: <S-n 或 I-n，可多个，逗号分隔>`，其余为问题描述（非空）

### I-2
parseReview 判定：缺 verdict 或 verdict 非法 → errors 含 verdict_missing / verdict_invalid；REVISE 但没有任何 R-n → errors 含 issues_missing；R-n 缺 针对 或描述为空 → errors 含 R-n:target_missing / R-n:body_empty；针对 的 ID 不在 specIds ∪ intentIds 里 → errors 含 R-n:target_unknown:<ID>；APPROVE 允许带 R-n（作为建议，不影响通过）

### I-3
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/review.test.mjs 全部通过，覆盖上述每种情况

### I-4
cd packages/brain && npx vitest run scripts/coding-workflow 全部通过
