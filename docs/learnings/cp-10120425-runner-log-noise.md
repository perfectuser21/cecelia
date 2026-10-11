## coding runner 主日志被 claude 会话输出与心跳刷屏（2026-10-12）

### 根本原因
- `lib/claude.mjs` 的 spawnClaude 无条件把子 claude 的 stdout/stderr 转写到本进程 stderr。这本是给 activity 用的（executor 把 activity 的 stderr 重定向进 `<task>.log`），但 runner 的三个门禁（ci-fix / qa-fix / commander）直接在 run-once 进程里调 runClaude，run-once 的 stderr 经 runner.sh exec 继承到 launchd 的 StandardErrorPath = 主日志，会话正文被原样透传；三个调用点会话结束后又写了一份按 PR 的独立文件，主日志那份纯重复。
- #6205 全链计费给每个会话补 `--output-format json` 后，噪音从多行 markdown 变成单行 2.6~5.9KB 的 JSON result（主日志 25% 字节）。
- runner.sh 每 5 分钟无条件打「已自更新到 origin/main <sha>」、空闲 tick 无条件打「没有可新跑的开关任务」，两者占主日志 83% 行数。

### 下次预防
- [ ] 共享的子进程封装（同时给 executor 子进程与 runner 主进程用）不能假设 stderr 的去向：调用方要能显式指定输出落点
- [ ] 周期性任务的心跳日志只在状态变化时打，或限频；新增常驻循环的日志点要先算「每天多少行」
- [ ] 主日志行格式不变式（每行 `[时间戳]` 开头的一行级事件）进测试断言，防再有多行/大块内容漏进来
