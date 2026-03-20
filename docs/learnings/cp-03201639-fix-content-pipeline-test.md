# Learning: content-pipeline 测试路由期望值未同步

**分支**: cp-03201639-fix-content-pipeline-test
**日期**: 2026-03-20

### 根本原因

PR #1196 修改了 `task-router.js` 中 LOCATION_MAP 的 content-* 类型路由（us→xian），但没有同步更新对应的测试文件 `task-router-content-pipeline.test.js`。导致 Brain Unit Tests 3 个失败，阻塞了 3 个无关 PR（#1202, #1204, #1205）。

### 下次预防

- [ ] 修改 LOCATION_MAP / SKILL_WHITELIST / VALID_TASK_TYPES 等常量时，必须 grep 搜索所有引用这些常量的测试文件
- [ ] PR review 时检查是否有对应的测试文件需要同步更新
- [ ] 考虑在 CI 中添加 "常量变更→测试引用" 的自动检测
