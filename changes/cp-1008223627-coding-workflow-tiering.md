## Brain {VERSION} — coding workflow 分档接管入口：opus 别名、任务依赖、建任务脚本

- 模型：runClaude 默认 `--model opus`（别名永远指向最新 Opus，MMV 实测解析为 claude-opus-5-5），不再写死版本号；CODING_WF_CLAUDE_MODEL 可覆盖。
- 大改先拆：runner 认领前检查 payload.depends_on，前置任务全部 completed 且 PR 已合并（result.merged 或 gh pr view = MERGED）才认领；前置在跑/PR 未合并 → 前置未就绪，前置 failed/cancelled/PR 关闭 → 前置失败，都记日志、本轮不认领，不影响其他无依赖任务。
- 入口：`packages/brain/scripts/coding-workflow/new-task.mjs <plan.json> [--dry-run]`，单条或一批（key + depends_on 引用前面的 key）建带开关的 data 任务；先整体校验（标题、验收非空、依赖只能指向前面、key 不重复）再按序创建，中途失败列出已建任务。
