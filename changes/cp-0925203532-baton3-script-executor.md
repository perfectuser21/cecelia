## Brain {VERSION} — executor=script 一等任务类型·契约与安全闸（任务 5cdbd52a，链 bf5088a3 棒 3 PR A，决策 105a5868）

- 背景：确定性脚本步此前没有执行体——`executor_kind` 八值无 script，`device_job` 靠外部领单器，`workflow_run` 只记账不执行，脚本与 AI 步无法进同一条 DAG 被统一派发/重试/留痕。本 PR 落地契约与安全闸，执行接线在 PR B。
- 迁移 471/472：`tasks_executor_kind_check` 加 `script`（九值）、`tasks_task_type_check` 加 `script_run`（86 值），照 461/462、463/464 拆法 NOT VALID 登记 + 472 单独 VALIDATE；附 rollback。
- 注册表：`script_run` = kind `agent`（一步交付）、surface/executor/watchdog 均 `script`、免锚、`tick_dispatchable=false`（执行体接线前不许被 tick 当普通任务派给 claude，PR B 翻 true）。
- payload 契约 `lib/script-task-spec.js`：`{host, cmd, cwd?, env?, timeout_sec, artifact_paths?}`。host 只认 machine-registry 里 primary/secondary 跑场机（id 或别名，新增 `resolveMachineId`/`aliases`），调度器（us-vps，零执行铁律 96054a8b）、回环、裸 IP、未注册一律拒绝；host/cmd/cwd/env/artifact_paths 拒控制字符（换行注入）；env 键白名单（SCRIPT_/TASK_/APP_ 前缀 + TZ/LANG/LC_ALL/CI/NODE_ENV/DEBUG），报错只点名键不回显值；`timeout_sec` 必填整数 1..3600。
- 建单入口：`createRoutedTask` 对 `script_run` 物化前校验，违规抛 `script_payload_invalid`（事务回滚不留半截任务）；`POST /tasks` 映射 400 `INVALID_SCRIPT_PAYLOAD`。
- 活性合同 `script`（ssh 探 `.exit/.pid`，非跑场机/缺 run_id 一律 unknown 不发 ssh，staleMinutes 75，onStale fail）；`retry-policy` 新增失败类 `script_exec`（一次重试，退避 1 分钟）。
- 测试：`lib/__tests__/script-task-spec.test.js`（36 例含全部违规输入）、`migration-471-script-executor.test.js`、`script-executor-registry.test.js`、真 PG 临时库 `script-executor-constraints.pg.integration.test.js`；smoke `script-executor-contract-smoke.sh` 已登记 allowlist。
