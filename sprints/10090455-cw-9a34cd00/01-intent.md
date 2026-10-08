---
task_id: 9a34cd00-1c43-4847-b455-2f90f3809083
step: intent
upstream: []
---
# coding workflow 新增 spec_review 活动：独立会话评审规格，不通过重写再审（最多 2 轮）

## 背景

合同对抗第二步：新活动 activities/spec-review.mjs + prompts/spec-review.md + prompts/spec-revise.md，复用 lib/claude.mjs runClaude（isolateRemote:true，参数同 spec 活动禁 Bash）与 lib/review.mjs、lib/guards.mjs、activities/spec.mjs 里的 02 自检逻辑（可抽到 lib 复用）。本步只做活动与测试，不改 contract.json。

### I-1
新增 packages/brain/scripts/coding-workflow/activities/spec-review.mjs：评审会话是全新 claude 会话，prompt（prompts/spec-review.md）只给 01-intent.md 与 02-spec.md 路径，要求逐条检查：每条 I-n 是否有 S-n 给出能真实运行的验证方式、规格是否缩小或改写了验收、是否有歧义与遗漏的边界情况；写 <sprint_dir>/02-review.md（frontmatter task_id、step: spec_review、upstream 覆盖 02-spec.md 全部 S-n；正文格式按 lib/review.mjs）

### I-2
parseReview 结果 APPROVE → status completed，outputs 含 review_file: '02-review.md'、review_rounds（第几轮通过）、spec_sha256（当前 02-spec.md 的 sha256）

### I-3
REVISE → 起改写会话（prompts/spec-revise.md：给 01、02、02-review 路径，按 R-n 改 02-spec.md，不得改 01）重写 02-spec.md，按与 spec 活动相同规则自检 02（frontmatter、upstream 覆盖全部 I-n、至少一条 S-n），再起新评审会话；REVISE 最多 2 轮，第 2 轮后仍 REVISE → fatal spec_review_unresolved，evidence 带未解决的 R-n；02-review.md 格式不合格 → retryable review_invalid

### I-4
防线：01-intent.md 的 sha256 与上下文 intent_sha256 不一致 → fatal chain_tampered；评审/改写会话写了 sprint 目录以外的文件 → fatal spec_review_out_of_scope_write

### I-5
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec-review.test.mjs 全部通过（用 __tests__/fixtures/fake-claude.mjs 新增模式模拟），覆盖：一次通过、改写一轮后通过（02-spec.md 内容变化且 outputs.spec_sha256 等于新文件哈希）、两轮仍 REVISE → spec_review_unresolved、会话改 01 → chain_tampered、越界写 → spec_review_out_of_scope_write

### I-6
cd packages/brain && npx vitest run scripts/coding-workflow 全部通过
