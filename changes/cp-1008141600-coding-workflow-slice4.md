## Brain {VERSION} — coding workflow 第四刀：执行机 runner 自动认领带开关的任务跑 coding 链

- 新增 packages/brain/scripts/coding-workflow/runner/：run-once.mjs 每次至多处理一条 `payload.coding_workflow === true` 的 queued 任务（建议同时 `task_type: "data"` + `payload.headed_manual: "true"`，不改任何现有路由）。
- 流程：单实例 mkdir 锁（持锁进程已死则回收）→ 列 queued、取最早未认领候选（repo 缺省或 cecelia）→ POST claim（409 换下一条）→ PATCH in_progress → 专用 clone `~/perfect21/cecelia-cw-runner` 的 origin/main 建 worktree `cp-<MMDDHHmm>-cw-<task前8>`（写 .dev-mode/.dev-lock，根目录 npm ci）→ 跑 worktree 自己的 activity-contract-run.js（总超时 = Σ budget×max_attempts + 10 分钟）。
- 收尾：回执 completed → result.runner {receipt_path, host, duration_s, automerge}，gh pr ready + merge --auto --squash（CODING_WF_AUTOMERGE=0 关闭），PATCH completed，删 worktree；回执 failed/partial、执行器崩溃/超时、准备失败 → PATCH failed，result.coding_workflow_runner {status, failed_activity, reason_code, receipt_path, host}，保留 worktree；Brain 拒绝 completed 时改写 failed（complete_rejected）。
- runner.sh 启动器（clone 缺失则 clone，干净才自更新）；install.sh 生成系统域 LaunchDaemon com.cecelia.coding-workflow-runner（StartInterval=300，--dry-run 只打印）。
- launchd-patrol MUST_LOAD_DAEMONS 登记 com.cecelia.coding-workflow-runner；新增 coding-workflow-runner-smoke.sh。
