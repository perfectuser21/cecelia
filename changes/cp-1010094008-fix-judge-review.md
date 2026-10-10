## Brain {VERSION} — 自动裁判等运行结束再判：跑到一半的运行不落库不翻色

- PR #6179 审查阻断项（任务 2f50cf2a，父任务 add0acfc）：技能按 Step 逐条上报（`emit-step-span.mjs`），一次运行常超过 30s 去抖窗口，自动裁判在运行跑到一半时把还没上报的 Step 判成 missing → diverged，readback 格翻红，且这条假结论永久留在只追加的 `activity_judgments` 里。
- `reconcileActivity` 新增参数 `applyCell`（默认 true）：false 时只算报告不动格子；翻色逻辑抽成 `applyReadbackCell(db, activityId, verdict)`。`reconcileSteps` 每次运行带 `last_span_at`（该运行最后一条 span 时间）。
- `judgeActivity` 自动触发时先 `applyCell:false` 对账，用 `pendingRunWaitMs` 判断触发运行是否没跑完（有 missing、没有 failed、最后一条 span 距今不到静默期，默认 10 分钟，`ACTIVITY_JUDGE_RUN_IDLE_MS`）：没跑完返回 `{ deferred:true, run_id, retry_after_ms }`，不落库不翻色；跑完了先落库再翻色（翻色出错只记日志）。过了静默期仍缺步按真实结果落库翻红。手动裁判行为不变。
- 调度器：`flushJudgments` 新增 `extraTargets`（被推迟的运行），`onSpansWritten` 把推迟的运行放回内存待判队列，过了静默期自动重判，不需要新 span 触发；新 span 照常按去抖窗口冲，不跟着等重判定时器。全程 fail-safe，不影响 POST /spans。
- smoke `activity-judgments-smoke.sh` 增加跑到一半的运行不落库、不翻红一段（已验证静默期设 0 时报红）。
