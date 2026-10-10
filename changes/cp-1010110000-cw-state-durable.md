## Brain {VERSION} — coding harness：QA/CI 修复状态写进 Brain，本机丢了能恢复

- 决策 a1fdbc51 审计 P2 #34（旧 harness「台账先行，信外部真相」）：QA 门和 CI 修复的状态（批准、升级、合并、各种计数）以前只存在本机 `qa-<pr>.json`、`cifix-<pr>.json`，保留期按 30 天删掉，删掉后已升级的 PR 会被当新的重新处理，换机器就全丢了。
- runner 每轮在合并门/CI 修复/QA 门之后，把关键字段有变化的状态写进 Brain 任务 `result.qa_state` / `result.ci_fix_state`（没变不重复写）；本机缺状态文件时先从 Brain 恢复。
- 保留期清理不再删 `qa-<n>.json` / `cifix-<n>.json`（状态台账），执行记录与日志照常按期清。
- 人工重置一个 PR 要两边一起清：删本机文件，并把 Brain 的 `result.qa_state` / `result.ci_fix_state` 置 null。
