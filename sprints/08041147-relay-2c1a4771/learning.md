# Learning — watchdog liveness 探针「从未启动任务」误判 liveness_dead 修复（防复发）

## 运行指标

- GAN 轮次：3（r1/r2 反馈文件留档，第 3 轮 APPROVED，rubric 62/70，judgments=2）
- Evaluator Fix 次数：0（evaluator 一次 PASS：9/9 BEHAVIOR + E2E exit 0，unverifiable 1 条已兜底）
- 总成本：未采集（relay-runs API 对本 task_id 求和为 $0.00，成本行缺失）
- PR：https://github.com/perfectuser21/cecelia/pull/4606（已 MERGED @2026-08-04T06:16:29Z，squash，sha 锚定 151403efe）
- Sprint Dir：sprints/08041147-relay-2c1a4771

## 发现的问题

### [PROMPT] Prompt 类问题

无（本次未遇到）。

### [BUG] 代码缺陷

- watchdog checkExitReason 对「从未存在的进程」兜底误判 process_disappeared → liveness_dead 假标签污染 urgent 学习流 → executor.js liveness 探针新增 never_started 分类（pid=null ∧ 无日志 ∧ 未启动），且不覆盖已有 error_message/failure_class。
- dev-failure-classifier 见到 [watchdog] 文本一律判 transient，把真实根因（锚点执法拒绝点火）洗成瞬时故障 → 分类器不再对 [watchdog] 文本做 transient 短路，failure learning 文本携带真实根因标签。

### [INFRA] 基础设施问题

- 原任务 1dfa40f7 缺 payload.anchor 被锚点执法拒绝点火（从未启动），却被打上 liveness_dead 死标签——点火前置校验失败与运行期死亡是两类根因，不能共用一个标签。
- merge 窗口两次被 main 前进打断：记账文件（版本 bump）冲突两轮让位重试才合入——高频仓库的 merge 让位成本要计入 relay 时长预期。
- 【report 阶段亲历】relay 单 session 模式全程未写 node 级 initiative_run_events（只有 skill-relay-spawn），导致 finalize 收账闸先后报 pr_not_found / no_evaluator_gate，task 无法翻 completed → 本次通过官方 POST /api/brain/harness/phase-event 补登记 evaluator done + 经 /api/brain/tasks/tasks/:id 补写 pr_url 后放行；run.phase 也停在 A_planning，harness/complete Dashboard 更新被拒（initiative_run_not_done）。

### [DESIGN] 设计缺陷

- 毕业步（Red 后删/改 sprint tests 树）与 lint-contract-test-immutability（fail-closed 无毕业豁免）、brain-unit shard（收集 tests/regression/*.ts 致 PG integration 测试在 unit 环境必炸）两道 CI 闸互斥——毕业 commit 8d64be48b 被实锤拒绝后 revert（c88f3074），永久回归保护改由 packages/brain/src/__tests__/integration/*.js 副本承担；系统冲突已建 Notion issue 6b8f1239-a001-4f80-8f2a-953802a77a74。

## 下次预防清单

- [ ] relay controller 每个 phase 完成时调 POST /api/brain/harness/phase-event 登记 node=planner/gan/generator/evaluator/judge 的 done 事件，并推进 run.phase——否则 finalize 收账降级、Dashboard 更新被拒、report 棒要手工补账。
- [ ] relay 点火或 merge 后立即回写 tasks.pr_url（主路由 PATCH 不收 pr_url，走 /api/brain/tasks/tasks/:id），并确保 payload.base_repo 存在，finalize 的 GitHub 反查才有落点。
- [ ] 涉及删/改 Red 后测试树的毕业类改动，先核对 lint-contract-test-immutability 与 brain-unit shard 的收集范围，越界即改走 packages/brain/src/__tests__/integration/ 副本路径，不改闸脚本。
- [ ] 高频仓库 merge 前预期 main 前进导致记账文件冲突，合并窗口预留 ≥2 轮让位重试。
