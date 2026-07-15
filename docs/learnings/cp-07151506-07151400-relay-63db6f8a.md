# Learning — Sprint PRD — headed relay 派发链路自测（claude-headed, task 63db6f8a）

## 运行指标

- GAN 轮次：1（Proposer R1 → Reviewer 发现 E2E 断言与真实路径不符 → Proposer R2 修订 → 达成共识）
- Evaluator Fix 次数：0（post-merge-audit 模式，追溯审计一次性 PASS，5/5 artifact gate 通过）
- 总成本：未采集（无法获得真实 subagent 成本数据，按诚实边界填 0，台账注明 cost=unsettled）
- PR：https://github.com/perfectuser21/cecelia/pull/3975（已 MERGED）
- Sprint Dir：sprints/07151400-relay-63db6f8a

## 发现的问题

### [PROMPT] Prompt 类问题

- 现象：contract-draft.md R1 版本的 E2E 验收断言2（`initiative_runs.orchestrator_host` 校验）直接抄自先例 049ebf93，严格匹配 `*skill-relay-claude-headed*`，未结合本次任务的真实派发历史核对。
- 根因：Proposer 沿用历史合同模板时，只做了"结构镜像"没做"事实核对"——本次 task 63db6f8a 的自动派发（`_spawnHeadedSession`）实际从未成功，`orchestrator_dispatched_at` 已写但 status 一直 `queued`，controller 只能走前台点火补建档端点（`orchestrator_host='foreground'`），与先例覆盖的真实 headed 容器路径不是同一条链路。
- 修法：controller 在 reviewer-feedback-r1.md 中直接指出问题（未走 reviewer subagent，controller 自己发现），要求 Proposer R2 放宽断言同时接受 `foreground` 与 `skill-relay-claude-headed` 两种合法值，并新增「未覆盖真实链路清单」段如实记录本次未覆盖 Brain 自动 headed spawn 这条真实链路，不与前台补建档路径混同呈现。

### [BUG] 代码缺陷

- 现象：harness-report Step 1（`PATCH /api/brain/tasks/:task_id` 回写 status=completed）与 Step 2（`POST /api/brain/harness/complete`）均返回 `accepted:false, reason:"pr_not_found"`，task.status 停留 `in_progress`，仅 result 字段成功补写。
- 根因：`packages/brain/src/lib/harness-finalize.js` 的 PR 发现逻辑只信任 `tasks.pr_url` 列 / `task.payload.pr_url`，或按分支名反查（`headRefName` 含 taskId 短码）。本次任务两条路径都未命中——`tasks.pr_url` 列为空，`payload` 里也没有 pr_url 字段，且 PR 分支名 `cp-07151403-harness-prd` 不含 taskId 短码 `63db6f8a`。而唯一能写 `tasks.pr_url` 列的端点（`packages/brain/src/routes/task-tasks.js` 的 `PATCH /:id`）与另一个更早挂载在同一 URL 路径（`/api/brain/tasks/:id`）的 `routes/tasks.js` 端点冲突，被路由挂载顺序（`routes.js` 在 server.js 更早 `app.use`）遮蔽，实际不可达。
- 修法：本次未修复 Brain 代码（超出本 sprint 范围），改用用户/controller 明确指定的 `PATCH /api/brain/orchestrator/relay-runs/:initiative_id` 端点完成收尾（该端点走独立逻辑，未受此门禁影响，写入成功）。建议后续开 Issue 追查两条：① 路由遮蔽本身是否需要修复（task-tasks.js 的 pr_url 写入能力实际不可用）；② harness-finalize 的 PR 发现逻辑应支持从 `result.pr_url`（Step 1 已写入的字段）兜底读取，而不是只信任独立的 pr_url 列/payload。

### [INFRA] 基础设施问题

- 现象：PR #3975 在 controller 派发 evaluator/judge 之前，被 `should-auto-merge.sh` 兜底机制自动合并进 main，绕过了 judge 是 merge 唯一权威的硬约束2。
- 根因：`should-auto-merge.sh` 的触发条件与 controller 正常派发流程之间存在竞态或条件误判，具体根因未在本 sprint 范围内查明。
- 修法：controller 对已合并代码做了追溯性 evaluator + judge 审计（`.harness/verdicts/evaluate-b714a1c.json` mode=post-merge-audit，5/5 artifact gate 通过，evaluate_verdict=PASS，judge_verdict=PASS），确认代码质量本身无问题，但流程违规已发生。已建 Notion Issue 3810480d-259b-49ff-ac4c-0c087c33fc36（P1）追查 `should-auto-merge.sh` 触发条件，需后续 sprint 专项修复。

### [DESIGN] 设计缺陷

- 现象：GAN reviewer 在过程记录中声明 `judgments_written=2`，但 decisions 表实际查询为 0 条，写库链路存在断裂但未被上层感知（reviewer 自身汇报与真实落库状态不一致）。
- 根因：reviewer 侧未对写库操作做返回值校验/事后核验，"声明写入成功"与"真实写入成功"之间缺少一致性检查。
- 修法：已建 Notion Issue 097886ee-6488-4b22-ba5c-124627d2876e（P2）跟踪，需在 reviewer 写 decisions 表后增加事后核验（类似本 skill Phase B 对 journey_features/notes 的核验模式）。

## 下次预防清单

- [ ] Proposer 复用历史合同模板（尤其是 E2E 验收断言）时，必须先核对本次任务的真实派发/执行历史（如 task payload 的 status、dispatched_at 字段），不能假设与先例路径相同。
- [ ] harness-report Step 1/2 遇到 `reason:pr_not_found` 时，应优先尝试用户/controller 指定的替代端点（如本次的 relay-runs 端点），不要在同一失败端点上重复无效重试。
- [ ] 后续排查 `routes/task-tasks.js` 的 `PATCH /:id`（pr_url 写入能力）与 `routes/tasks.js` 的路由挂载顺序冲突，评估是否需要合并/去重两个端点的职责，避免功能被静默遮蔽。
- [ ] GAN reviewer 写 decisions 表等关键表后应做事后核验（select count），不能仅信任写入调用的返回值声明。
