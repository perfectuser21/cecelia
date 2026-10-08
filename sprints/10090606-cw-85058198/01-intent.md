---
task_id: 85058198-8234-4e6e-91b5-7e9365fc0805
step: intent
upstream: []
---
# coding workflow PR 描述写入规格评审结论

## 背景

coding 链新增了 spec_review 活动（产出 02-review.md，上下文有 review_file、review_rounds）。publish 活动开 PR 时，PR 描述里还没有评审结论，看 PR 的人不知道规格经过几轮评审、评审提了什么。

### I-1
packages/brain/scripts/coding-workflow/activities/publish.mjs 生成的 PR 描述在上下文含 review_file 时新增「规格评审」小节：写明评审轮数（review_rounds）与最终 verdict，并列出 02-review.md 里每个 R-n 的一行摘要（针对的 ID + 描述首行）；上下文没有 review_file 时不出现该小节

### I-2
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/publish.test.mjs 全部通过，并新增测试覆盖有 review_file（含 2 条 R-n）与无 review_file 两种情况

### I-3
cd packages/brain && npx vitest run scripts/coding-workflow 全部通过
