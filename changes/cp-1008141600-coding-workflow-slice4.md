## Brain {VERSION} — coding workflow 第四刀：执行机 runner 自动认领带开关的任务跑 coding 链

- 新增 packages/brain/scripts/coding-workflow/runner/：run-once.mjs 每次至多处理一条 `payload.coding_workflow === true` 的 queued 任务（建议同时 `task_type: "data"` + `payload.headed_manual: "true"`，不改任何现有路由）。
- 流程：单实例 mkdir 锁（持锁进程已死则回收）→ 列 queued、取最早未认领候选（repo 缺省或 cecelia）→ POST claim（409 换下一条）→ PATCH in_progress → 专用 clone `~/perfect21/cecelia-cw-runner` 的 origin/main 建 worktree `cp-<MMDDHHmm>-cw-<task前8>`（写 .dev-mode/.dev-lock，根目录 npm ci）→ 跑 worktree 自己的 activity-contract-run.js（总超时 = Σ budget×max_attempts + 10 分钟）。
- 收尾：回执 completed → result.runner {receipt_path, host, duration_s, automerge}，gh pr ready + merge --auto --squash（CODING_WF_AUTOMERGE=0 关闭），PATCH completed，删 worktree；回执 failed/partial、执行器崩溃/超时、准备失败 → PATCH failed，result.coding_workflow_runner {status, failed_activity, reason_code, receipt_path, host}，保留 worktree；Brain 拒绝 completed 时改写 failed（complete_rejected）。
- runner.sh 启动器（clone 缺失则 clone，干净才自更新）；install.sh 生成系统域 LaunchDaemon com.cecelia.coding-workflow-runner（StartInterval=300，--dry-run 只打印）。
- launchd-patrol MUST_LOAD_DAEMONS 登记 com.cecelia.coding-workflow-runner；新增 coding-workflow-runner-smoke.sh。
- 新增执行体类型 coding-workflow-runner（迁移 535 扩 tasks_executor_kind_check；isExternallyExecuted 认它，合同探活 unknown/onStale none）：Brain 重启时启动同步不再把 runner 任务打回 queued。runner 认领时显式写该 kind。
- runner 防重跑：终态回写 409 时对账（仍属本机则重新认领→in_progress→终态，他人接管不覆盖）；本机有回执/日志或 Brain 已有运行结果不再新跑；启动对账本机 runner 的 in_progress 任务（无终态回执标 failed runner_lost）。
- 候选须 task_type=data + headed_manual="true" + coding_workflow===true；先 completed 再 automerge；超时按进程树清理；失败 worktree 保留 7 天、回执/日志 30 天；plist ExitTimeOut=90。
