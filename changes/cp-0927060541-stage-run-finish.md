## Brain {VERSION} — stage 回执作为已结束的 stage run 落账并触发 run.finished（链 bf5088a3 棒1-brain-2，任务 8e5521ae）

- `lib/task-run.js recordRunFromCallback`：回执 `status` 非终态（in_progress）且 `result.stage` 为字符串 ⇒ 视为「该 stage 的 run 已结束、任务继续」——`startRun` 后立即按 `stage_status` 映射 `finishRun`：completed→success、failed→failed、blocked→success 且 `result.blocked=true`（blocked 是执行机的正常退让，不是故障，不进失败统计）。`result` 落 stage/stage_status/metrics/evidence/probes，`run.finished` 单点 emit 一次，判定器得以运行。
- 根因（09-27 06:00 生产批实证）：非终态回执只 `startRun` 不 `finishRun` → 四行 `status=running`、`result` 空、永不结束，`run.finished` 从不发出。
- 无 `result.stage` 或 `stage_status` 未知的中间态回执保持只补行不结束；finalize 终态回执（cleanup 段）走原终态路径不变；任务状态仍由 `normalizeCallbackStatus` 决定（in_progress 不置终态）。
- 回归：`task-run-wiring.test.js` 新增 6 例（先红后绿）+ `task-run-primitive.pg.integration.test.js` 真 PG 三 stage 场景（重放幂等、任务状态不变）。
