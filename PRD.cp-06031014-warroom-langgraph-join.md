# PRD: War Room 后端数据层 — sprint feed 挂 LangGraph 富数据（PR-A）

## 背景
战情室 feed（`GET /api/brain/warroom/feed`）目前对 sprint（`kind==='sprint'`，即 `task_type='harness_initiative'`）
只拼了来自 `initiative_run_events` 的弱进度（pct/node）。需要 join `/api/brain/harness-pipelines`
的 LangGraph 富数据，让前端能展示真实 stage 时间线、GAN/Fix 轮次、当前节点、ws_verdicts、last_error、pr_urls。

join key：`harness_initiative.id === harness-pipelines.planner_task_id`（DB cross-check 通过）。

## 范围（仅后端 packages/brain）
- `packages/brain/src/warroom-classify.js`：新增 `normalizeLg`；`toFeedItem`/`buildFeed` 增 `lg` 入参。
- `packages/brain/src/routes/warroom.js`：建 `lgByPlannerTaskId` 映射传给 `buildFeed`；join 异常不阻塞 feed。
- `packages/brain/scripts/smoke/warroom-langgraph-smoke.sh`：feat 触 brain/src 必须新增 smoke。

## 字段契约（仅 sprint 命中时挂，非 sprint 全 null）
`node_label / gan_rounds / fix_rounds / review_round / eval_round / stages / ws_verdicts / last_error / pr_urls`，
并用 lg 的 `current_node` / `elapsed_ms` 覆盖原 `initiative_run_events` 拼的较弱值。
stages 归一为 `{key,label,status,elapsed_ms}`，status ∈ {done,running,pending,failed}。
ws_verdicts 归一为 `[{name,verdict}]`。

## 成功标准
- feed 中每个 sprint item 携带上述 9 个 LangGraph 契约字段键。
- 非 sprint 任务这些字段为 null。
- harness-pipelines join 缺失/异常时 feed 仍正常返回（try/catch 不阻塞）。
- warroom-classify 纯函数单测覆盖 normalizeLg + lg 合并 + 非 sprint 不带。
