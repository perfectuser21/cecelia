# Task Card: fix-contract-branch-recovery

## 任务 ID
cp-0411195530-fix-contract-branch-recovery

## 标题
fix(brain): harness pipeline contract_branch=null 自动恢复

## 问题描述
`packages/brain/src/routes/execution.js` 中，`harness_contract_review` 完成且
verdict=APPROVED 时，若 Reviewer session 输出不完整导致 `contractBranch=null`，
代码直接 `console.error` + `return`，Generator 不会被创建，Pipeline 彻底终止，
必须人工干预。

## 根本修复
当 `contractBranch=null` 时，不要终止，改为自动 fallback：
1. 从 `task_id` 取前 8 位（`task_id.split('-')[0]`）
2. 用 `git ls-remote origin` 检查是否存在 `cp-harness-review-approved-{taskIdShort}` 分支
3. 若找到，用该分支名作为 contractBranch 继续创建 Generator
4. 若找不到，再终止并记录详细错误

## 影响范围
- `packages/brain/src/routes/execution.js`（第 1866-1869 行附近）
- 新增测试文件：`packages/brain/src/__tests__/harness-contract-branch-recovery.test.ts`
