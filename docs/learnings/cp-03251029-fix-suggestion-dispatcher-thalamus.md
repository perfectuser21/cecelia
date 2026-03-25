# Learning: suggestion-dispatcher 绕过丘脑直接建任务修复

**Branch**: cp-03251029-fix-suggestion-dispatcher-thalamus
**Date**: 2026-03-25

### 根本原因

suggestion-dispatcher.js 原实现直接执行 `INSERT INTO tasks`，绕过了丘脑（Thalamus）的任务创建权统一管控机制。这违背了架构约定：任务创建权统一收归丘脑，外部模块不得直接写 tasks 表。

### 修复方案

1. 将直接 INSERT 路径替换为 `thalamusProcessEvent(SUGGESTION_READY)` 事件通知
2. 在 thalamus.js 中添加 `SUGGESTION_READY` 事件类型和处理逻辑，返回 `create_task` 决策
3. suggestion-dispatcher 执行丘脑返回的 `create_task` 动作（经由 `actions.createTask`）

### 测试文件路径陷阱

`suggestion-dispatcher-thalamus.test.js` 中用 `process.cwd()` 拼接路径失败，因为 vitest 从 monorepo 根运行，导致 `src/suggestion-dispatcher.js` 路径不存在。

**正确做法**：用 `resolve(__dirname, '../suggestion-dispatcher.js')` 相对 `__dirname` 解析，而不是 `join(process.cwd(), 'src/...')`。

### 下次预防

- [ ] 测试文件中读取源文件时，始终用 `resolve(__dirname, '../xxx.js')` 相对路径，不依赖 `process.cwd()`
- [ ] 新增 Brain 模块时先检查：是否直接写 tasks 表？若是，改走 thalamus processEvent
- [ ] 架构约定：任务创建权统一收归丘脑，外部调用者通过事件通知，不直接 INSERT
