# Development Learnings

## [2026-03-08] cortex 输出去重熔断 — 阻断皮层回声室 (PR #700)

### Problem
皮层连续 8 轮输出同一份 root_cause 诊断，反思系统退化为回声室。现有 `_reflectionState` 是输入级去重（基于事件哈希 type+failure_class+task_type），无法拦截"输入不同但 LLM 输出相同"的回声。

### Solution
在 `analyzeDeep` 中新增 `_outputDedupState`（输出级去重）：
- 对 LLM 返回的 `decision.analysis.root_cause` 做 SHA256 内容哈希
- 相同诊断 ≥2 次自动熔断（比输入级阈值 3 更严格）
- 独立 Map + 独立持久化（`cortex_output_dedup:*` key in working_memory）
- 复用 30 分钟时间窗口

### Architecture Pattern
**双层去重架构**：输入级（事件特征）+ 输出级（诊断内容），两层独立管理。输入级防止重复分析同类事件，输出级防止 LLM 陷入固定模式输出。阈值不同（输入 3，输出 2）因为输出相同 = 确定无新信息。

### Key Decision
- 输出去重放在 LLM 调用**之后**（而非之前），因为需要先拿到 LLM 输出才能比较
- 第 1 次调用正常返回并记录 hash，第 2 次相同输出直接 fallback
- 这意味着最多浪费 1 次 LLM 调用就能检测到回声

## [2026-03-07] pr-callback-handler 同步更新 pr_url 和 pr_merged_at 列 (PR #594)

### Bug
- **新增列未写入**：migration 130 为 tasks 表新增了 `pr_url` 和 `pr_merged_at` 直接列，但 `handlePrMerged` SQL UPDATE 写于 migration 之前，只更新了 `metadata`/`payload` 中的 JSON 值，未更新直接列。导致 `GET /api/brain/metrics/success-rate` 通过 `pr_merged_at IS NOT NULL` 判断时永远返回 `success_rate: 0`。

### Fix
- 在 `handlePrMerged` SQL UPDATE 中增加 `pr_url = $5` 和 `pr_merged_at = COALESCE($6::timestamp, NOW())`
- `RETURNING` 子句增加 `pr_url, pr_merged_at`
- 参数列表扩展为 6 个：`[taskId, mergedAt, prMeta, payloadUpdate, prUrl, mergedAt]`

### CI 坑
- version-check CI 在 rebase 后发现 `origin/main` 已有相同版本号（另一个 PR 并行合并）→ 需再次 bump 版本。模式：**版本 bump 要紧接在 PR 创建后、不能假设 main 版本不变**。
- `workflow_dispatch` 触发的 CI run 不与 PR checks 关联，需要通过实际 push 触发 PR event。

## [2026-03-05] 统一账号选择入口 (PR #547)

### Bug
- **已有测试未适配统一入口**：`llm-caller-account-selection.test.js` ACS2 测试 mock 了废弃的 `selectBestAccountForHaiku`，但 `llm-caller.js` 已改为统一调用 `selectBestAccount({ model: 'haiku' })`，导致 mock 不生效、CI 失败。修复：更新 mock 目标为 `selectBestAccount`。

### Architecture
- **双入口合并为单入口**：原有 `selectBestAccount()`（Sonnet/Opus 三阶段降级）和 `selectBestAccountForHaiku()`（独立 5h 配额）两个函数，现统一为 `selectBestAccount({ model })` 单入口。`model: 'haiku'` 走 Haiku 独立模式，其他走三阶段降级链。
- **spending cap 过滤统一**：所有模型（Sonnet/Opus/Haiku）现在都在同一个函数内过滤 spending cap 账号，消除了 Haiku 路径遗漏 spending cap 检查的风险。

### Impact Level: High
消除了 Brain 内部 LLM 调用的双路径分裂，所有 `callLLM()` 调用统一走 `selectBestAccount({ model })`，spending cap 检测无死角。

## [2026-02-08] Alertness Signal Path Implementation (KR4)

### Bug
- **Version sync issue**: CI failed initially because brain version (1.14.0) wasn't updated in DEFINITION.md and .brain-versions file. The facts-check.mjs script enforces consistency across all version references.
- **Merge conflicts**: Multiple merge conflicts occurred with develop branch, particularly in PRD/DOD files and version numbers. Need to fetch and merge develop earlier in the process.

### Optimization Points  
- **Version management**: Consider automating version bumps across all files (package.json, package-lock.json, DEFINITION.md, .brain-versions) to prevent sync issues.
- **Workflow improvement**: The /dev workflow could benefit from automatic develop branch merge before creating PR to reduce conflicts.

### Technical Achievements
- **Modular architecture**: Successfully implemented a fully modular alertness system with clean separation of concerns.
- **Seamless integration**: Integrated with existing tick loop without breaking functionality.
- **Comprehensive testing**: Created 5 test suites with good coverage.

### Impact Level: Medium
Successfully adds self-diagnosis capability to Cecelia Brain, critical for system reliability.
