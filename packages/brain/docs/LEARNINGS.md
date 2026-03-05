# Development Learnings

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
