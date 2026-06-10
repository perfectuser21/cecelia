### 根本原因

`buildLangGraphInfo()` 的 step map 是同步的，只存了最少的事件 payload 字段（node 名 + verdict），
没有读取 skill 文件内容和 sprint dir 产物文件。前端 StepPage 有三栏 UI 骨架但数据全空。

### 解决方法

- 后端：在 API 层按需读取（skill 文件 + sprint dir 产物），不扩展 `cecelia_events` 表 JSONB
- 前端：从 `langgraph.steps[]` 取数，fallback 到 legacy `steps[]`

### 下次预防

- [ ] LangGraph step 的 `emitLangGraphStep` 只保存事件标识；丰富的上下文在 **API 层**按需读取，避免 JSONB 行过大
- [ ] 新增 `buildLangGraphInfo()` 字段时，同步更新集成测试的期望字段列表
- [ ] 前端组件"暂无数据"是信号：有 UI 骨架但没有数据流——优先检查 API 是否返回空字段
- [ ] worktree 测试双 React 实例问题：使用 `vi.mock('react-router-dom', ...)` 直接 mock，避免 `MemoryRouter` 在 monorepo symlinked node_modules 下的多实例冲突
