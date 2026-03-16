---
id: learning-cp-03161710-verify-coverage-delta
version: 1.0.0
created: 2026-03-16
branch: cp-03161710-verify-coverage-delta
---

# Learning: 验证 coverage-delta CI job 行为

## 任务背景

创建最小化 feat Brain PR（新增 formatDuration 工具函数），观察 coverage-delta CI job 的实际行为。

## 根本原因

此次 Learning 记录的是 coverage-delta job 的观察结果，而非 bug 修复。

### CI 观察结果

- L1 Process Gate：需要 Learning 文件（本文件）和 DoD 已勾选条目
- DoD Verification Gate：`manual:ls` 命令需要 evidence 文件或改用 inline node 命令验证文件存在性
- coverage-delta job 状态：待 CI 完成后补充

### 关键发现

1. `[ARTIFACT]` 类型的 DoD 条目如果用 `manual:ls` 作为 Test，CI 要求配套 evidence 文件
2. 正确的文件存在性检查方式：`manual:node -e "require('fs').existsSync(...)..."`
3. Learning 文件必须在 push 前就创建好（CRITICAL: PR push 前必须有 Learning）

## 下次预防

- [ ] 在 Step 2 写代码时就创建 Learning 文件框架
- [ ] `[ARTIFACT]` 条目避免用 `ls` 命令，改用 node fs.existsSync 或 `! grep -q` 等
- [ ] push 前本地运行 `check-dod-mapping.cjs` 验证格式
