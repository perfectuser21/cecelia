# Bug PrepPRD：harness 生命周期/记账/验收判据下沉 Brain 代码（刀B+刀C+收账权收归）

任务：d0a668d9-9f12-4871-a2c9-42cd6fa7ccc8 ｜ 决策依据：dc18d43d「无闸不成文」｜ 证据源：issue 3c541792 #1-10（task f35db586 dogfooding 实证）

## 症状
SKILL 文本硬要求被 LLM 成批无视：behavior_tests=0 照样 PASS；judgments_written=5 虚报（DB 0 条）；generator callback 提前把 harness_initiative 标 completed(merged:false)；judge_verdict 未上报落库；spawn 不写 initiative_runs.current_task_id（relay-runs ?task_id= 恒空）；skill-relay-spawn 事件 17 条永久 running。

## 根因
生命周期/记账/验收判据全靠 SKILL 文本条文约束 LLM 自觉，Brain 侧无机械闸：judge API 只透传不校验不写库；PATCH /tasks 谁传 completed 都收；/harness/complete 直接 UPDATE completed；spawn INSERT 缺列；事件写完即弃。

## 修法（三块，全 Brain 代码，每项先 failing test）

### 刀B — judge API 机械校验（harness-judge.js runJudgeGate 进 DeepSeek 前，纯代码闸）
1. **behavior_tests 非空**：扫 worktree 下 `tests/*.test.{ts,js,sh}` + `**/__tests__/*.test.{js,ts}`（对齐 harness-judge.js:133 的 join(worktreePath, sprintDir) 口径），fallback 数 contract-dod [BEHAVIOR] 条目；计 0 → verdict=FAIL, judged=true，feedback 写明缺项
2. **verdict 证据完整**：.brain-result.json 需有 exit_code（可为 0）+ log_tail/stdout 非空；缺 → FAIL。按 target_environment 校准（铁律 9216d107）：真机类环境要求设备日志；local_api 等弱环境命令输出即满足；缺省按 local_api（最宽）防误杀存量
3. **judgments_written 对账**：声明值从 .brain-result.json 的 judgments_written 字段读（reviewer skill 已产出该字段，harness-contract-reviewer/SKILL.md:437；judge 已在 harness-judge.js:142 读此文件——无需动冻结的 skill 文本）（无声明则跳过，不假收敛——两侧接线见下）；回读 decisions 表 `category='judgment' AND source_ref=<task_id>`；声明>回读 → FAIL。**同 PR 接线**：strategic-decisions.js:90 POST 的 INSERT 补 source_ref 列写入口（**decisions 表无此列——本 PR 补 migration 342 加 source_ref TEXT 列**；migration 302 只有 level/target_type/target_id/scope，勿混）；无 source_ref 数据退化 reason LIKE+时间窗
4. 机械闸 FAIL 直接返回不调 DeepSeek（judgeFn 注入 spy 断言被调 0 次）

### 刀C — 三小件
- **C1**：harness-skill-relay.js:296（codex）/:546（headed）两处 INSERT initiative_runs 补 current_task_id=task.id（参数化占位符）
- **C2**：judge API 判定后自写 `UPDATE initiative_runs SET judge_verdict WHERE current_task_id=<task_id>` 最新 run（started_at DESC LIMIT 1）；judged=true 才写；`WHERE judge_verdict IS DISTINCT FROM 'PASS'`（允许 FAIL→PASS 收敛、禁 PASS→FAIL 回退）；UPDATE 0 行/落库失败 non-fatal 不吞裁决
- **C3**：skill-relay-spawn 事件终态回收三口：①_finalizeMergedRun 成功路径 ②attempt-cap failed 分支（harness-relay-watchdog.js:288-304）③孤儿 sweep——按 initiative_runs.deadline_at 过期 JOIN initiative_run_events 批量收尾（事件表自身无 deadline_at，勿混表）；SQL 形态 `UPDATE initiative_run_events SET status, ts_end WHERE initiative_id=$1 AND node='skill-relay-spawn' AND status='running'`

### 收账权收归 — 终态绑定外部真相（不是自声明标记）
核心设计：**Brain 把 harness_initiative 的任何 completed 请求当"申请"，自己机械核验外部真相后才落终态**（finalized_by 自声明方案被 Challenger 否决——LLM 跑 curl 可伪造）：
1. **统一 finalize 函数**（新增，harness 专用）：核验 ①pr_url 存在且 PR 状态 MERGED（gh/GitHub API 或已存证据）②initiative_run_events 有 evaluator done（复用 _hasEvaluatorGate 范式）。真相成立→completed+副作用（promoteRegression 等）；不成立→降级中间态（保持 in_progress + payload.generator_done=true），**返 200 带 accepted:false**，绝不 409（防冻结期 report skill 死循环重试；task-tasks.js:266 已有 TERMINAL 守卫与此叠加不冲突）
2. **四个 completed 入口全部接 finalize**：callback-processor.js:99（generator callback 主漏点）/ tasks.js:357 PATCH / task-tasks.js:292 PATCH / **routes/harness.js:1494 POST /harness/complete（report 主用口，Challenger 抓漏）**
3. **watchdog _finalizeMergedRun 保留**为合法终态源（它本身就是外部真相核验）
4. **重点火短路**：resumeStalledRelayRuns（harness-relay-watchdog.js:306+）在 generator_done=true 时禁止二次 spawn generator（防重复 PR，e90c0fbb 变体）
5. **超时兜底**：generator_done=true 但 N 小时无 MERGED → watchdog 标 failed（防 pr_url 空永挂；N 与 ZOMBIE_REAPER_IDLE_MIN=60min 语义对齐，取 6h 级别）；zombie-reaper 不会误杀（executor-contracts.js:103 onStale='reignite' 已跳过，Challenger 已核实）
6. **存量收口**：上线后已 MERGED 的存量 in_progress 靠 watchdog 下轮自然收口，不写一次性脚本

## 关联上下文
- Issue：3c541792（收窄销案对应项）、45dd6925（保持开放）、e90c0fbb（超时兜底部分缓解，注明不全销）
- 铁律：dc18d43d / 9216d107 / 6d11717d / 09fb5c69 / c1d0abce / 3efefc23（smoke.sh+allowlist 同 PR 带齐）

## Regression Test 计划（每项 failing test 先行，永久留 CI brain-unit）
- 刀B：behavior_tests=0→FAIL；exit_code 缺→FAIL；judgments 声明 5 回读 0→FAIL；无声明→跳过不 FAIL；local_api 无真机日志有命令输出→不误杀；机械闸 FAIL 时 judgeFn 零调用
- C1：INSERT SQL 含 current_task_id 参数；C2：judge 后无需二次 PATCH 即查到 judge_verdict、PASS 不被 FAIL 回退；C3：三条收口路径后 running 计数=0
- 收账：callback completed→仍 in_progress+generator_done；PR 真 MERGED+evaluator gate→completed；/harness/complete 无真相→200 accepted:false 非 409；generator_done 后重点火被短路；超时无 MERGED→failed 非永挂

## 哨兵守卫
全部逻辑接缝→CI regression test（上述）；proven-to-fire：每个闸先写 failing test 亲眼看红。环境接缝无新增（不碰真机/生产 env 读取）。

## 验收标准
- [ ] 每项 failing test 先 commit（commit-1）、修复变绿（commit-2）
- [ ] smoke.sh + smoke-allowlist 登记同 PR（铁律 3efefc23）
- [ ] CI 全绿（brain-unit 必过）
- [ ] node --check 冒烟后 brain-deploy（feedback_brain_deploy_syntax_smoke）
