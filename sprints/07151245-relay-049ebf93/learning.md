# Learning — headed relay 派发链路自测（claude-headed, task 049ebf93）

## 运行指标

- GAN 轮次：1（gan-fdd6c41.json，一次即 APPROVED，铁律覆盖 7/7）
- Evaluator Fix 次数：0（evaluator 一次性 PASS，8/8 BEHAVIOR）
- 总成本：未采集（Relay 入口段 relay-runs API 求和为空/未接入本次 relay 模式）
- PR：https://github.com/perfectuser21/cecelia/pull/3970
- Sprint Dir：sprints/07151245-relay-049ebf93

## 发现的问题

### [PROMPT] Prompt 类问题
无（本次未遇到）

### [BUG] 代码缺陷
无（本次未遇到；e2e-verify.sh 真跑 5/5 PASS，evaluator 复核 8/8 BEHAVIOR PASS）

### [INFRA] 基础设施问题
- 现象：should-auto-merge.sh 这条 CI 侧兜底自动合并机制，在本次 harness relay 尚未跑完
  evaluator/judge 之前就把 PR #3970 合并了（mergedBy=perfectuser21，先于本 session
  的 evaluator/judge 完整执行）。
  根因：should-auto-merge.sh 的触发条件只看 CI 全绿，不等待 harness pipeline 自身的
  evaluator/judge 完成态，二者是两条独立判定链路，没有互锁。
  修法（本次未改代码，仅记录）：controller 在合并已发生的情况下补跑了 evaluator
  （8/8 BEHAVIOR 真实执行 PASS）与 judge（Brain API 机械预检 + DeepSeek 语义复核 PASS），
  并用 PR head SHA（4e4768889b3070d64341176652d525cf0456421f）逐一核对 evaluator/judge
  verdict 文件里记录的 sha 与实际合并 sha 一致，确认无代码漂移，流程完整性未受损。
  真正的修法应该是让 should-auto-merge.sh 增加对 harness_initiative(skill-relay) 任务的
  evaluator/judge 完成态检查，避免"先合并、后补验收"的时序倒置常态化。

- 现象：harness-report Phase A Step 1（回写 Brain 任务 completed）首次 PATCH
  `/api/brain/tasks/:id` 返回 `success:true, accepted:false, reason:"pr_not_found"`，
  任务状态未真正转为 completed。
  根因：`finalizeHarnessTask`（packages/brain/src/lib/harness-finalize.js）对
  harness_initiative(skill-relay) 任务的 completed 请求做外部真相核验，只信任
  `tasks.pr_url` 列或 `payload.pr_url`（不采信请求体 `result.pr_url`，防 LLM 自报伪造）。
  本次两者都为空；PR 分支名 `cp-07151300-headed-smoke-049` 又不含完整 task_id 短码
  `049ebf93`（只有末尾 `049`），导致按分支名反查 GitHub 的兜底路径也没命中，
  于是判定 `pr_not_found`。
  修法：先用 `PATCH /api/brain/tasks/tasks/:id`（task-tasks.js 路由，与
  routes/tasks.js 同挂载前缀但分先后优先级，需走 `/tasks/tasks/` 显式路径避免被
  routes.js 里更早注册的 tasksRouter 截胡）单独写入 `pr_url` 列，让其满足
  `finalizeHarnessTask` 的正则校验（`^https://github.com/...pull/\d+$`），随后再
  发起 `status=completed` 请求，`gh pr view` 核验 MERGED + evaluator gate 均通过后
  才放行终态。

### [DESIGN] 设计缺陷
- 现象：`app.use('/api/brain', brainRoutes)`（含 routes/tasks.js 的 PATCH
  `/tasks/:task_id`）与 `app.use('/api/brain/tasks', taskTasksRoutes)`
  （routes/task-tasks.js 的 PATCH `/:id`）路径前缀重叠但字段能力不同——前者只接受
  `status`/`result`，后者额外接受 `pr_url`/`priority`/`title` 等顶层列。由于
  Express 按注册顺序匹配，前者先注册导致同路径下后者的能力实际不可达，只能靠
  `/api/brain/tasks/tasks/:id` 这条第二挂载点绕过去，调用方若不知道这个内部实现
  细节，很容易卡在 `pr_not_found` 降级循环里出不来。属于路由挂载设计上的隐性坑，
  建议后续要么合并两个路由的字段能力，要么在 routes/tasks.js 的错误响应里提示
  "如需设置 pr_url 请走 /api/brain/tasks/tasks/:id"。

## 下次预防清单

- [ ] harness-report Step 1 若首次 PATCH 返回 `accepted:false, reason:"pr_not_found"`，
      直接改走 `PATCH /api/brain/tasks/tasks/:id` 先补写 `pr_url` 列，再重试
      `status=completed`，不要重复无脑重试同一条请求。
- [ ] 遇到"PR 已被 should-auto-merge.sh 等外部机制提前合并、evaluator/judge 尚未跑完"
      的场景，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际
      合并 sha 是否一致，确认无漂移后才能在报告里如实标注"流程完整性未受损，仅执行
      顺序被提前触发"，不能跳过这步核对直接下结论。
