## Brain {VERSION} — 裁判接线：运行后自动裁判落库，新旧版本对比可查

- 决策 de6dff5d（五块模型：树+仓库+账本+裁判+发布线）第 2 步，任务 add0acfc。此前 `reconcileActivity` 与 `POST /step-reconcile/:activityId` 只能手动调用，生产 Activity 的 readback 格全空。
- 迁移 538：新表 `activity_judgments`（只追加，UPDATE/DELETE 由触发器拒绝）：activity_id、activity_definition_version_id（对账窗口内最新一条带版本的 span 的定义版本）、verdict、converged、consecutive_green、required_green、runs_considered、trigger_kind（auto/manual）、trigger_ref（触发运行）、report jsonb、judged_at。
- 自动裁判 `lib/activity-judge.js`：`POST /spans` 写入成功后 `onSpansWritten` 把新插入的 span 放进缓冲，最多每 30s（`ACTIVITY_JUDGE_DEBOUNCE_MS`）冲一次，Step 级 span 经 steps 表找归属 Activity，逐个跑 `judgeActivity`（复用 `reconcileActivity`，readback 格同时翻色）。自动触发且 no_data 不落库。钩子 fail-safe：任何错误只记日志，上报照常返回；`ACTIVITY_JUDGE_AUTO=off` 整体关闭。`POST /step-reconcile/:activityId` 同样记一条手动裁判。
- 新旧版本对比 `lib/activity-version-compare.js` `compareActivityVersions`（晋级门调用的稳定接口）：同一 Activity 候选 vs 基线版本按 `spans.activity_definition_version_id` 分组，各取最近 50 次运行，比成功率、读回 verified 比例（复用 `reconcileSteps` 逐 Step 判定）、观测形状一致性；`insufficient_data`（样本 < 下限，默认 5）/ `worse`（任一项低于基线超容差，默认 0）/ `not_worse`，带每项数字与理由。Step 读回取版本快照里冻结的 Steps，快照没有才退回当前 Step 表。
- 接口：`GET /api/brain/activities/:id/judgments/latest`、`GET /api/brain/activities/:id/judgments?limit=`、`GET /api/brain/activities/:id/version-compare?candidate=&baseline=&min_runs=&max_runs=&tolerance=`（baseline 省略取 Activity 当前版本）。
- smoke：`activity-judgments-smoke.sh`（真库真函数，事务内跑完回滚；已验证迁移缺失时报红）。
