# Development Learnings

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

### [2026-03-01] RNA KR 进度自动回写闭环 v1.9.0

**失败统计**：CI 通过，无本地测试失败

**关键发现**：

1. **旧逻辑错误**：
   - execution-callback 中的 KR 进度计算基于 `task.goal_id`（错误层级）
   - 正确层级应为：Task (project_id) → Initiative → Project → KR (project_kr_links)
   - 旧代码在 routes.js:2869-2909（已移除）

2. **复用现有模块**：
   - `kr-progress.js` 已实现正确的基于 Initiative 的进度计算
   - 直接集成 `updateKrProgress()` 而非重复实现
   - 避免了维护两套 KR 进度逻辑的复杂性

3. **测试策略**：
   - 使用 mock pool 而非真实数据库连接
   - vitest 不支持 `@jest/globals`，改用 vitest 导入
   - mock pool 需要覆盖所有 SQL 查询路径

**影响程度**：P0 - 核心功能（RNA 闭环）

**适用范围**：所有基于 OKR 架构的 Task 执行回调

**后续优化**：
- 考虑将 KR 进度更新作为独立事件发布到 EventBus
- 支持 Initiative 级别的进度权重（当前平均分配）
