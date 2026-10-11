## Brain {VERSION} — Brain 主动把 workflow 派给 work-commander（任务 f38e7cc2）

- 新 task_type `workflow_dispatch`（迁移 549 在 tasks_task_type_check 上追加；kind=workflow，surface=openclaw-agent，tick_dispatchable=false）。不复用 `workflow_run`：后者是外部起跑的账本镜像，isExternalRunMirror / commander-watchdog / workflow-run-lost-deadline 都按它全量收，混入主动派发要三处开例外；新类型从注册表派生自动不进镜像集合
- 新 scheduler job `workflow-commander-dispatch`（60s，先收后派）：queued 的 workflow_dispatch 按 `config/factory-workflows.json` 的 `commander` 登记解析调度单 `<能力> <机器> <profile> <serial> <biz>`（缺项/非法字符 → failed `workflow_dispatch_unresolved`，不猜）→ 发布时段内 CAS 认领 → 经 manual-dispatch-device-gate 领 Brain 设备锁（被占只等不接管，未登记设备 failed）→ ssh MMV 起 `openclaw agent --agent work-commander`，调度单 + 纪律 + 验收经 stdin 作为消息（不进命令行）→ in_progress；收割读 `~/brain-runs/<run_id>.exit` 与 Commander 最后一行 `COMMANDER_RESULT {json}` → completed（result 带 commander_result/evidence）或 failed（exit≠0 / 缺回执 / blocked）→ 释放设备锁、task_runs 补终态
- 首条登记：抖音·视频发布（安卓真机）`douyin_video_publish xian-m4 xiaolongxia ANGYVB4311010223 Ai办公室`
- notion-push-sync 派 workflow 的「先派后记」改「先建单再派」：ssh 直派与 webhook 两条路径都先 createRoutedTask 拿到 task id 才派，建单失败不派写 ⚠ 回执；派发失败把已建单 finalize 成 failed（不留无主 in_progress）
- smoke `workflow-commander-dispatch-smoke` 登记 write-targets + allowlist
