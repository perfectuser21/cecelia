---
task_id: 7aebfb3c-4349-415b-b535-fd474d26fdb3
step: intent
upstream: []
---
# coding workflow 契约接入 spec_review：intent→spec→spec_review→build→…

## 背景

合同对抗第三步：把 spec_review 活动接进契约与链校验，让之后每条 coding 任务都先过规格评审。

### I-1
packages/brain/scripts/coding-workflow/contract.json 新增 spec_review 活动（entry activities/spec-review.mjs，phase source，budget max_duration_s 1800，max_attempts 1），顺序为 intent、spec、spec_review、build、verify、chain_check、publish、report，failure 声明包含该活动实际会报出的全部 reason_code

### I-2
lib/md-chain.mjs 链定义加入 02-review.md（step spec_review，upstream 必须覆盖 02-spec.md 全部 S-n）；chain_check 活动在上下文有 review_file 时把它纳入校验

### I-3
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/contract.test.mjs scripts/coding-workflow/__tests__/e2e-contract.test.mjs 全部通过，其中端到端用例八个活动全部 completed，PR 文件里含 02-review.md

### I-4
cd packages/brain && npx vitest run scripts/coding-workflow src/__tests__/activity-contract-sync.test.js 全部通过
