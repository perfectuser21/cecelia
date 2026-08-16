# Sprint PRD — 每条 Run 起手召唤 Commander（Work Router 透传 commander_mode/profile + F1 线默认 hybrid + 真 canary 全程唤醒）

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：Commander 代码 07-28 已落地（#4393），但入口不通，160 条 run 全 kernel-only，Commander 事实不可达
- **本次推进预期**：+2%（打通 Commander 入口，F1 线获得「有人看模式并指挥」的能力）

## 背景

Commander（每 Run 一个 provider-neutral LLM 监工）代码已存在于 `packages/brain/src/orchestrator/commander-*.js`，loop.js 已接线，只读观测端点 `/api/brain/harness-commander/*` 已就绪。但 #4872 之后所有 coding 任务只从 `POST /tasks → Work Router → createRoutedTask → createKernelRun` 进入，这条路没有 `commander_mode/commander_profile` 字段，`kernel-run-store.js` 缺省一律 kernel-only——Commander 永远不被召唤。本 sprint 把入口透传打通，让 F1 线默认走 hybrid，并用一条真实 F1 bugfix 任务跑通 Commander 全程唤醒作为真验收。对齐 PRD `docs/superpowers/specs/2026-07-25-provider-neutral-harness-commander-fusion-prd.md` FR-1/FR-2/FR-3。

## Golden Path（核心场景）

系统从 [一条 F1 编码任务入队] → 经过 [Work Router 透传 commander_mode + Commander 起手召唤 + 全程必唤醒节点指挥] → 到达 [真 canary run 落地 ≥5 条 commander.directive_accepted 且至少一次异常唤醒被 kernel 执行]。

具体：

1. 用户/Brain 提交 `POST /api/brain/tasks`，body 可带 `commander_mode`（legacy-session|kernel-only|hybrid）、`commander_profile`（严格 commander-profile.js schema，禁未知键）、`commander_retry_budget`。
2. Work Router（`createRoutedTask → createKernelRun`）接收并透传这三个字段：写入 `initiative_runs.commander_mode` 与 payload；routing receipt evidence 记录来源。
3. 未显式指定且 `map_scope` 含 F1（或 journey `e6f803f2`）的 coding_mutation 任务 → 默认 `commander_mode=hybrid`，默认 profile `primary={provider:'codex',account:'team2',machine:'us-mac-m4'}`、`fallbacks=[{provider:'claude',account:'account2',machine:'us-mac-m4'}]`；显式 `kernel-only` 可关；其他线保持 kernel-only 不变。
4. 非法 profile 键 → `POST /tasks` 返回 400 `invalid_commander_profile`，不落库。
5. hybrid run 首跳必须是 Commander 唤醒：Commander directive 落 decision log（`action=commander.directive_accepted`）后 kernel 才派 Planner。
6. 后续按 FR-2 必唤醒节点唤醒：Planner 完成 / 每轮 Proposer-Reviewer 结束 / 合同批准或连续拒绝 / 进 Generator 前 / CI 或 Evaluator 结果 / Judge verdict / Merge 前 / 终态 / 连续无进展（同一 gate_verdict 连续 ≥3 跳）/ 未知错误 / Provider 反复失败。普通心跳、单次瞬时 503、可由 L0 确定性策略处理的故障不唤醒。
7. Commander bundle 的 `newEvents/activeRisks` 必须看得见闸的真实结论：impact_gate 的 reason/retryable/detail（含 unclaimed_files、缺覆盖能力）、capacity/admission 的 signature 与 admission_reasons、attempt 的 error_code/failure_class。
8. 真 canary（一条真实 F1 bugfix，可用 f9f943fc 或其 successor）以 hybrid 从头跑，产出 Commander 全程事件，至少一次异常唤醒由 Commander 给出非 `continue_default` 指令并被 kernel 执行或记录 `request_human`。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry / commander-profile.js schema 后推导，Planner 不定义技术规范。 -->

## 边界情况

- `commander_profile` 含未知键（如历史 `strict_affinity`）→ zod 拒绝 → 400 `invalid_commander_profile`，不静默丢弃。
- `map_scope` 含 F1 但显式传 `commander_mode=kernel-only` → 尊重显式值，不强制 hybrid。
- 非 F1 线任务未带字段 → 保持 kernel-only，行为零变化（回归不破坏存量 160 条路径）。
- 不同 run 的原始 prompt/合同/反馈不得进入另一 run 的 CommanderBundle（FR-1 隔离）。
- Commander 自由文本不得直接触发副作用；缺 schema/证据引用/游标/合法 action 的结果只记录为无效建议。

## 范围限定

**在范围内**：`POST /tasks` 与 Work Router 的 commander_mode/profile/retry_budget 透传；F1 默认 hybrid + 默认 profile；起手召唤与 FR-2 必唤醒节点接线；commander-bundle 读取闸真实结论；一条真 canary run 的全程事件产出与验收。

**不在范围内**：不把旧 harness-controller SKILL prompt 塞进 kernel；不给 Commander 绕过任何门禁的能力；不改 kernel 执行权；不接 xian 两台（另立 Fleet 三机准入单）；不改 diff-gate（f9f943fc 负责，本单若其未合入只做 bundle 侧读取）。

## 假设

- [ASSUMPTION: commander-profile.js 已导出可复用的 zod schema，routes 侧直接引用做 400 校验，无需新建校验器。]
- [ASSUMPTION: f9f943fc（或其 successor）为可复现的真实 F1 bugfix 任务，canary 从头跑不依赖已被删除的分支/PR。]
- [ASSUMPTION: f9f943fc 的 diff-gate 透传结果（unclaimed_files/缺覆盖能力）已合入；若未合入，本单仅在 commander-bundle 侧读取现有字段，不改 diff-gate。]
- [ASSUMPTION: 默认 hybrid 判定的「F1 归属」以 map_scope 含 "F1" 或 journey_id=e6f803f2 为准，coding_mutation 任务类型才触发默认。]

## 预期受影响文件

- `packages/brain/src/routes/task-tasks.js`（或 `tasks.js`）：`POST /tasks` 接受并校验 commander_mode/commander_profile/commander_retry_budget，非法 profile 返回 400。
- `packages/brain/src/work-routing-store.js`：`createRoutedTask` 透传三字段；F1 默认 hybrid + 默认 profile 注入。
- `packages/brain/src/orchestrator/kernel-run-store.js`：`createKernelRun` 接收并写入 `initiative_runs.commander_mode` 与 payload；receipt evidence 记来源。
- `packages/brain/src/orchestrator/commander-coordinator.js`：起手召唤（首跳唤醒）+ FR-2 必唤醒节点判定（含同一 gate_verdict 连续 ≥3 跳、单次 capacity_contended 不唤醒）。
- `packages/brain/src/orchestrator/commander-bundle.js`：activeRisks 补 impact_gate.reason/retryable、admission_reasons、error_code/failure_class；跨 run 隔离。
- `packages/brain/src/orchestrator/loop.js`：接线首跳召唤先于 Planner 派发。
- `packages/brain/package.json` 等四处 + DEFINITION.md / selfcheck：semver bump 同步。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 两源均空）+ PrepPRD 显式值优先 -->
- 透传完整性：commander_mode/commander_profile/commander_retry_budget 三字段全链（POST→Work Router→createKernelRun→initiative_runs+payload）不丢字段。
- 可观测：`GET /api/brain/harness-commander/runs/:runId/commander` 返回 status 与 event_cursor，且 event_cursor 单调递增。
- 隔离性（FR-1）：不同 run 的合同/反馈/私有上下文不进本 run bundle。
- 门禁不可绕过：Commander 不得获得绕过 impact_gate/admission/diff-gate 的能力；kernel 保留唯一执行权。
- 版本要求：Brain semver bump 四处同步 + DevGate 三项（facts-check / check-version-sync / check-dod-mapping）全过。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(空) + journey_feature(ability_id 空) + area 三源合并去重；仅注入系统级铁律与本 sprint 直接相关技术铁律，capture-triage 操作学习条目从略 -->
- [单槽串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [多租户默认] 测试默认多租户（来源: area）
- [凭据安全] API Key/Token/密钥不入 git（来源: area）
- [日志脱敏] 日志必须脱敏（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 租户隔离（来源: area）
- [planner分支] planner 绑定 server 签发的 role branch，不自行 checkout/switch（来源: area, planner_role_branch）
- [重试身份] generator 基础设施重试保持 retry_of/logical_cycle_id 身份，终态 Attempt 不复活、跨 provider/机器不复用旧 Session ID（来源: area, generator_infrastructure_retry_identity；直接约束 Commander 的 retry_attempt/switch_provider/switch_machine）
- [环境读payload] target_environment 从 DB tasks.payload 读取，任务注册时须正确设置（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 已完成 ability 的 golden_path；已验收（done/working）ability 为空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl + psql）
# 期望验收点（自然语言）：
# 1) 单测层：POST /tasks 带 commander_mode=hybrid+合法 profile → createKernelRun 收到同值、initiative_runs.commander_mode='hybrid'；
#    非法 profile 键 → 400 invalid_commander_profile；未带且 map_scope 含 F1 → 落库 hybrid+默认 profile；显式 kernel-only → kernel-only。
# 2) 单测层：hybrid run 首跳为 Commander 唤醒且 Planner 在 directive_accepted 之后派发；同一 gate_verdict 连续 3 跳触发唤醒；单次 capacity_contended 不唤醒。
# 3) 单测层：commander-bundle activeRisks 含 impact_gate.reason/retryable、admission_reasons、error_code；跨 run 合同/反馈不进本 run bundle。
# 4) 真 canary（数据写入类）：psql 查 orchestrator_decision_log 该 run ≥5 条 action='commander.directive_accepted' 分布于 Run 启动/Planner 完成/合同批准/Generator 前/Evaluator 或 Judge 结果；
#    harness_attempts role='commander' ≥5 条 completed；GET /api/brain/harness-commander/runs/:runId/commander 返回 status 且 event_cursor 单调递增；
#    ≥1 条异常唤醒 directive action ∈ {retry_attempt,switch_provider,switch_machine,revise_guidance,pause_run,request_human} 被 kernel 执行或记录 request_human。
```

## journey_type: autonomous
## journey_type_reason: 改动集中在 packages/brain/src/orchestrator 与 routes（纯后端调度/kernel 接线），无 UI、无 engine hooks、非远端 agent 协议，命中 brain 后端分支。
## target_environment: local_api
## target_environment_reason: 仅 packages/brain 纯 API/后台任务，E2E 走本地 evaluator（curl localhost:5221 + psql orchestrator_decision_log/harness_attempts）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
