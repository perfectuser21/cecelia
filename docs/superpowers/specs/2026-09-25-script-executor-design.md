# executor=script 一等任务类型：确定性脚本步与 AI 步同一条 DAG 被引擎统一派发

日期：2026-09-25　任务：Brain 5cdbd52a（链 bf5088a3 第 3 棒，原单 e6d5c0bf）　决策：105a5868（C 档，报备即做）、96054a8b（us-vps 零执行）

## 0. 结论

脚本步不再是「注册了却没人执行」的旁路：新增 `executor_kind='script'` + task_type `script_run`（kind=agent，一步交付），
由 Brain 经 ssh 把命令推到**跑场机**执行，收割 exit / stdout / 产物引用，走与 AI 步同一套 DAG 门控（task_dependencies hard 边）、
retry-policy、并发槽、task_runs 留痕（棒 1 startRun/finishRun）与终态收口（棒 2 finalizeTask）。

分两个 PR：**PR A** = 迁移 + 注册表 + payload 契约与安全校验 + 建单入口拒绝 + 活性合同 + 重试策略；
**PR B** = dispatcher/executor 接线 + 远端 runner + 收割 job + 3 步链真 PG 集成。PR A 期间 `script_run` 的
`tick_dispatchable=false`（黑名单闸，防止没有执行体时被 tick 当普通任务派给 claude），PR B 翻 true。

## 1. 现状审计

| 事实 | 出处 |
|---|---|
| executor_kind 八值无 script | 迁移 463/464，`executor-contracts.js VALID_EXECUTOR_KINDS` |
| device_job：`tick_dispatchable=false`，靠外部领单器 | `task-type-registry.js` |
| workflow_run：只记账不执行 | 同上 |
| qiumi_task→openclaw-agent：ssh 直派 + `.exit` 收割是现成先例 | `openclaw-agent-executor.js` |
| 依赖门禁只认 dep.status ∈ completed/cancelled/canceled | `dispatch-helpers.js selectNextDispatchableTask` |

## 2. 模型

- **task_type `script_run`**：kind=`agent`（脚本也是「一步」，与 df67a9d6 判据一致），surface/executor/watchdog 均为 `script`，anchor_exempt。
- **payload 契约**：`{host, cmd, cwd?, env?, timeout_sec, artifact_paths?}`。
- **成功终态 = `completed`**（不是 completed_no_pr）：hard 依赖门禁只放行 completed，脚本步后面挂着 agent 步时必须能放行。

## 3. 硬约束与证明

| # | 约束 | 机制 | 红测试 |
|---|---|---|---|
| 1 | us-vps 零执行 | `host` 只认 machine-registry 里 primary/secondary 计算工作机（id 或别名）；scheduler 角色、localhost/回环、裸 IP、未注册、非计算机一律抛 `script_payload_invalid` + 可读原因 | script-task-spec.test.js host 用例 |
| 2 | 命令执行面 | host/cmd/cwd/env 拒控制字符（含换行、NUL）；cmd/cwd/env 全部经 base64 走 stdin，不进 ssh 命令行、不拼单引号；env 键白名单（`SCRIPT_/TASK_/APP_` 前缀 + TZ/LANG/LC_ALL/CI/NODE_ENV/DEBUG），值只在远端 job 文件里出现，收割输出把值替换为 `***`，事件/日志只记键名；`timeout_sec` 必填整数 1..3600，超时远端杀进程组标失败；stdout 尾 64KB、stderr 尾 4KB | 同上 + PR B runner 真跑 |
| 3 | 幂等 | 单任务原子 claim（既有）；run_id 由 `task.id + 第几次尝试` 确定性生成，远端 `.pid/.exit` 探针回 ALREADY，重试/重启绝不起第二个进程；startRun 幂等 | PR B |
| 4 | 失败如实 | exit≠0 / 超时 → failed，带 exit code 与截断 stderr，绝不伪造 completed | PR B |

## 4. 重试

`lib/retry-policy.js` 新增失败类 `script_exec`（一次重试，退避 1 分钟）。脚本失败先按该表重排 queued（`payload.next_run_at` + `payload.script_attempts[]` 记每次 run_id/exit/错误），
用尽后 `finalizeTask(failed)`。payload 校验失败属确定性错误，不重试，直接终态 failed。

## 5. 不做

- 不给依赖门禁加 completed_no_pr（既有缺口，另记发现，不在本棒扩范围）。
- 不做多机调度/亲和：`host` 由建单方指定。
- 不做交互式/流式输出。

## 6. 判定点登记表

（本任务无接缝判定点，N/A——exit code 是远端进程的确定性回执，不做推断。）

## 7. 测试策略

| 档 | 内容 |
|---|---|
| unit | payload 校验全部违规输入；注册表/迁移/合同/重试策略结构断言；建单入口拒绝 |
| integration（真 PG） | PR B：`script → agent → script` 三步链，假 ssh 执行器，tasks 与 task_runs 每步一行，hard 依赖门控 |
| 真跑 | PR B：把远端 runner 脚本用本地 sh 真执行（HOME 指向临时目录，不发 ssh）验证超时杀进程组、exit 收割、ALREADY 幂等 |
