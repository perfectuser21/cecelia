# Sprint PRD — Harness Pipeline 自优化：四项瓶颈修复

## 背景

当前开发流水线存在四个独立瓶颈，导致 CI 绿灯率偏低、调度资源浪费、push 前检查耗时过长。
本 Sprint 对每个根因逐一修复，目标是将流水线可靠性提升到生产可信水平。

经过深度代码调查，确认根因如下：

- **arch_review 积压**：`hasRecentArchReview()` 去重逻辑只查"4小时内创建"，超过4小时的旧 queued 任务不阻止新任务创建；`task-cleanup` 不清理 `arch_review` 类型任务（不在 recurring 列表）。结果：每个4h窗口都创建新任务，当前积压6个 queued（跨越2天）。
- **content-pipeline 僵尸**：任务 `0e1cd015` 于2026-04-05失败（Codex quota exhausted），隔离后2026-04-08自动释放，今天被重新设为 `in_progress`，但 `failure_classification.should_retry: false`，实为 terminal failure 状态无法自愈。
- **CI flaky（account-usage-scheduling）**：`account-usage.js` 模块级 `spendingCap Map` 是进程内单例，跨测试保持状态。`clearAllSpendingCaps()` 辅助函数通过过期时间绕过清除，不可靠。测试文件注释（line 580, 606）已承认这一污染但未根本解决。
- **quickcheck.sh 耗时**：任何 `packages/brain/` 文件变更都触发全量 brain vitest（~220s）。测试集包含50+个文件，其中大量集成测试耗时远超必要。

## 目标

修复四个根因，使 CI 绿灯率从当前 ~50% 提升至 ≥95%，push 前检查耗时从 220s 降至 ≤60s。

## 功能列表

### Feature 1: arch_review 去重修复 + 积压清理

**用户行为**: Brain 每4小时自动触发架构巡检调度。

**系统响应**:
- `hasRecentArchReview()` 改为同时检查"4小时内创建 OR 当前 queued 状态"的任务，任一满足即跳过创建
- `task-cleanup` 新增规则：arch_review 任务 queued 超过 8 小时自动 cancel
- 立即清理当前6个积压 queued 任务（执行一次 cleanup）

**不包含**: 不改变 arch_review 调度频率（仍然4小时一次）；不改变 arch_review skill 执行逻辑。

---

### Feature 2: content-pipeline terminal failure 状态修复

**用户行为**: content-pipeline 任务失败后不再以 zombie 形式占用 in_progress 槽位。

**系统响应**:
- 立即将任务 `0e1cd015` 状态从 `in_progress` 修正为 `failed`
- `task-cleanup` 新增规则：`in_progress` 任务若 `failure_classification.retry_strategy.should_retry === false` 且存在 `blocked_detail`，超过 2 小时后自动标记为 `failed`
- recurring 重调度逻辑在释放任务前先检查 `should_retry`，false 时不重设为 `in_progress`

**不包含**: 不修改 content-pipeline skill 本身；不修改 Codex quota 重试策略。

---

### Feature 3: account-usage-scheduling 测试隔离修复

**用户行为**: CI brain-unit 测试稳定通过，无跨测试状态污染导致的 flaky。

**系统响应**:
- 在 `account-usage-scheduling.test.js` 每个 `describe` 块的 `beforeEach` 中调用 `vi.resetModules()` + 重新 `import`，确保模块级 Map 完全重置
- 或：在 `account-usage.js` 暴露 `__resetSpendingCapsForTest()` 测试专用函数，`beforeEach` 调用
- 移除现有的 `clearAllSpendingCaps()` 不可靠辅助函数
- 同样修复 `account-usage.test.js` 和 `account-usage-proactive.test.js` 中的类似污染

**不包含**: 不改变 `account-usage.js` 生产逻辑；不修改其他测试文件。

---

### Feature 4: quickcheck.sh brain 测试提速

**用户行为**: 只改了 `packages/brain/` 中一个文件，push 前检查在 60 秒内完成。

**系统响应**:
- brain 测试改为只跑变更文件对应的测试（利用 vitest `--related` 模式或文件路径匹配）
- 若无法匹配到对应测试文件，fallback 到只跑 `packages/brain/src/__tests__/` 中的单元测试（排除集成测试目录）
- 给 brain vitest 加 `--reporter=dot` 减少输出噪音
- 超时上限设为 90s，超出则告警但不阻塞（OOM Worker 已有此逻辑，统一化）

**不包含**: 不修改 CI 的测试范围（CI 仍跑全量）；不修改 engine/api/dashboard 的 quickcheck 逻辑。

---

## 成功标准

- **arch_review**：6个积压 queued 任务被清理，未来不再出现同类积压（验证：连续3天 queued 数 ≤1）
- **content-pipeline**：任务 `0e1cd015` 状态变为 `failed`；未来 terminal failure 任务在2小时内自动退出 in_progress
- **CI flaky**：`account-usage-scheduling.test.js` 在 vitest 串行/并行模式下连续10次通过（无 flaky）
- **quickcheck**：改单个 brain 文件时 quickcheck 耗时 ≤60s（从 220s 降低）

## 范围限定

**在范围内**:
- `packages/brain/src/daily-review-scheduler.js`（arch_review 去重）
- `packages/brain/src/task-cleanup.js`（积压清理规则）
- `packages/brain/src/account-usage.js`（测试隔离辅助函数）
- `packages/brain/src/__tests__/account-usage-scheduling.test.js`（测试修复）
- `packages/brain/src/__tests__/account-usage.test.js`（测试修复）
- `packages/brain/src/__tests__/account-usage-proactive.test.js`（测试修复）
- `scripts/quickcheck.sh`（brain 测试提速）
- 一次性 SQL / Brain API 调用修复 content-pipeline 僵尸状态

**不在范围内**:
- arch_review 调度频率调整
- CI 全量测试范围修改
- content-pipeline skill 重设计（见 memory/content-pipeline-redesign.md）
- xian Codex Bridge 可用性改善
