## Brain {VERSION} — 外部执行体不再被启动同步/活性探针误回队

- 新增统一谓词 `executor-contracts.isExternallyExecuted(task)`（集合从注册表 `surface ∈ {device, openclaw-agent, script}` 派生：device_job / qiumi_task / script_run，或 executor_kind ∈ {openclaw-agent, script}）。
- `syncOrphanTasksOnStartup`：外部执行体跳过，不回队、不动 claimed_by（修每次部署重启把西安 Mac 上的 device_job、MMV 上的秋米 agent 回队导致重复执行）。
- `probeTaskLiveness`：openclaw-agent / script 任务不再走本机 spawn 证据 SUSPECT→DEAD→零证据回队，生死归各自 reaper 读远端 .exit（修 0929 秋米 87c9a08b 起 4 分钟即被回队）；device_job 保留认领新鲜度 + 45 分钟兜底不变。任务 57bcc267。
