# Learning: CI L1 动态化 — 读取 .dev-mode stage 按需检查

**分支**: cp-03211000-ci-l1-dynamic
**日期**: 2026-03-21
**类型**: feat (CI 改进)

## 变更摘要

在 ci-l1-process.yml 中添加 `detect-stage` job，根据 PR 分支中的 `.dev-mode` 文件判断当前开发 stage，按需跳过不相关的检查项。

## 关键决策

1. **向后兼容**：无 .dev-mode 文件时默认 stage=4（全量检查），确保老 PR 不受影响
2. **Stage 分级策略**：
   - Stage 1（Spec）：只跑分支命名 + Secrets Scan + CI Config Audit
   - Stage 2+（Code）：额外跑 DoD/Cleanup/PRD/Engine 检查
   - Stage 4（Ship）：额外跑 Learning 格式检查
3. **Gate job 的 stage-aware 判断**：l1-passed 中对因 stage 跳过的 job 使用 stage 数值判断，而非一律将 skipped 视为失败

### 根本原因

CI 不管 PR 在哪个 stage 都跑同样的全量检查。Stage 1（Spec 阶段）的 PR 会因为缺少 DoD 验证结果和 Learning 文件而全部失败，阻塞了整个开发流程。Pipeline 升级到 4-Stage 后 CI 没有同步适配。

### 下次预防

- [ ] Pipeline 升级时同步评估 CI 影响
- [ ] 在 CI workflow 中添加 stage 感知是基础设施层面的改动，应在 Pipeline 设计阶段就规划好
- [ ] GitHub Actions 中 outputs 是字符串类型，`>=` 比较在 `if:` 表达式中可以工作是因为 GitHub 会自动转换

## 技术细节

- `.dev-mode` 文件是开发过程的临时文件，通常不会提交到 git
- 对于自身不在 /dev 流程中的 PR（如手动创建的 PR），没有 .dev-mode 文件，默认走全量检查
- GitHub Actions `if` 表达式中的数字比较：outputs 是字符串，但 `>=` 运算符会自动将字符串转为数字进行比较
