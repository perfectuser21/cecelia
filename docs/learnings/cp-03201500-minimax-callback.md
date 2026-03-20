# Learning: MiniMax 执行路径缺失 execution-callback 后处理

## 日期
2026-03-20

## 分支
cp-20260320-minimax-callback

### 根本原因
triggerMiniMaxExecutor() 是同步调用模式（等待 HK MiniMax HTTP 响应），与 Claude Code 的异步 spawn+callback 模式不同。
开发时直接用 updateTaskStatus() 更新 DB 状态，绕过了 execution-callback 路由中的 1600+ 行后处理逻辑。
这导致 MiniMax 任务完成后缺失：学习吸收、失败分类、thalamus 决策、KR 进度汇总、依赖级联等。

同理，liveness probe 死亡任务也绕过 execution-callback，仅做了 auto-learning 补丁。

### 下次预防
- [ ] 新增执行器路径时，必须走 execution-callback 统一出口（无论同步/异步）
- [ ] 使用 fireInternalCallback() 辅助函数而非直接 updateTaskStatus()
- [ ] 在 execution-callback 路由中添加 executor 字段日志，方便追踪来源
