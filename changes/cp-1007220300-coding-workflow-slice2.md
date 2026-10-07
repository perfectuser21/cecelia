## Brain {VERSION} — coding workflow 第二刀：spec 自身超时 + report 回写 Brain

- spec 活动：claude 自成进程组，超时（默认 870s，钳在契约 budget 内）报 `retryable/claude_timeout`；执行器取消时先整组 SIGTERM、2.5s 后整组 SIGKILL；正常退出后 1.5s 清理残留后代，杜绝孤儿 claude
- 新增 report 活动（finalize）：PATCH Brain 任务 `result.coding_workflow`（pr_url/branch/sprint_dir/chain_files/run_tag/host），不改状态、jsonb 合并不覆盖 handoff；失败 evidence 带 http_status/body_code
- coding_spec 契约扩为五活动；新增经通用执行器的五活动端到端测试（假 claude/假 gh/临时 origin/假 Brain）
