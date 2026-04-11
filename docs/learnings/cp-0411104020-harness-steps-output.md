# Learning: Harness Pipeline Steps Output 修复

**Branch**: cp-0411104020-94216efa-5894-4173-a590-389c93

### 根本原因

`getStepOutput` 函数对 `harness_generate` 类型的处理放在 `!branch` 早退逻辑之后，但 generate 任务的 result 里只有 `pr_url` 和 `pr_number`，没有 branch 字段，导致 `getResultBranch` 返回 null 进入早退路径，最终返回 null 而非 PR URL。

Review 类型的 APPROVED 结果只有 `Verdict: APPROVED`（17 chars < 50），因为 `contract-review-feedback.md` 不存在于 review_branch，且没有 fallback 到 `contract_branch` 读取最终合同内容。

### 下次预防

- [ ] 对 generate/fix 类型应优先检查 `pr_url` 字段，不依赖 `getResultBranch`
- [ ] review 类型 APPROVED 时，应 fallback 到 `contract_branch` 读取 sprint-contract.md 作为输出证据
- [ ] `getStepOutput` 的类型分支应在 `!branch` 早退之前处理有已知 output 路径的类型
