# 设计：harness 生命周期/记账/验收判据下沉 Brain 代码（刀B+刀C+收账权收归）

日期：2026-07-14 ｜ 任务：d0a668d9 ｜ 决策：dc18d43d「无闸不成文」/ c3f473eb（本次修法）｜ 证据：issue 3c541792（task f35db586 dogfooding 实证）
PrepPRD：sprints/07140715-harness-lifecycle-code-gates/prep-prd.md（GAN 对抗 1 轮 + Challenger 6 缺口 + Research 3 接线确证后的收敛版，细节以本设计为准）

## 问题

harness pipeline 的生命周期、记账、验收判据全靠 SKILL 文本条文约束 LLM 自觉。dogfooding 实证成批失效：behavior_tests=0 照样 PASS、judgments_written=5 虚报（DB 0 条）、generator callback 提前把任务标 completed(merged:false)、judge_verdict 不落库、initiative_runs.current_task_id 恒空、skill-relay-spawn 事件 17 条永久 running。

## 设计总纲

LLM 只管创造段（规划/合同/写码/修复）；生命周期与记账由 Brain 按**外部真相**机械判定。三块改动全部 Brain 代码，不动任何 SKILL 文本（EVA v3 前冻结）。

## 一、刀B — judge API 机械闸

位置：`packages/brain/src/harness-judge.js` `runJudgeGate`，在调 DeepSeek 之前插入纯代码闸（新增独立函数 `runMechanicalGate`，便于单测注入）。机械闸任一 FAIL → 返回 `{verdict:'FAIL', judged:true, feedback:<缺项明细>}`，**不再调 DeepSeek**（judgeFn 零调用，省成本）。

1. **behavior_tests 声明（E1 机械化）**：`brainResult.behavior_tests` 必须是非空数组（evaluator 1.23.0 E1 硬要求产出 `behavior_tests:[{command, exit_code, log_tail}]`），缺失/空 → FAIL（理由含 `behavior_tests`，这是治「behavior_tests=0 照样 PASS」的正主）。每条目：`exit_code` 为 undefined/null → FAIL（0 合法）；`log_tail` 缺/空 → 按环境校准（真机 env∈windows_wechat 必须设备日志；本机 API 类 env 靠 `ctx.agentStdout||ctx.transcript` 命令输出兜底，全空才 FAIL）。**注意 exit_code/log_tail 是 behavior_tests 条目级字段——`.brain-result.json` 顶层 schema 只有 `{verdict, task_id, failed_step, log_excerpt}`，顶层无这两个字段；早期设计误查顶层会把 100% 合规 run 打死，已修正。**
2. **sprint 测试文件存在性**：以 `join(worktreePath, sprintDir)` 为根递归扫 `*.test.{ts,js,mjs,sh}`；fallback 数 contract-dod.md 的 `[BEHAVIOR]` 条目。两者全 0 → FAIL（理由关键词 `contract_tests`，与①的 behavior_tests 区分）。
> target_environment 校准（铁律 9216d107）：从 `tasks.payload->>'target_environment'` 读（`SELECT ... FROM tasks WHERE id=$1`，带 taskId guard），缺省 `local_api`（最宽口径，查不到/异常不误杀）。

3. **judgments_written 对账**：声明值取 `.brain-result.json.judgments_written`（reviewer skill 现成产出，无需改 skill）；无声明 → 跳过本项（不假收敛）。有声明 N → 回读 `decisions WHERE category='judgment' AND source_ref=$task_id` 计数，N > 回读数 → FAIL。
   - **migration 342**：decisions 表加 `source_ref TEXT` 列（现库无此列；migration 302 只有 level/target_type/target_id/scope）。
   - `strategic-decisions.js:90` POST 的 INSERT 补 source_ref 可选字段写入口。
   - 存量无 source_ref 数据：对账仅对新数据生效，旧数据自然豁免（声明缺失即跳过）。

## 二、刀C — 三小件

- **C1**：`harness-skill-relay.js:296`（codex 分支）与 `:546`（headed 分支）两处 `INSERT initiative_runs` 补 `current_task_id = task.id`（参数化占位符）。使 `GET /relay-runs?task_id=`（initiatives.js:276 已有过滤）真正可用。
- **C2**：judge API（routes/harness.js /judge）拿到 result 后、返回前：`result.judged===true` 时 UPDATE 最新一条 run（started_at DESC）的 judge_verdict，条件 `current_task_id=$task_id AND judge_verdict IS DISTINCT FROM 'PASS'`。允许 FAIL→PASS 收敛、禁 PASS→FAIL 回退；UPDATE 0 行或落库异常均 non-fatal（不吞裁决，照常 res.json）。
- **C3**：skill-relay-spawn 事件（executor.js:2990 唯一写点，恒 running）三口收尾，SQL 形态统一为 `UPDATE initiative_run_events SET status=$1, ts_end=NOW() WHERE initiative_id=$2 AND node='skill-relay-spawn' AND status='running'`：
  1. `_finalizeMergedRun` 成功路径 → status='done'
  2. watchdog attempt-cap failed 分支（harness-relay-watchdog.js:288-304）→ status='failed'
  3. 孤儿 sweep：按 `initiative_runs.deadline_at < NOW()` JOIN 收尾（事件表自身无 deadline_at，两表勿混）→ status='failed'，挂进 watchdog 周期

## 三、收账权收归 — 终态绑定外部真相

**核心**：Brain 把 harness_initiative（payload.orchestrator='skill-relay'）的任何 completed 请求当"申请"，统一走新增的 `finalizeHarnessTask(taskId, {pool})` 机械核验，**不信任任何请求体自声明**（finalized_by 方案已被否决——LLM 跑 curl 可伪造）。

核验判据（复用 watchdog 现役范式）：
- PR MERGED：tasks.pr_url 或 `_discoverPrFromGithub`（gh pr list，watchdog:44）发现的 PR，`gh pr view --json state` = MERGED（watchdog:233 同款；Brain 容器 Dockerfile:27 已装 gh，GITHUB_TOKEN 已注入）
- evaluator gate：`_hasEvaluatorGate`（watchdog:59）事件存在

**分支语义**：
- 真相成立 → completed + 既有副作用（promoteRegression 等）+ C3 事件收尾
- 不成立 → 降级中间态：保持 in_progress + `payload.generator_done=true`，**返 200 `{accepted:false, reason}`**。绝不 409（防冻结期 report/controller skill 把非 2xx 当可重试造死循环；与 task-tasks.js:266 既有 TERMINAL 守卫叠加不冲突）

**四个 completed 入口全部接 finalize**：
1. `callback-processor.js:99` processExecutionCallback（generator callback 主漏点）
2. `routes/tasks.js:357` PATCH /tasks/:id
3. `routes/task-tasks.js:292` PATCH /task/:id
4. `routes/harness.js:1494` POST /harness/complete（report 主用口，审查时抓漏补上）

非 harness_initiative 任务不受影响（finalize 只拦 task_type='harness_initiative' 且 orchestrator='skill-relay'）。

**watchdog 侧两刀**：
- 重点火短路：`resumeStalledRelayRuns`（watchdog:306+）当 `payload.generator_done=true` 时禁止二次 spawn generator（防重复 PR，e90c0fbb 变体）
- 超时兜底：generator_done=true 且超 6h 无 MERGED → 标 failed（防 pr_url 空永挂；与 ZOMBIE_REAPER_IDLE_MIN=60min 语义不冲突——zombie-reaper 对 onStale='reignite' 的 relay 容器本就跳过，executor-contracts.js:103）

存量已 MERGED 的 in_progress 任务由 watchdog 下轮自然收口，不写一次性脚本。

## 测试策略（integration 档：vitest + mock pool，brain-unit CI）

范式取 `harness-relay-watchdog.test.js`（vi.hoisted + 按 SQL 分派 mock query）。每闸先 failing test（commit-1 红 / commit-2 绿），永久留 CI：

- 刀B：behavior_tests 声明空数组→FAIL；条目缺 exit_code→FAIL；条目 log_tail 空真机→FAIL；contract_tests=0（无测试文件+无[BEHAVIOR]）→FAIL；judgments 声明 5 回读 0→FAIL；非数字声明→FAIL；无声明→跳过；local_api 条目无 log_tail 有命令输出→PASS 不误杀；机械闸 FAIL 时 judgeFn spy 零调用
- migration 342：迁移后 INSERT 带 source_ref 可写可查
- C1：INSERT SQL 断言含 current_task_id；C2：judge 调用后 UPDATE 落库、PASS 不被 FAIL 回退、0 行 non-fatal；C3：三口收尾后 running 计数=0
- 收账：callback completed→in_progress+generator_done；真相成立（MERGED+gate）→completed；无真相→200 accepted:false 非 409；/harness/complete 同拦；generator_done 重点火短路；6h 超时→failed
- smoke.sh + smoke-allowlist 登记同 PR（铁律 3efefc23）；部署前 node --check server.js

## 风险与边界

- e90c0fbb（pr_url 空）被超时兜底缓解但不全销，issue 保持开放注明
- 并发：callback/watchdog 均带 `WHERE status='in_progress'` 乐观锁，后到 no-op；completed→completed 由 isStatusNoop 幂等
- report skill 收到 200 accepted:false 的行为：其现文本视 2xx 为成功，收口语义正确；真相未成立时任务留给 watchdog，符合设计
- 涉及文件路径全部以 `packages/brain/src/` 根为准（harness-judge.js / harness-skill-relay.js / harness-relay-watchdog.js / callback-processor.js / executor.js / routes/{harness,tasks,task-tasks,initiatives,strategic-decisions}.js）
