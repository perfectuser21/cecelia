---
branch: cp-03192013-content-pipeline-executor
date: 2026-03-19
type: learning
---

# Learning: 内容工厂 Pipeline Executor

## 做了什么
为内容工厂 Pipeline 实现了 4 个阶段的 executor，让 pipeline 从"骨架"变为"可自动执行"。

## 关键发现

### 1. NotebookLM CLI 可以在 Node.js 子进程中调用
`execSync('notebooklm ask "..." --json')` 可以正常工作，返回结构化 JSON。
超时设为 120 秒（调研可能较慢）。

### 2. 品牌审查可以纯规则化
关键词命中率和禁用词检查不需要 LLM，简单字符串匹配就够。
LLM 审查应该留给更高级的判断（如"读者感受"）。

### 3. Tick 执行器需要防止长任务阻塞
Executor 是同步执行的，如果 NotebookLM 调用卡住会阻塞整个 tick。
后续应该改为异步执行 + 超时中断。

## 后续
- 测试完整 pipeline 端到端执行
- 处理 tick quarantine 机制对长任务的误伤
- 接入 /share-card 生成实际卡片图片
