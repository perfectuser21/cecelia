# Learning: fix(dashboard) DocChatPage 左栏编辑模式

### 根本原因
初版 DocChatPage 左栏只有渲染视图（dangerouslySetInnerHTML），没有提供编辑入口。
用户无法直接修改文档内容，只能通过右侧聊天让 Claude 更新。
这违背了「文档编辑工具」的基本预期——用户应该能直接编辑 markdown 原文。

### 下次预防
- [ ] 文档展示页设计时，默认同时规划只读/编辑两种模式，哪怕 v1 只做只读，也要预留编辑按钮占位
- [ ] 新增展示类页面的 PRD 需要明确说明「用户是否可编辑」，避免遗漏需求
