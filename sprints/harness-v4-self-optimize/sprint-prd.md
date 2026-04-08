# Sprint PRD — Harness v4.0 自身流程优化

## 背景

Harness v4.0 于 2026-04-08 完成初版发布（PR #2000），建立了完整的 GAN 对抗 + CI/Deploy watch + auto-merge 流水线。
现通过 Harness 自身跑一轮优化，识别并修复流水线的薄弱环节。

## 目标

提升 Harness v4.0 自身的健壮性、可观测性和防死循环能力，使其能可靠地自动驱动任意编码任务。

## 功能列表

### Feature 1: GAN 对抗层防死循环

**用户行为**: 用户提交一个任务，Harness 开始 GAN 对抗（harness_contract_propose ↔ harness_contract_review）
**系统响应**: 系统维护一个 `gan_round` 计数，当轮次超过 `MAX_GAN_ROUNDS`（默认 5）时，强制选用最后一版合同草案，标记 `APPROVED(forced)` 并继续流程，不再死循环
**不包含**: 修改 GAN 对抗的评审逻辑本身

### Feature 2: harness_ci_watch 超时后的降级处理

**用户行为**: Generator push PR 后，CI watch 开始轮询
**系统响应**: 当 `poll_count` 达到 `MAX_CI_WATCH_POLLS`（120 次 × 30s ≈ 1 小时）时，系统当前直接 fail；优化后应改为：超时时创建 `harness_evaluate` 任务并在 payload 中注明 `ci_timeout: true`，由 Evaluator 决定是否继续评估（而不是直接 fail 整条链路）
**不包含**: 修改 CI 轮询间隔

### Feature 3: harness_fix 后 pr_url 更新

**用户行为**: Evaluator 判定 FAIL，Brain 创建 harness_fix，Generator 修复并推送新 PR
**系统响应**: harness_fix 完成后，Brain 创建新的 `harness_ci_watch` 时，应从 harness_fix 的 result 中提取新的 `pr_url`（而不是沿用旧 pr_url）；当前代码 `execution.js` 中 `harness_fix` DONE handler 已正确提取 `pr_url`，需要验证并加测试覆盖
**不包含**: 修改 harness_fix 的代码生成逻辑

### Feature 4: harness_deploy_watch 超时降级

**用户行为**: PR auto-merge 后，deploy_watch 开始轮询 CD 状态
**系统响应**: 当 `poll_count` 达到 `MAX_DEPLOY_WATCH_POLLS`（60 次）时，当前代码已有降级逻辑（创建 harness_report 并注明超时）；需要验证此路径有测试覆盖，并确认 harness-report SKILL.md 能正确处理 `deploy_timeout: true` payload
**不包含**: 修改 CD 流程本身

### Feature 5: harness-watcher.js 轮询与 tick 节奏解耦

**用户行为**: Brain tick 每 5 秒执行一次
**系统响应**: `harness_ci_watch` 轮询不应每次 tick 都执行（30s 间隔才合理），应在 harness-watcher.js 中维护上次轮询时间戳，仅当距上次轮询 ≥ 30s 时才实际调用 `checkPrStatus`；避免每 5s 向 GitHub API 发一次请求
**不包含**: 修改 tick 主循环的执行频率

## 成功标准

## 成功标准

- 标准 1: GAN 对抗轮次超过 MAX_GAN_ROUNDS 时，流程自动降级继续，不卡死
- 标准 2: CI watch 超时后创建 harness_evaluate（而非直接 fail），payload 含 `ci_timeout: true`
- 标准 3: harness_fix 完成后，新的 harness_ci_watch 使用 harness_fix result 里的新 pr_url
- 标准 4: harness-watcher.js 实际轮询 GitHub API 的频率不超过每 30s 一次
- 标准 5: 所有新增逻辑有对应测试覆盖

## 范围限定

**在范围内**: `packages/brain/src/execution.js`（GAN 防死循环）、`packages/brain/src/harness-watcher.js`（轮询节奏 + CI 超时降级）、测试文件
**不在范围内**: SKILL.md 文件、GAN 评审逻辑、CI/CD 系统本身、auto-version 流程
