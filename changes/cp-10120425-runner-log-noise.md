## Brain {VERSION} — coding runner 主日志降噪：会话输出只落按 PR 会话文件

- runner 进程内的 claude 会话（ci-fix / qa-fix / commander）输出边跑边写 `<logDir>/<kind>-<pr>-<后缀>.log`，不再转写进主日志；主日志只留一行「会话 <tag> PR #<pr> 结束：exit/轮数/时长/花费/结论摘录 → 会话文件」
- runner.sh 自更新日志只在 HEAD 变了时打；空闲「没有可新跑的开关任务」默认每小时最多一行（`CODING_WF_IDLE_LOG_INTERVAL_MS`，0 = 每轮都打）
- activity（spec/build/verify/evaluate）不给 transcriptPath，claude 输出照旧进 stderr → 执行器重定向的 `<task>.log`，行为不变
