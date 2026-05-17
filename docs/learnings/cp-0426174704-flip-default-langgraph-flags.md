# Learning: flip default LangGraph flags + 删 fallback gate

## 上下文
PR #2640 投产 full graph 默认行为，但保留了 `HARNESS_LANGGRAPH_ENABLED` / `HARNESS_USE_FULL_GRAPH=false` / `WORKFLOW_RUNTIME` 三个 env fallback gate 作为"1 周迁移期兜底"。本 PR 删除这些 gate，让 LangGraph 成为 dev/harness_planner/harness_initiative 唯一执行路径。

## 根本原因
- Phase B/C 重构时为了平滑过渡，故意保留 fallback。代码注释里写明"下一个 PR 删"，但没人接手。
- 用户视角：派发 dev/harness_planner 任务时，因 env 默认未设，看到任务走 procedural 老路而不是 LangGraph，误以为 graph 集成"跑着跑着不工作了"。
- 实施过程中发现：worktree 在 vitest 长跑期间被外部清理（疑似 Stop Hook / orphan worktree 检测误伤），未 commit 的实现工作全部丢失，被迫重做一遍。教训：**长时间 vitest 运行（5min+）期间必须先 commit 一次进度做 checkpoint**。

## 下次预防
- [ ] 任何"保留 N 天兜底"代码必须在合并 PR 时同时注册一个清理 task 到 Brain（避免遗忘）
- [ ] env-gate 默认值翻转后，应该立即在下一个 patch PR 删除 env 检查代码（保留 env 名作为 escape hatch 反而让现状更难懂）
- [ ] 任务调度链路（dispatcher / executor）的"路由决策"代码应集中在一个文件而非散落在多处 if-else，便于审查
- [ ] 大型 vitest 运行（>2min）前先 commit 一次实现进度做 checkpoint，防 worktree 被外部清理导致工作丢失
