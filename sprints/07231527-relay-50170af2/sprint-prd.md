# Sprint PRD — Harness Kernel 有界运行与正确恢复（上轮 #4220 revert 后重跑）

**TASK_ID**: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
**Sprint**: 07231527-relay-50170af2
**Date**: 2026-07-23
**Priority**: P0
**执行方式**: 美国本机 One Session `/dev`；Brain 核心/迁移/架构改动禁止派给 Codex 实施

---

## 背景

生产 run `d707ae20` 跑了 529.90 分钟（基线 92.98 分钟），记录 66 hop / 44 attempt。`deadline_at = started_at+8h` 但 Kernel 未在 deadline 停止；hop 56 evidence 问题被路由给 generator-fix；hop 57–66 连续 10 次 generator-fix 锚定同一 SHA；`pollCount/blockedStreak` 进程内变量重启归零。**上轮 PR #4220 已 revert（Codex 复审 6 条 blocking 缺口）**，本轮逐条真实闭合。

---

## 目标

1. 自动执行总预算 ≤ 120 分钟（三道 deadline fence）
2. `failure_class` 分类路由；只有 `product_failure` 进 generator-fix
3. generator-fix 必须产生新 PR SHA，否则立即 `no_progress_same_sha` terminal
4. 最多 3 个有效 fix round；`MAX_HOPS` 降为 60
5. pollCount / cap / progress token 跨进程重启持久化
6. 真实 mixed fire drill 无人工干预完成到 human-review
7. approval bridge 认证写 `verdict:human_review` 完成收尾

---

## Invariant 约束

加载三源共 24 条（Brain DB invariant 表 17 条 + 现有 sprint 7 条）

**Brain DB（harness 相关，17 条）**

| ID | 约束摘要 |
|----|---------|
| de6a2ee1 | judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]，每条含 exit_code + log_tail |
| e83b2f0d | relay 容器 Step 6 后可能退出跳过 Step 7；Brain 不能只凭容器 exit 0 推断完成 |
| 113a9330 | 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略 |
| 755fb846 | Red commit 只 git add 精确路径（*.test.js），禁止 git add . 或 git add .harness/ |
| e8230eb5 | 禁止 generator 自行 merge PR，merge 权归 controller |
| 26886b60 | CI 侧兜底提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 锚定的 sha |
| 09fb5c69 | 人工救场禁用 CI 绿顶替 evaluator 验收；合同必须 1:1 映射 PrepPRD Golden Path |
| 9216d107 | judge 在校验前必须先读 target_environment，按环境能力上限校准证据要求 |
| 6d11717d | smoke 找不到必须 exit 1 硬失败；evaluator 在 local_api 拿不到真实 DB 时必须转人工 |
| e90c0fbb | relay watchdog pr_url 必须在 controller 建 PR 后立即写回 tasks.pr_url |
| b0b2d702 | harness pipeline 禁用于 infrastructure 仓库；judge 不得用 subagent 顶替 |
| be038f9e | 改环境变量/部署配置必须同时证明运行时状态正确与持久化配置一致 |
| 1100cb8f | harness-generator 共享 CI 基础设施文件（.github/workflows/*.yml）默认禁区 |
| 76ab76ea | relay 模式下保留 staging→production 放行层（刀4 重构，不得移除） |
| 37e0d7c9 | headed relay 点火时必须把 base_repo/pr_url 写入 task payload |
| 5775d866 | 判变基准永远用"生产实体自报"对账 origin/main，禁用工作区 diff |
| 72890f7c | headed relay tmux innerCmd 子 shell 不继承父进程环境变量；必须在 innerCmd 内显式 export |

**现有 sprint + PR 铁律（7 条）**

| # | 约束 |
|---|------|
| INV-K1 | collect 前、derive 后、dispatch 前三道 deadline fence，缺一不可 |
| INV-K2 | deadline 到达后写 `automation_deadline_exceeded`，不得 requeue |
| INV-K3 | Judge 缺 failure_class → unknown，禁止默认归为产品代码失败 |
| INV-K4 | no-progress 后禁止对相同 (run_id, failure_class, trigger_sha, role) 再派 generator-fix |
| INV-K5 | cap / streak / progress token 从 DB/decision log 推导，不用进程内变量作为权威 |
| INV-K6 | evidence_invalid 修 attempt evidence；新 evidence digest 必须变化 |
| INV-K7 | approval bridge 必须校验 task/run、PR SHA、review_request_hop 和操作者；旧 SHA/重复批准必须拒绝 |

---

## 累积 FR

| # | 功能需求 | 受影响文件（行号） |
|---|---------|--------------|
| FR-1 | harness-skill-relay.js run deadline 改为 NOW()+120min | harness-skill-relay.js:159-164 |
| FR-2 | loop.js 三道 deadline fence 接线 | loop.js:185-193,273-329 |
| FR-3 | 阶段/worker deadline 函数接线到真实消费路径 | gates.js:80-137 |
| FR-4 | loop.js 移除进程内 pollCount/blockedStreak；wait:poll_ci 写 decision log | loop.js:178-181,250-269,347-353 |
| FR-5 | kernel-handlers.js Judge 落库时保留并传递 failure_class | kernel-handlers.js:21-42,79 |
| FR-6 | derive.js Evaluator FAIL 五类 failure_class 差异路由 | derive.js:212-217 |
| FR-7 | dispatcher.js 支持 evaluator-evidence-repair / needs_context 动作 | dispatcher.js:9-40,51-54 |
| FR-8 | generator fix intent 写 trigger_sha / failure_class / role | loop.js:306-314 |
| FR-9 | generator callback 写 verdict:generator-fix-callback + pr_head_sha | harness-callback.js:91-110,252-264 |
| FR-10 | deriveNoProgress 接入生产代码消费路径 | ground-truth.js:321-353 |
| FR-11 | approval bridge 校验 taskId/reviewRequestHop/操作者/PR SHA；写唯一 verdict:human_review | kernel-handlers.js:193-225；harness-pending-reviews.js:57-79 |
| FR-12 | deriveHumanReview 识别 detail.verdict=APPROVED（与 approved===true 对齐）| ground-truth.js:278-282 |
| FR-13 | MAX_FIX_ROUNDS→3，MAX_HOPS→60 | constants.js |
| FR-14 | fixRound 只计产生新 SHA 的有效 product fix | counters.js:86-87 |
| FR-15 | supervisor SUPERVISOR_DEADLINE_SECONDS 不再默认 28800 | codex-supervisor.mjs / grok-supervisor.mjs |
| FR-16 | d707 hop 55–66 真实 replay fixture（使用真实 DB decision log，禁止骨架占位）| orchestrator/__tests__/ |

---

## NFR

| 维度 | 要求 |
|------|------|
| 时间预算 | 自动执行到 human_review_requested 硬上限 120 分钟；deadline 后零新 attempt |
| 持久性 | 所有计数从 DB/decision log 推导，Kernel 重启后不归零 |
| 竞态安全 | callback 与 deadline 并发时只允许一个 fenced terminal 结果 |
| 可回滚 | 缺 harness_runtime: "kernel-v1" 的任务走旧 one-session/controller |
| 无人工干预 | fire drill 全程无人工 UPDATE DB / INSERT decision log / kill 容器推进流程 |

---

## 测试矩阵（16 类永久测试，先红后绿）

P0 回放：T-01 evidence_invalid 不进 generator | T-02 同 SHA no-progress | T-03 SHA 前进 fixRound+1 | T-04 d707 hop55-66 replay 不产生重复 fix

Deadline：T-05 119:59 可派 | T-06 120:00 terminal | T-07 dispatch 前跨 deadline 不创建 | T-08 重启不归零 | T-09 watchdog 不 resume 过期 run

路由：T-10 五类 failure_class 矩阵 | T-11 缺 failure_class → unknown/needs_context | T-12 evidence repair 新 digest 合法 / 同 digest no-progress | T-13 environment recovery 同签名第二次 terminal

集成：T-14 evidence fail → repair → PASS（generator 未调用）| T-15 product fail → 新 SHA → PASS（旧 verdict 不复用）| T-16 callback/deadline 竞态唯一 terminal | T-17 approval 合法/非法全链

---

## DevGate 执行顺序

1. d707 replay 先红 → 2. failure_class 路由先红后绿 → 3. progress fence 先红后绿 → 4. deadline+重启计数先红后绿 → 5. orchestrator/watchdog/integration 全绿 → 6. DevGate 三检 + `node --check server.js` → 7. supervisor 重建镜像验 deadline → 8. 真实 mixed fire drill + no-progress 故障 drill → 9. 独立 Codex 只读复审 → 10. 复审 PASS 后 merge

---

## journey_type: autonomous
## target_environment: local_api
