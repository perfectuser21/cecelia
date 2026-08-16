# Sprint PRD — 每条 Run 起手召唤 Commander（Work Router 透传 + F1 线默认 hybrid + 真 canary 全程唤醒）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」
- **当前进度**：82%
- **本次推进预期**：+2%（让 Commander 从"代码已落地但不可达"变为"每条 F1 run 起手必召唤、全程指挥"）

## 背景

Commander（每 Run 一个 provider-neutral LLM 监工）代码 07-28 已落地（orchestrator/commander-*.js + loop.js 接线 + 只读端点 /api/brain/harness-commander/*）。但 #4872 后所有 coding 任务只走 POST /tasks → Work Router（createRoutedTask）→ createKernelRun，这条路不透传 commander_mode/commander_profile，kernel-run-store 缺省一律 kernel-only——近 7 天 160 条 run 全 kernel-only，Commander 事实不可达。今晚三条 run 死于"代码只会重试、需要有人看出模式并指挥"的场景（Impact 闸空转 130 跳到 deadline / hotfix 直派 Generator 13 秒死 / 单槽容量连挡）。本 sprint 打通入口透传，让 F1 线默认 hybrid，并用真 canary 验证 Commander 全程唤醒。对齐 PRD `docs/superpowers/specs/2026-07-25-provider-neutral-harness-commander-fusion-prd.md` FR-1/FR-2/FR-3。

## Golden Path（核心场景）

系统从 [POST /tasks 入口] → 经过 [Work Router 透传 + F1 默认 hybrid + 起手召唤 Commander] → 到达 [真 canary run 全程 Commander 唤醒并落 decision log]。

具体：
1. 调用方 POST /api/brain/tasks，可带 `commander_mode`(legacy-session|kernel-only|hybrid)、`commander_profile`({primary:{provider,account,model?,machine?}, fallbacks[]}，严格按 commander-profile.js schema，未知键报错)、`commander_retry_budget`。
2. Work Router（work-routing-store.js createRoutedTask → createKernelRun）透传三字段并写入 `initiative_runs.commander_mode` 与 payload；receipt evidence 记录来源。map_scope 含 F1（或 journey e6f803f2）的 coding_mutation 任务未显式指定时默认 `commander_mode=hybrid`、profile primary={provider:'codex',account:'team2',machine:'us-mac-m4'}、fallbacks=[{provider:'claude',account:'account2',machine:'us-mac-m4'}]；显式 kernel-only 可关；其他线保持 kernel-only 不动。
3. hybrid run 首跳必为 Commander 唤醒（FR-2「Run 启动」节点）；Commander directive 落 orchestrator_decision_log（action=`commander.directive_accepted`）后 kernel 才派 Planner。
4. 后续按 FR-2 必唤醒清单触发：Planner 完成 / 每轮 Proposer-Reviewer 结束 / 合同批准或连续拒绝 / 进 Generator 前 / CI 或 Evaluator 结果 / Judge verdict / Merge 前 / 终态 / 连续无进展（同一 gate_verdict 连续 ≥3 跳）/ 未知错误 / Provider 反复失败。普通心跳、单次瞬时 503、L0 确定性可处理的故障不唤醒。commander bundle 的 newEvents/activeRisks 必须含闸真实结论：impact_gate 的 reason/retryable/detail（含 unclaimed_files、缺覆盖能力）、capacity/admission 的 signature 与 admission_reasons、attempt 的 error_code/failure_class。
5. 用一条真实 F1 bugfix 任务以 hybrid 从头跑通，产出 Commander 全程事件（出口可观测）。

## 边界情况

- 非法 commander_profile（含未知键如 strict_affinity）→ 400 `invalid_commander_profile`，不落库。
- 未带 commander_mode 且 map_scope 不含 F1 → 保持 kernel-only（其他线零回退）。
- 单次 capacity_contended / 瞬时 503 → 不唤醒 Commander（避免噪音）。
- 异常唤醒（连续无进展或 infrastructure_blocked 重复）→ Commander 给非 continue_default 指令并被 kernel 执行或记录 request_human。

## 范围限定

**在范围内**：POST /tasks 与 Work Router 入口透传三字段；initiative_runs.commander_mode 落库 + receipt evidence；F1 线默认 hybrid + 默认 profile；hybrid 首跳起手召唤；FR-2 必唤醒节点接线；commander bundle 读到闸真实结论；真 canary F1 bugfix run 验证。
**不在范围内**：不把旧 harness-controller SKILL prompt 塞进 kernel；不给 Commander 绕过任何门禁的能力；不改 kernel 执行权；不接 xian 两台（另立 Fleet 三机准入单）；不改 diff-gate（f9f943fc 负责，本单若其未合入只做 bundle 侧读取）。

## 假设

- [ASSUMPTION: commander bundle 透传的闸结论以 f9f943fc 的 diff-gate 透传结果为源；若其未合入，本单仅在 bundle 侧读取现有字段，不改 diff-gate。]
- [ASSUMPTION: F1 线判定依据 = payload.map_scope 含 'F1' 或 payload.journey_id == 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'。]
- [ASSUMPTION: 真 canary 采用 f9f943fc 或其 successor 的真实 F1 bugfix 任务；前置 Runner 已由 #4912 修复重钉（Brain 1.273.60，us-mac-m4 准入 clean）。]

## 预期受影响文件

- `packages/brain/src/routes/task-tasks.js`（或 tasks.js）：POST /tasks 接受并校验 commander_mode/commander_profile/commander_retry_budget，非法 profile → 400。
- `packages/brain/src/work-routing-store.js`：createRoutedTask → createKernelRun 透传三字段 + F1 线默认 hybrid + 默认 profile。
- `packages/brain/src/orchestrator/kernel-run-store.js`：createKernelRun 接收 commander_mode，写 initiative_runs.commander_mode 与 payload（不再一律 kernel-only）。
- `packages/brain/src/orchestrator/loop.js`：hybrid 首跳起手召唤 + FR-2 必唤醒节点接线，directive_accepted 后才派 Planner。
- `packages/brain/src/orchestrator/commander-coordinator.js`：唤醒判定（起手/连续无进展/异常，跳过瞬时故障）。
- `packages/brain/src/orchestrator/commander-bundle.js`：newEvents/activeRisks 纳入 impact_gate reason/retryable、admission_reasons、error_code。
- `packages/brain/src/orchestrator/commander-profile.js`：复用 strict schema（透传校验入口）。
- `packages/brain/package.json` 等 semver 四处同步；decisions 表新增「F1 线默认 hybrid」决策。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 journey 空）+ PrepPRD 显式值 -->
- 超时/延迟: commander_retry_budget 由入口透传（无硬编码默认；缺省沿用 Commander 现有预算）
- 频控: 单次瞬时 503 / capacity_contended 不唤醒（避免 Commander 噪音）
- 版本要求: Brain semver bump 四处同步 + DevGate 三项通过
- 可观测: 每次唤醒必落 orchestrator_decision_log（action=commander.directive_accepted）；harness_attempts role='commander' 记录；receipt evidence 记来源

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [不绕门禁] Commander 只指挥不执行，禁止获得绕过任何 gate（impact/capacity/CI）的能力（来源: PrepPRD 不做项）
- [不改执行权] 不改 kernel 执行权，Commander directive 由 kernel 执行或记录 request_human（来源: PrepPRD 不做项）
- [run 隔离] 不同 run 的合同/反馈不得进入本 run 的 commander bundle（来源: PRD FR-1 隔离）
- [nightly-red 原始日志] 连续 ≥3 晚同一 job 红时 issue 贴失败 step 最后 20 行原始 stdout，非 PowerShell 截断（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无 done/working 历史 ability；journey e6f803f2 现有 golden-path 均为 planned 态，无已验收行为可回退）

## E2E 验收

> 本区块为 Planner 初稿占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl localhost:5221 + psql）
# 期望验收点（自然语言）：
# 1. 真 canary hybrid F1 bugfix run 从头跑通后，psql 查 orchestrator_decision_log 该 run 至少 5 条
#    action='commander.directive_accepted'，分布在 Run 启动 / Planner 完成 / 合同批准 / Generator 前 /
#    Evaluator或Judge 结果 五个唤醒点。
# 2. psql 查 harness_attempts role='commander' 至少 5 条 status='completed'。
# 3. GET /api/brain/harness-commander/runs/:runId/commander 返回 status 与单调递增的 event_cursor。
# 4. 至少一条异常唤醒的 directive action ∈ {retry_attempt,switch_provider,switch_machine,revise_guidance,pause_run,request_human}（非 continue_default）。
# 5. 单测三组绿：routes/task-tasks + work-routing-store 透传/默认/400；loop/commander-coordinator 首跳与连续3跳唤醒、单次 capacity_contended 不唤醒；commander-bundle activeRisks 含闸结论 + run 隔离回归。
```

## journey_type: autonomous
## journey_type_reason: 全部改动落在 packages/brain 后端 orchestrator（work-router/kernel-run-store/loop/commander-*），无 UI 与远端 agent 交付面，属 Brain 内部自主调度。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api，验收为 curl localhost:5221 + psql 查 orchestrator_decision_log/harness_attempts，本地 evaluator 执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
