# 小改动 PrepPRD：coding workflow 第二刀——spec 自身超时 + report 回写 Brain

- Brain 任务：4734772c-70c0-42fe-a2b6-5e70c2c9ceef
- 来源：PR #6020 `sprints/10071451-coding-workflow-slice1/02-spec.md` 的 S-4、S-5（由第一刀端到端时真 claude 生成）
- 决策：896fb590、22ef1a72
- GP-Anchor: none(infra)

## 改什么

位置均在 `packages/brain/scripts/coding-workflow/`。

### S-4 spec 活动自身超时

- `activities/spec.mjs` 的 claude 子进程增加超时：默认 870000ms（低于契约 budget 900s），环境变量 `CODING_WF_SPEC_TIMEOUT_MS` 可覆盖（正整数，非法值回退默认）。
- 到时先 SIGTERM，5s 后仍未退出再 SIGKILL。
- 超时直接返回 `failed` + `retryable` + `claude_timeout`，不再检查产物，不做越界检查。
- 为什么还要自己超时：执行器到 budget 也会杀，但那时 reason 是笼统的 `activity_timeout`；自身超时能给出明确的 `claude_timeout` 并先清理 claude 子进程。

### S-5 report 活动

- 新增 `activities/report.mjs`，契约中 order 5、phase `finalize`、entry `activities/report.mjs`、budget `{max_duration_s:30, heartbeat_s:30}`、`max_attempts:1`、`on_failure:'stop_run'`。
- 输入（累积上下文）：`task_id`、`brain_url`（默认 `http://localhost:5221`）、`pr_url`、`branch`、`sprint_dir`、`chain_files`、`run_tag`。
- 行为：`PATCH {brain_url}/api/brain/tasks/{task_id}`，body 只含 `{"result":{"coding_workflow":{pr_url,branch,sprint_dir,chain_files,run_tag,host}}}`，`host` 取 `os.hostname()`。**不传 status**。
  - 已核实 Brain 语义：PATCH 只传 result 合法，result 用 jsonb `||` 顶层合并，不会覆盖已有的 handoff 等字段（`packages/brain/src/routes/tasks.js` 的 PATCH `/tasks/:task_id`）。
- 失败映射：
  - 缺 `pr_url`（前序 publish 未完成）→ fatal `pr_url_missing`，不发请求
  - 缺 `task_id` → fatal `task_id_missing`
  - 404/400 → fatal `task_not_found`
  - 5xx / 408 / 429 / 网络错误 → retryable `brain_unavailable`
  - 其他非 2xx → fatal `brain_http_<status>`
- 成功 outputs `{reported: true}`。
- 复用 `lib/protocol.mjs` 的 `runActivity`、`fail`；report 不碰文件系统，不需要 `validateBase` 里的 sprint_dir 校验（只校验 task_id）。

### 契约

`contract.json` 追加 report；`__tests__/contract.test.mjs` 的 EXPECTED/REPORTED 与真实 `parseActivityContract` 回归同步为五个活动。spec 的 retryable 增加 `claude_timeout`。

## 验收

- [ ] spec 单测：`FAKE_CLAUDE_MODE=sleep` + `CODING_WF_SPEC_TIMEOUT_MS=500` → `failed/retryable/claude_timeout`，退出码 2，活动总耗时 < 10s，`02-spec.md` 不存在，且假 claude 进程已不在
- [ ] report 单测（本地假 Brain HTTP）：成功时假 Brain 收到恰好一次 `PATCH /api/brain/tasks/<id>`，body 只有 `result.coding_workflow` 且字段齐全、无 status；404 → fatal task_not_found；500/429 → retryable；缺 pr_url → fatal 且请求数 0；stdout 只有一个结果 JSON
- [ ] 契约：真实 `parseActivityContract` 通过，五个活动按序
- [ ] 端到端：main 上 `scripts/activity-contract-run.js` 跑完整五活动契约（假 claude、假 gh、临时 bare origin、本地假 Brain）→ run completed，假 Brain 收到一次 PATCH 且 pr_url 等于 publish 输出
- [ ] CI 必需检查全绿
