# PRD — Provider-Neutral Harness 有界运行与正确恢复

日期：2026-07-23

状态：待 One Session `/dev` 实施，完成后由独立 Codex 复审

优先级：P0

执行方式：美国本机 One Session；Brain 核心、迁移和架构改动禁止派给 Codex 实施

## 1. 背景与问题定义

Provider-neutral Harness Kernel 已具备按角色选择 Claude、Codex、Grok 和独立 Judge、
attempt 落库、回调认证、lease fence、decision log 回放等基础能力，但真实 fire drill 暴露出
它仍继承了 Long Graph 的失控运行尺度。

生产 run `d707ae20-2286-4d6e-a2fe-dc6a9bcf4e92` 的事实：

- 运行 529.90 分钟，约 8 小时 50 分；旧 one-session 最近 14 天 run 中位数为
  92.98 分钟，本 run 慢约 5.7 倍；
- `deadline_at` 恰为 started_at + 8 小时，但 Kernel 没在 deadline 到达时停止，晚约
  50 分钟才因 `fix_cap` 结束；
- 记录 66 个 decision-log hop、44 条 attempt；
- Judge 在 hop 56 因 Evaluator 证据缺少 `exit_code/log_tail` 判 FAIL，这是 Harness
  证据问题，不是产品代码问题；
- Kernel 把所有 Judge FAIL 无差别路由给 generator-fix；
- hop 57–66 连续 10 次 generator-fix 均锚定同一 PR SHA
  `dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7`；Generator 多次报告“无需修改”，
  Kernel 仍继续派发；
- 当前常量允许 20 次 fix、200 hops；Codex/Grok supervisor 默认单 worker deadline
  也是 28800 秒（8 小时）；
- `pollCount` 和 `blockedStreak` 只在进程内，Kernel 重启后归零。

这不是 mixed-provider 的必要成本，而是错误分类、错误路由、无进展检测缺失和软 deadline
共同造成的失控循环。本 Sprint 必须先把 Kernel 约束到 one-session 可接受的 1–2 小时范围，
再继续 Human Validation Runtime。

## 2. 目标

把 Kernel 从“最多跑 8 小时、20 次无差别修复”改为“120 分钟内明确完成、等待人工或带证据
失败”的有界状态机：

1. 自动执行总预算不超过 120 分钟；
2. Judge/Evaluator 失败按责任域分类，只有产品代码失败能进入 generator-fix；
3. generator-fix 必须产生新 PR SHA，否则立即以 no-progress 终止；
4. 同一失败最多 3 个有效 fix round，禁止同 SHA 重复烧模型；
5. timeout、poll、blocked、no-progress 计数跨进程重启保持；
6. 一条小型真实 mixed run 在无人手工改 DB、无人手工杀容器的条件下完成到 human-review；
7. 人工批准能通过受认证的 Kernel approval bridge 形成 `verdict:human_review` 并完成收尾；
8. 旧 one-session/controller 路径保持可回滚。

## 3. 非目标

- 本 Sprint 不实现网页 Playwright、CLI PTY、桌面或手机 RPA；
- 不实现关键步骤截图和 Human Validation Evidence Console；
- 不重写 Kernel，不引入 LangGraph/checkpoint 作为真相源；
- 不新增第四套状态机；
- 不以降低 Judge 严格度、跳过 Evaluator 或自动批准 human-review 换取速度；
- 不把 120 分钟之外的超时继续包装成“运行中”；
- 不修改与 Harness 有界恢复无关的 Brain 模块。

Human-perspective Evaluator/RPA 必须在本 Sprint 合并并通过真实 fire drill 后单独立 PRD。

## 4. 运行时间合同

### 4.1 总预算

- Kernel 自动执行预算：从 run `started_at` 到首次成功写入
  `effect:human_review_requested`，硬上限 120 分钟；无需人工审核时，预算计算到 `done/failed`。
- 进入 human-review 后必须停止 worker、停止自动 fix、停止占用 active automation slot；人的等待时间
  不计入自动执行预算。
- 人工批准后只允许一个最长 15 分钟的 merge/report 收尾预算，不能恢复一个新的 120 分钟周期。
- 每轮 loop 在 collect 前、derive 后、dispatch 前都必须检查 DB 时间预算。Kernel 自身是第一执行者，
  watchdog 只能做第二道兜底。
- deadline 到达后必须写 terminal reason `automation_deadline_exceeded`，停止/回收当前 attempt，
  不得 requeue 为新 run 继续消耗。

### 4.2 阶段预算

阶段预算用于提前失败诊断；总预算仍是最终硬门：

| 阶段 | 最大自动时间 | 超时 reason |
|---|---:|---|
| planning | 10 分钟 | `planning_deadline_exceeded` |
| contract GAN | 20 分钟 | `gan_deadline_exceeded` |
| generate + fix | 45 分钟 | `generation_deadline_exceeded` |
| evaluate + judge | 30 分钟 | `verification_deadline_exceeded` |
| merge + report | 15 分钟 | `delivery_deadline_exceeded` |

未使用的阶段预算可以被后续阶段使用，但任何阶段不得突破 120 分钟总预算。时间必须由注入的 clock
或 DB timestamp 推导，纯函数测试禁止依赖真实 `Date.now()`。

### 4.3 Worker 预算

- planner/proposer/reviewer/judge 单 attempt 最大 10 分钟；
- generator/evaluator 单 attempt 最大 30 分钟；
- worker timeout 必须取 `min(角色上限, run 剩余预算)`；
- Codex/Grok supervisor 默认 `SUPERVISOR_DEADLINE_SECONDS` 不得再是 28800；
- worker 超时必须形成结构化 terminal callback，不能只靠容器消失让 watchdog 猜。

## 5. 失败分类与责任路由

Evaluator/Judge 的非 PASS 结果必须带 `failure_class`。Kernel 只认以下枚举：

| failure_class | 责任域 | Kernel 动作 | 是否允许 generator-fix |
|---|---|---|---|
| `product_failure` | PR 产品代码/行为错误 | `spawn:generator-fix` | 是 |
| `evidence_invalid` | checks、exit_code、log_tail、截图/manifest 缺失或非法 | `spawn:evaluator-evidence-repair` | 否 |
| `contract_invalid` | PRD/contract 不可验或相互冲突 | terminal failed，交回合同修订任务 | 否 |
| `environment_failure` | 凭据、额度、网络、镜像、挂载、依赖环境 | 同角色换账号/恢复一次；仍失败则 terminal | 否 |
| `unknown` | 无法可靠归类 | `needs_context` 一次；仍未知则 terminal | 否 |

规则：

1. Judge 不得只返回裸 `FAIL`；缺 `failure_class` 视为 `unknown`，禁止默认归为产品代码失败。
2. `evidence_invalid` 修的是 attempt evidence/result，不修改 PR 产品代码；允许 PR SHA 不变，但新的
   evidence digest 必须变化。
3. `environment_failure` 的重试不得消耗 product fix round，但同一角色、同一错误签名最多恢复一次。
4. `contract_invalid` 不在当前 run 内重新开启无上限 GAN；必须明确失败并创建独立后续任务。
5. 失败分类、触发 SHA、责任角色、下一动作必须写入 decision log，供回放和审计。

## 6. 进展证明与熔断

### 6.1 Progress token

每个修复动作必须声明并在下一跳验证 progress token：

- generator-fix：`pr_head_sha` 必须从触发该修复的 SHA 变化为新 SHA；
- evaluator-evidence-repair：PR SHA 可不变，但 `evidence_digest` 必须变化且新证据通过 schema；
- contract revision：合同分支 SHA 和 round 必须前进；
- environment recovery：provider/account/session 或已验证的环境错误签名必须变化。

Worker 自称“FIXED/DONE”不是进展证据。

### 6.2 No-progress 行为

- generator-fix terminal 后 PR SHA 未变化：立即标记 `no_progress_same_sha`，本 run 终止；
- 禁止对相同 `(run_id, failure_class, trigger_sha, role)` 再派第二个 generator-fix；
- evaluator evidence repair 后 digest 未变化：立即标记 `no_progress_same_evidence`；
- no-progress 必须保存触发 attempt、旧/新 token 和 worker summary；
- 不允许通过重启 Kernel、创建新 hop 或更换 provider 绕过 no-progress fence。

### 6.3 上限

- `MAX_FIX_ROUNDS` 从 20 降为 3，只统计产生新 SHA 的有效 product fix；
- `MAX_HOPS` 从 200 降为 60；
- 相同环境错误签名恢复上限为 1；
- 相同 `BLOCKED/NEEDS_CONTEXT` 上限为 2，且计数必须来自持久化 decision log；
- CI pending 的 30 分钟上限必须跨 Kernel 重启保持，不能使用会归零的进程局部变量作为权威。

## 7. 持久化与恢复不变量

1. 所有 cap、streak、首次等待时间、progress token 都从 DB/decision log/PR 外部真相推导。
2. Kernel 重启后，相同输入必须得到相同下一动作和相同剩余预算。
3. active attempt 判定必须同时检查 `harness_attempts` lease/status 和真实容器/进程，不能只看 Docker。
4. run deadline 过期时 watchdog 不得 resume/requeue；只允许 fenced terminal cleanup。
5. 成功的 Evaluator evidence 可以在 Brain/Parser 修复后复用，不得因 Judge 环境故障重复跑 Evaluator。
6. verdict 必须绑定 PR SHA；evidence verdict 另绑定 evidence digest。
7. 旧 session/checkpoint 只能作为同 attempt 的执行优化，不能改变 run 阶段或重置预算。
8. 任一角色在相同 `(run, role, phase, trigger token)` 下最多存在一个 active attempt；已有成功
   terminal attempt 时不得因 loop 重启重复派发。环境恢复必须产生新的错误签名/账号/session 证据。

### 7.1 Human-review approval bridge

- `effect:human_review_requested` 只表示预览和通知已成功，不等于人已批准；
- 人工批准入口必须认证并校验 task/run、当前 PR SHA、review request hop 和操作者；
- 合法批准追加唯一的 `verdict:human_review`，detail 至少含 `verdict=APPROVED`、`pr_head_sha`、
  `review_request_hop`、`approved_by`、`approved_at`；
- 旧 SHA、错误 run、重复批准、无 request effect 的批准必须拒绝且不得推进 merge；
- approval bridge 不得直接 UPDATE run phase 或调用 merge；Kernel 下一轮从 decision log 重新 derive；
- 本 Sprint 只保证功能闭环和认证，不建设新的截图/RPA 审核界面。

## 8. 对抗式实现要求

本任务由本机 One Session `/dev` 执行，但不能靠一个模型自我声明正确：

1. 先把生产 run `d707...` 的关键 hop 55–66 固化成最小 replay fixture；
2. 测试必须先证明旧代码会在同一 SHA 连续返回 `spawn:generator-fix`；
3. 再实现最小修复，使第二次推导进入 `no_progress_same_sha` terminal；
4. 为每个 failure_class 写正向路由和反向禁路由断言；
5. 对 total deadline、阶段 deadline、worker deadline 分别做边界值和重启恢复测试；
6. Generator 实现完成后，由不同角色/新 session 进行 adversarial review，专门尝试：
   - 伪造 DONE 但不改变 SHA；
   - 把 evidence failure 冒充 product failure；
   - 重启 Kernel 清空 poll/blocked cap；
   - 在 deadline 前后制造 callback 竞态；
   - 用新 hop、新 provider 或新 account 绕过 progress fence；
7. 最终代码由独立 Codex 只读复审；Codex 不实现 Brain 核心修复。

## 9. 必须先红后绿的永久测试

### P0 回放测试

1. `judge evidence_invalid + PR SHA 不变`：不得派 generator；必须派 evaluator evidence repair。
2. `judge product_failure + generator-fix completed + SHA 不变`：只允许一个 fix attempt，随后
   `no_progress_same_sha`。
3. `judge product_failure + SHA 前进`：旧 verdict 自动失效，重新 evaluate，fixRound 加 1。
4. d707 hop 55–66 replay：新实现不得产生 hop 58–66 的九次重复 generator-fix。

### Deadline 测试

5. run 已用 119:59 可派符合剩余预算的动作；120:00 必须 terminal。
6. dispatch 前时间跨过 deadline：即使 derive 已返回 spawn，也不得创建 attempt。
7. Kernel 重启后 deadline 不延长，poll/blocked/no-progress 计数不归零。
8. watchdog 在过期 run 上不得 resume 或创建第二个 run。

### 分类与路由测试

9. 五种 failure_class 路由矩阵全部逐项断言。
10. Judge 缺 failure_class 时进入 unknown/needs_context，不得 generator-fix。
11. evidence repair 新 digest + 同 SHA 合法；相同 digest 必须 no-progress。
12. environment recovery 同错误签名第二次出现必须 terminal。

### 集成测试

13. 真 spawn stub → callback → Judge evidence fail → evidence repair → Judge PASS，产品 SHA 不变且
    generator 未被调用。
14. product failure → generator 新 SHA → evaluator PASS → Judge PASS，旧 SHA verdict 不得复用。
15. 在 attempt callback 与 deadline 同时发生的竞态下，只能出现一个 fenced terminal 结果。
16. human-review request → 受认证批准 → `verdict:human_review` → merge；错 SHA、重复和未认证批准均拒绝。

所有测试进入 Brain CI，不能只放 sprint 临时目录或静态 grep。

## 10. 真实 Fire Drill

合并前必须跑一条新的、小型真实 mixed initiative：

```json
{
  "harness_runtime": "kernel-v1",
  "role_assignments": {
    "planner":   { "provider": "claude", "account": "account1" },
    "proposer":  { "provider": "claude", "account": "account1" },
    "reviewer":  { "provider": "grok",   "account": "grok" },
    "generator": { "provider": "codex",  "account": "team3" },
    "evaluator": { "provider": "claude", "account": "account2" }
  },
  "review_required": true
}
```

Fire drill 验收必须同时满足：

- 从 run started 到 `effect:human_review_requested` 不超过 120 分钟；
- planner/reviewer/generator/evaluator/Judge 均产生真实 attempt；
- writer 和 reviewer/evaluator 不是同一 provider session；
- 无人工 UPDATE/INSERT DB、无人工追加 decision log、无人工 kill 容器推进流程；
- 无相同 trigger SHA 的重复 generator-fix；
- product fix 总数不超过 3；
- 无 deadline 后新 attempt；
- Evaluator PASS 和 Judge PASS 均绑定当前 PR SHA，evidence checks 含 command、exit_code、log_tail；
- human-review 前不 merge；人工批准后 15 分钟内 merge/report 完成；
- approval 通过受认证 bridge 写 `verdict:human_review`，全程不允许人工 INSERT decision log；
- decision log 可以单独重放出相同阶段和动作。

另跑一条故障 drill：让 Generator 返回 DONE 但不产生 commit。期望一个 attempt 后在 5 分钟内以
`no_progress_same_sha` 终止，不允许自动重试。

## 11. 指标与对照报告

PR 必须附一份机器生成的对照，不得只写“更快了”：

| 指标 | d707 基线 | 新 fire drill 目标 |
|---|---:|---:|
| 自动执行时间 | 529.90 分钟 | ≤120 分钟 |
| decision-log hops | 66 | ≤60 |
| attempts | 44 | 按实际报告，且无无进展重复 |
| generator-fix intents | 20 | ≤3 |
| 同 SHA judge-fail fix | 10 连续 | ≤1 |
| deadline 超时后继续运行 | 约 50 分钟 | 0 |
| 手工恢复/改 DB | 有 | 0 |

报告还必须列出各 role 的 provider/account、started/completed/duration、failure_class、trigger SHA、
progress token、重试原因。没有成本数据时明确写“未测”，禁止估算。

## 12. 预期受影响文件

具体实现以 TDD 发现为准，但范围应限制在：

- `packages/brain/src/harness-skill-relay.js`：Kernel run 120 分钟 deadline；
- `packages/brain/src/orchestrator/constants.js`：fix/hop/role budget；
- `packages/brain/src/orchestrator/derive.js`：failure class 路由和 no-progress terminal；
- `packages/brain/src/orchestrator/gates.js`：deadline/fix/no-progress gates；
- `packages/brain/src/orchestrator/counters.js`：持久化计数推导；
- `packages/brain/src/orchestrator/ground-truth.js`：deadline、progress token、attempt lease 真相；
- `packages/brain/src/orchestrator/loop.js`：三处 deadline fence 和持久化 blocked/poll；
- `packages/brain/src/orchestrator/kernel-handlers.js`：Judge failure_class/evidence digest；
- `packages/brain/src/orchestrator/attempt-store.js`：需要时补 progress/failure 元数据；
- `packages/brain/src/routes/` 中现有 human-review approval 路由：接入受认证 Kernel verdict bridge；
- `scripts/codex-supervisor.mjs`、`scripts/grok-supervisor.mjs`：worker deadline；
- 对应 `packages/brain/src/orchestrator/__tests__/`、watchdog、integration tests；
- `packages/brain/src/orchestrator/README.md`：SLO、失败矩阵和恢复规则；
- `DEFINITION.md`、`.brain-versions` 和 package manifests：Brain 版本同步。

若实现者认为需要 migration，必须在 `/dev` 内单独说明为什么现有 JSONB/decision log 无法承载，
并先写幂等 migration test；不得为了方便随意加列。

## 13. DevGate 与交付

必须按以下顺序执行：

1. 生产轨迹最小 replay 测试先红；
2. failure classification 路由先红后绿；
3. progress fence 先红后绿；
4. deadline 与跨重启计数先红后绿；
5. 定向 orchestrator/watchdog/integration 全绿；
6. `facts-check.mjs`、版本同步、DoD mapping、`node --check server.js`；
7. Runner/entrypoint/supervisor 有变化则重建镜像，并从实际镜像内验版本和 deadline；
8. 真实 mixed fire drill + no-progress 故障 drill；
9. 独立 Codex 复审；
10. 复审 PASS 后才允许 Ready/merge。

每个 bug 修复 commit 必须保留对应 failing test。不得用静态 grep 代替行为测试，不得用人工 DB
修复过的 run 冒充无人值守通过。

## 14. 回滚

- 缺少 `harness_runtime: "kernel-v1"` 的任务继续走旧 one-session/controller；
- 新 Kernel 出现 P0 时，停止新 kernel run，保留 DB/decision log 取证，不删除 attempt；
- 回滚不得恢复 8 小时 deadline、20 fix 或同 SHA 重试；这些属于已确认的不安全配置；
- 已进入 human-review 的 run 不因部署重启重新打开自动执行预算。

## 15. Definition of Done

- 本 PRD 第 9 节 16 类永久测试全部进入 CI 并通过；
- 新 mixed fire drill 和 no-progress 故障 drill 全部满足第 10 节；
- 自动运行 ≤120 分钟，deadline 后零新 attempt；
- Judge evidence failure 不再进入 Generator；
- 同 SHA generator-fix 不超过一次且立即 no-progress terminal；
- 所有计数跨进程重启保持；
- Brain 版本、README、DevGate、实际 Runner 镜像验证全部通过；
- 独立 Codex 复审报告为 PASS，且声明中明确列出仍未实现的 Human Validation/RPA 范围。

## journey_type: autonomous
## journey_type_reason: Brain 核心状态机和恢复语义修复；最终 human-review 仅用于门禁验收，不包含 UI/RPA 实现
## target_environment: local_api
## target_environment_reason: 通过真实 PostgreSQL、Docker worker、GitHub PR、callback 和 decision log 做机器层 fire drill
