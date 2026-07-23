# Sprint PRD — P0: Harness Kernel 有界运行与正确恢复

**Task ID**: 1b997ed6-d984-46d4-8336-12bff5a5ba3c
**Sprint Dir**: sprints/07230920-relay-1b997ed6
**生成日期**: 2026-07-23
**优先级**: P0
**状态**: 待 One Session `/dev` 实施

---

## Invariant 约束

### 来源一：全仓核心 Invariants（scripts/ci/invariants/，config/invariants-snapshot.json，共 19 条）

本 Sprint 直接关联的约束：

1. **CORE-INV-01 真环境非 mock**（P0）：评估器/Judge/Fire Drill 必须在真 PostgreSQL + 真容器环境中运行；禁止以 mock 环境糊弄验收；
2. **CORE-INV-02 租户隔离**（P0）：任何 DB 操作须 scope 到当前 tenant，跨租户数据不得混读写；
3. **CORE-INV-03 FIXED 不当 PASS 直通**（P0）：Evaluator 输出 "FIXED" 归一为 PASS 合法，但归一不等于直通——merge 仍必须经 Judge 复核；
4. **CORE-INV-04 1 Sprint = 1 Generator = 1 PR**（P0）：一个 Sprint 只 spawn 一个 Generator、只出一个 PR，禁止多 workstream 拆分；
5. **CORE-INV-05 GAN 收敛守护**（P0）：GAN 对抗收敛靠三道硬保护，不靠硬轮数；本 Sprint 新增 progress-fence（同 SHA 不得二次 generator-fix）是此约束的加强；
6. **[系统] 真环境验证才算 done**（P2）：依赖真机/生产 env/真实调用方的接缝断言必须在真目标上验证过才算 done，未真验只能标 logic-done-pending；
7. **[系统] 凭据安全**（P2）：secrets 不硬编码、不进 git、不进日志；
8. **[系统] 端点鉴权**（P2）：每个 API 端点必须有 auth，无鉴权端点不准 ship；
9. **[系统] 禁止写死环境假设值**（P2）：deadline 时间、预算常量等必须从环境/DB 推导，不得硬编码进逻辑分支之外。

### 来源二：Line Invariants

本 Sprint 涉及的是 Cecelia Harness 核心（Brain/Kernel），非特定 Line 业务。Line04 微信客服 invariants（不进群/不回自己/防假成功/后台静默/记忆隔离）与本次修复无直接交叉。**Line Invariants: N/A（无本次直接适用条目）**。

### 来源三：现有有效决策（Active Decisions，100 条中 Harness 相关 17 条）

| 决策 ID | 主题 | 对本 Sprint 的约束 |
|---|---|---|
| c24ce39f | evaluator evidence bridge | callback 前必须持久化 behavior_tests（含 exit_code/log_tail）到 harness_attempts.result |
| c15f0499 | approved contract immutable freeze | reviewer 批准必须锚定远端合同 commit SHA，原子物化 |
| 46056469 | headless relay 不可靠 | 本 Sprint 走交互式 One Session /dev 执行，不走 headless relay |
| 0e752f33 | Kernel 稳定化 | 按 Phase 0→4 以真 spawn+callback+推进集成测试为防线逐条修复 |
| 375d6471 | Harness 编排形态定型 | Kernel 控制流放确定性代码，从 Git/PR/DB 现查真相，进程崩了重推、状态不丢 |
| 1fbd9b9f | dispatcher budget 降级字段名 bug | isCodex 判断须读 task.payload.executor，降级时同时写 executor=codex |
| f91cbfc7 | target_environment 读取来源 | target_environment 由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取 |
| de6a2ee1 | judge .brain-result.json 格式 | 必须有顶层 exit_code + log_tail + behavior_tests[]（每条含 exit_code + log_tail）|
| e83b2f0d | relay 容器异常退出跳 report | Brain 侧不得仅凭容器 exit code 0 认定流程完整，merge 后必须机械闸门保证 report |
| 52dee11e | 执行资源调度 | DB 迁移/Brain 核心/架构修复只走 harness 护栏最全的执行器（Claude Code One Session）|
| 438c74a7 | harness_initiative affinity | harness_initiative 任务 no_downgrade=true，budget 紧张宁排队不降级 |

**Invariant 总计：全仓 9 条直接适用 + 决策约束 11 条 = 20 条有效约束**

---

## 累积 FR

以下功能需求来自 PrepPRD 第 4–8 节，按实现单元整理：

### FR-01 总执行预算硬限 120 分钟
- Kernel 自动执行从 run `started_at` 到首次写入 `effect:human_review_requested`（或 done/failed）硬上限 120 分钟；
- 每轮 loop 在 collect 前、derive 后、dispatch 前各做一次 DB 时间预算检查；
- deadline 到达必须写 terminal reason `automation_deadline_exceeded`，停止并回收当前 attempt，禁止 requeue；
- human-review 等待时间不计入预算；人工批准后仅允许最长 15 分钟 merge/report 收尾，不得恢复新的 120 分钟周期。

### FR-02 阶段预算细分
| 阶段 | 最大自动时间 | Terminal reason |
|---|---:|---|
| planning | 10 分钟 | `planning_deadline_exceeded` |
| contract GAN | 20 分钟 | `gan_deadline_exceeded` |
| generate + fix | 45 分钟 | `generation_deadline_exceeded` |
| evaluate + judge | 30 分钟 | `verification_deadline_exceeded` |
| merge + report | 15 分钟 | `delivery_deadline_exceeded` |

未使用阶段预算可被后续阶段使用，但任何阶段不得突破 120 分钟总预算。时间由注入的 clock 或 DB timestamp 推导，纯函数测试禁止依赖真实 `Date.now()`。

### FR-03 Worker 预算与 Supervisor Deadline
- planner/proposer/reviewer/judge 单 attempt 最大 10 分钟；
- generator/evaluator 单 attempt 最大 30 分钟；
- worker timeout 取 `min(角色上限, run 剩余预算)`；
- `SUPERVISOR_DEADLINE_SECONDS`（Codex/Grok supervisor）不得再是 28800（8 小时）；
- worker 超时必须产生结构化 terminal callback，不能只靠容器消失让 watchdog 猜。

### FR-04 失败分类与路由（failure_class 枚举）
| failure_class | Kernel 动作 | 允许 generator-fix |
|---|---|---|
| `product_failure` | spawn:generator-fix | 是 |
| `evidence_invalid` | spawn:evaluator-evidence-repair | 否 |
| `contract_invalid` | terminal failed，创建独立后续任务 | 否 |
| `environment_failure` | 换账号/环境恢复一次；仍失败则 terminal | 否 |
| `unknown` | needs_context 一次；仍未知则 terminal | 否 |

规则：
- Judge 不得只返回裸 FAIL，缺 `failure_class` 视为 `unknown`；
- `evidence_invalid` 修的是 attempt evidence，不修改 PR 产品代码，PR SHA 可不变但 evidence_digest 必须变化；
- 同一角色、同一错误签名 `environment_failure` 最多恢复 1 次；
- `contract_invalid` 不在当前 run 内重新开启无上限 GAN；
- 失败分类、触发 SHA、责任角色、下一动作必须写入 decision log。

### FR-05 进展证明（Progress Token）
- generator-fix：`pr_head_sha` 必须从触发 SHA 变化为新 SHA；
- evaluator-evidence-repair：PR SHA 可不变，但 `evidence_digest` 必须变化且新证据通过 schema；
- contract revision：合同分支 SHA 和 round 必须前进；
- environment recovery：provider/account/session 或已验证的环境错误签名必须变化；
- 禁止把 worker 自称 "FIXED/DONE" 作为进展证据。

### FR-06 No-Progress 熔断
- generator-fix 完成后 PR SHA 未变：立即标记 `no_progress_same_sha`，本 run 终止；
- 禁止对相同 `(run_id, failure_class, trigger_sha, role)` 再派第二个 generator-fix；
- evaluator evidence repair 后 digest 未变化：立即标记 `no_progress_same_evidence`；
- no-progress 必须保存触发 attempt、旧/新 token 和 worker summary；
- 不允许通过重启 Kernel、创建新 hop 或更换 provider 绕过 no-progress fence。

### FR-07 上限常量收紧
- `MAX_FIX_ROUNDS` 从 20 降为 3（仅统计产生新 SHA 的有效 product fix）；
- `MAX_HOPS` 从 200 降为 60；
- 相同环境错误签名恢复上限为 1；
- 相同 BLOCKED/NEEDS_CONTEXT 上限为 2。

### FR-08 持久化计数（跨进程重启不归零）
- 所有 cap、streak、首次等待时间、progress token 从 DB/decision log/PR 外部真相推导；
- Kernel 重启后，相同输入必须得到相同下一动作和相同剩余预算；
- CI pending 的 30 分钟上限必须跨 Kernel 重启保持，不能使用进程局部变量作为权威；
- active attempt 判定必须同时检查 harness_attempts lease/status 和真实容器/进程；
- 任一角色在相同 `(run, role, phase, trigger token)` 下最多一个 active attempt，有成功 terminal attempt 时不得重复派发。

### FR-09 Human-Review Approval Bridge（认证闸门）
- `effect:human_review_requested` 只表示通知成功，不等于人已批准；
- 批准入口必须认证并校验 task/run、当前 PR SHA、review_request_hop、操作者；
- 合法批准追加唯一的 `verdict:human_review`，detail 至少含 verdict=APPROVED、pr_head_sha、review_request_hop、approved_by、approved_at；
- 旧 SHA、错误 run、重复批准、无 request effect 的批准必须拒绝且不推进 merge；
- approval bridge 不得直接 UPDATE run phase 或调用 merge；Kernel 下一轮从 decision log 重新 derive。

### FR-10 Watchdog 边界规则
- run deadline 过期时 watchdog 不得 resume/requeue；只允许 fenced terminal cleanup；
- watchdog 在过期 run 上不得创建第二个 run；
- Evaluator PASS 后若 Judge 因环境故障失败，不得重跑 Evaluator，只允许重跑 Judge。

### FR-11 回滚安全性
- 缺少 `harness_runtime: "kernel-v1"` 的任务继续走旧 one-session/controller；
- 回滚后不得恢复 8 小时 deadline、20 fix 或同 SHA 重试（已确认的不安全配置）；
- 已进入 human-review 的 run 不因部署重启重开自动执行预算。

### FR-12 P0 永久回归测试（共 16 类，必须先红后绿并进入 CI）
1. judge evidence_invalid + PR SHA 不变 → 必须派 evaluator evidence repair，不得派 generator；
2. judge product_failure + generator-fix completed + SHA 不变 → 一次 fix 后 no_progress_same_sha terminal；
3. judge product_failure + SHA 前进 → 旧 verdict 自动失效，重新 evaluate，fixRound 加 1；
4. d707 hop 55–66 replay → 新实现不得产生 hop 58–66 的九次重复 generator-fix；
5. run 已用 119:59 可派符合剩余预算的动作；120:00 必须 terminal；
6. dispatch 前时间跨过 deadline：即使 derive 已返回 spawn，也不得创建 attempt；
7. Kernel 重启后 deadline 不延长，poll/blocked/no-progress 计数不归零；
8. watchdog 在过期 run 上不得 resume 或创建第二个 run；
9. 五种 failure_class 路由矩阵全部逐项断言；
10. Judge 缺 failure_class 时进入 unknown/needs_context，不得 generator-fix；
11. evidence repair 新 digest + 同 SHA 合法；相同 digest 必须 no-progress；
12. environment recovery 同错误签名第二次出现必须 terminal；
13. 真 spawn stub → callback → Judge evidence fail → evidence repair → Judge PASS（产品 SHA 不变，generator 未被调用）；
14. product failure → generator 新 SHA → evaluator PASS → Judge PASS（旧 SHA verdict 不复用）；
15. deadline 与 attempt callback 竞态下，只能出现一个 fenced terminal 结果；
16. human-review request → 受认证批准 → verdict:human_review → merge；错 SHA/重复/未认证批准均拒绝。

### FR-13 Fire Drill 要求
两条 drill 必须在 CI-free 无人工干预条件下完成：

**正常 drill**（mixed provider）：
- 角色：planner=claude/account1, proposer=claude/account1, reviewer=grok/grok, generator=codex/team3, evaluator=claude/account2；
- 验收：≤120 分钟内到 human_review_requested；各角色产生真实 attempt；无相同 trigger SHA 重复 generator-fix；product fix ≤3；无 deadline 后新 attempt；Evaluator/Judge PASS 均绑定当前 PR SHA；approval 通过认证 bridge；decision log 可独立重放。

**故障 drill**（no-progress）：
- Generator 返回 DONE 但不产生 commit；
- 期望：一个 attempt 后 5 分钟内以 no_progress_same_sha 终止，不允许自动重试。

### FR-14 PR 对照报告（机器生成，必须包含）
| 指标 | d707 基线 | 新 fire drill 目标 |
|---|---:|---:|
| 自动执行时间 | 529.90 分钟 | ≤120 分钟 |
| decision-log hops | 66 | ≤60 |
| attempts | 44 | 按实际报告，无无进展重复 |
| generator-fix intents | 20 | ≤3 |
| 同 SHA judge-fail fix | 10 连续 | ≤1 |
| deadline 超时后继续运行 | 约 50 分钟 | 0 |
| 手工恢复/改 DB | 有 | 0 |

---

## NFR

| ID | 类别 | 要求 |
|---|---|---|
| NFR-01 | 可测试性 | 时间推导必须注入 clock，纯函数测试禁止依赖 Date.now() |
| NFR-02 | 持久性 | 所有计数/预算从 DB/decision log 推导，重启不归零 |
| NFR-03 | 可审计性 | 失败分类、触发 SHA、责任角色、下一动作写入 decision log，可独立重放 |
| NFR-04 | 安全性 | human-review approval bridge 必须认证，禁止未认证写入 verdict |
| NFR-05 | 向后兼容 | 无 harness_runtime: kernel-v1 的任务继续走旧路径，新旧路径可并存 |
| NFR-06 | 可观测性 | verdict 绑定 PR SHA，evidence verdict 另绑定 evidence digest，供 audit |
| NFR-07 | 幂等性 | migration 必须幂等，有 DB schema 变更须先写幂等 migration test |
| NFR-08 | 镜像验证 | Runner/entrypoint/supervisor 有变化须重建镜像，从实际镜像内验版本和 deadline 常量 |

---

## DevGate 执行顺序

必须严格按以下顺序执行：

1. 生产轨迹最小 replay 测试先红（d707 hop 55–66 fixture）；
2. failure classification 路由先红后绿；
3. progress fence 先红后绿；
4. deadline 与跨重启计数先红后绿；
5. 定向 orchestrator/watchdog/integration 全绿；
6. `facts-check.mjs`、版本同步、DoD mapping、`node --check server.js`；
7. Runner/Supervisor 有变化则重建镜像并从镜像内验版本和 deadline；
8. 真实 mixed fire drill + no-progress 故障 drill；
9. 独立 Codex 复审（只读，不实现 Brain 核心）；
10. 复审 PASS 后才允许 Ready/merge。

---

## 预期受影响文件

- `packages/brain/src/harness-skill-relay.js`：run 120 分钟 deadline；
- `packages/brain/src/orchestrator/constants.js`：fix/hop/role budget 常量；
- `packages/brain/src/orchestrator/derive.js`：failure class 路由和 no-progress terminal；
- `packages/brain/src/orchestrator/gates.js`：deadline/fix/no-progress gates；
- `packages/brain/src/orchestrator/counters.js`：持久化计数推导；
- `packages/brain/src/orchestrator/ground-truth.js`：deadline、progress token、attempt lease 真相；
- `packages/brain/src/orchestrator/loop.js`：三处 deadline fence 和持久化 blocked/poll；
- `packages/brain/src/orchestrator/kernel-handlers.js`：Judge failure_class/evidence digest；
- `packages/brain/src/orchestrator/attempt-store.js`：补 progress/failure 元数据；
- `packages/brain/src/routes/`：human-review approval 路由认证；
- `scripts/codex-supervisor.mjs`、`scripts/grok-supervisor.mjs`：worker deadline；
- `packages/brain/src/orchestrator/__tests__/`：16 类永久测试；
- `packages/brain/src/orchestrator/README.md`：SLO、失败矩阵和恢复规则；
- `DEFINITION.md`、`.brain-versions`、package manifests：Brain 版本同步。

---

## Definition of Done

- 第 FR-12 节 16 类永久测试全部进入 CI 并通过；
- 新 mixed fire drill 和 no-progress 故障 drill 全部满足 FR-13 节要求；
- 自动运行 ≤120 分钟，deadline 后零新 attempt；
- Judge evidence failure 不再进入 Generator；
- 同 SHA generator-fix 不超过一次且立即 no-progress terminal；
- 所有计数跨进程重启保持；
- Brain 版本、README、DevGate、实际 Runner 镜像验证全部通过；
- 独立 Codex 复审报告为 PASS，且明确列出仍未实现的 Human Validation/RPA 范围。

---

journey_type: autonomous
target_environment: local_api
