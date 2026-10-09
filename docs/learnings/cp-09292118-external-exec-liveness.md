# 外部执行体被启动同步/活性探针误回队（09-29）

### 根本原因
- 启动同步与运行期探针都只认 Brain 本机进程证据（ps / activeProcesses / /tmp/cecelia-<id>.log / error_message），从不看 task_type/executor_kind；device_job（西安 Mac）、qiumi_task（MMV openclaw agent）、script_run（跑场机）本机恒无证据 → 必判死回队，且启动同步回队不清 claimed_by。
- 日志里的「executor_kind=null (legacy) — fail-open」不是合同识别错：它来自 tick-runner 的 in_progress SELECT 根本没取 executor_kind/task_type，交给 autoFailTimedOutTasks→assessTaskLiveness 时恒为空；之所以一上来就走到 100 分钟超时分支，是 tasks.started_at 为 timestamp without time zone（存 UTC 墙钟），而 Brain 进程 TZ=Asia/Shanghai，node-pg 按本地时区解析 → 所有 started_at 看起来早了 8 小时。该路径 fail-open 无害，真正回队的是 probeTaskLiveness 的零证据安全回队。

### 下次预防
- [ ] 新增「进程不在本机」的执行面时，只需在注册表声明 surface，isExternallyExecuted 自动覆盖；禁止在各守护刀里手抄类型
- [ ] 任何按本机进程证据判活的守护刀，先问「这个任务的进程在哪台机器」
- [ ] timestamp without time zone + 进程 TZ≠UTC 会让所有基于 started_at 的宽限期整体偏移 8 小时，另立任务治理
