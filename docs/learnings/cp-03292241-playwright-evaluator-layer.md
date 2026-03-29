# Learning: Playwright Evaluator Layer

**PR**: #1678
**分支**: cp-03292241-playwright-evaluator-layer
**日期**: 2026-03-29

## 变更摘要

在 /dev Stage 3（CI 通过后、Stage 4 Ship 之前）增加 Playwright Evaluator subagent 步骤，从 Task Card 提取 [BEHAVIOR] 条目并执行端到端验证。

## 技术决策

- Evaluator 作为 devloop-check.sh 的条件 4.5 插入，位于 CI 通过（条件 4）和 PR 合并检查（条件 5）之间
- 沿用 spec_review / code_review_gate 的 seal 文件防伪模式（.dev-gate-evaluator.{branch}）
- Brain 不可达时跳过在线验证（CI 环境无 Brain），不算失败

### 根本原因

Pipeline 在 CI 通过后直接进入 Stage 4 Ship，缺少端到端行为验证层。
CI L1-L4 只检查代码质量、格式、类型安全和 RCI 覆盖率，无法验证功能是否在运行时真正可用。
这意味着通过 CI 的代码可能在 Brain API 或 Dashboard 层面存在未被发现的行为缺陷。
Playwright Evaluator 填补了这个缺口：从 Task Card 提取 [BEHAVIOR] 条目，逐条生成 curl/node 验证脚本并执行，确保行为层面的正确性。

### 下次预防

- [ ] DoD Test 字段中引用代码内容时，用实际存在的字符串做 indexOf，不要用正则模式字面量（如 `pr_state.*merged`）
- [ ] Learning 文件必须在第一次 push 前就创建，不能等 CI 提醒
- [ ] 新增 devgate 脚本时立即添加 RCI 条目，避免 L2 失败
- [ ] 测试文件路径在 DoD 中用 `manual:node -e` 格式而非 `tests/` 路径引用（CI 白名单限制）
