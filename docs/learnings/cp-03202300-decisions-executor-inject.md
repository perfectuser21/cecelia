# Learning: decisions 表注入 executor prompt

## 背景

用户决策散落在对话记录、memory 文件、CLAUDE.md 中，每次新对话 agent 对用户决策一无所知。建立了 decisions 表作为决策 SSOT，需要在 executor 派发时自动注入。

### 根本原因

executor.js 构建 agent prompt 时没有查询 decisions 表。preparePrompt() 只构建了任务相关的 prompt，缺少全局决策上下文。

### 下次预防

- [ ] 新增需要全局注入的上下文时，同时修改 triggerCeceliaRun 和 triggerCodexBridge 两个派发路径
- [ ] decisions-context.js 查询失败时降级为空字符串，不阻塞派发
- [ ] 摘要长度有硬上限（500 字），防止 decisions 增长导致 prompt 膨胀
