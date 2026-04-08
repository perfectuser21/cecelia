# Sprint Contract Draft (Round 1)

**起草方**: Generator / Contract Proposer  
**对应 PRD**: sprints/harness-v4-self-optimize/sprint-prd.md  
**轮次**: R1

---

## Feature 1: GAN 对抗层防死循环

**行为描述**:  
当 `harness_contract_propose` ↔ `harness_contract_review` 对抗轮次达到 `MAX_GAN_ROUNDS`（默认 5）时，`execution.js` 中的 `harness_contract_review` 完成处理器强制将当前合同草案视为 APPROVED，并继续创建 `harness_generate` 任务，payload 中携带 `forced_approval: true`。

**硬阈值**:  
- `MAX_GAN_ROUNDS` 常量存在于 `execution.js`，值为 5（可配置）
- 当 `harnessPayload.propose_round >= MAX_GAN_ROUNDS` 时，无论 Reviewer 输出 REVISION 还是任何值，系统必须创建 `harness_generate`
- 创建的 `harness_generate` 任务 payload 必须包含 `forced_approval: true` 字段
- `propose_round` 从 1 开始计数，第 5 轮 Review 时触发降级

---

## Feature 2: harness_ci_watch 超时后的降级处理

**行为描述**:  
当 `harness_ci_watch` 任务的 `poll_count` 达到 `MAX_CI_WATCH_POLLS`（120）时，`harness-watcher.js` 中的 `processHarnessCiWatchers` 不再将任务标记为 `failed`，而是将任务标记为 `completed`，并创建 `harness_evaluate` 任务，payload 中携带 `ci_timeout: true`。

**硬阈值**:  
- `MAX_CI_WATCH_POLLS` 已存在于 `harness-watcher.js`，值为 120
- 超时时任务状态变为 `completed`（不是 `failed`）
- 新建的 `harness_evaluate` 任务 payload 必须包含 `ci_timeout: true`
- 该 `harness_evaluate` 任务的 `pr_url` 字段来源于 `harness_ci_watch` 任务的 payload

---

## Feature 3: harness_fix 后 pr_url 正确传递

**行为描述**:  
当 `harness_fix` 任务完成时，`execution.js` 创建新的 `harness_ci_watch` 任务，其 `payload.pr_url` 必须来自 `harness_fix` 任务的 `result.pr_url`（Generator 在 fix 后推送新 PR），而不是原始 `harness_ci_watch` 的旧 `pr_url`。

**硬阈值**:  
- `harness_ci_watch` 任务的 `payload.pr_url` 不等于 `harness_fix` 的 `payload.pr_url`（旧 PR）
- `harness_ci_watch` 任务的 `payload.pr_url` 等于 `harness_fix` 的 `result.pr_url`（新 PR）
- 新增测试：模拟 `harness_fix` callback，验证创建的 `harness_ci_watch` payload 中的 `pr_url` 字段
- 测试文件位于 `packages/brain/src/__tests__/`

---

## Feature 4: harness_deploy_watch 超时降级（验证现有代码路径）

**行为描述**:  
当 `harness_deploy_watch` 的 `poll_count` 达到 `MAX_DEPLOY_WATCH_POLLS`（60）时，`processHarnessDeployWatchers` 将任务标记为 `completed`（带 note），并创建 `harness_report`，payload 中携带 `deploy_timeout: true`。此路径需要有测试覆盖。

**硬阈值**:  
- 超时时创建的 `harness_report` 任务 payload 必须包含 `deploy_timeout: true`
- 新增测试验证此超时路径的行为
- 测试文件位于 `packages/brain/src/__tests__/`

---

## Feature 5: harness-watcher.js 轮询频率控制

**行为描述**:  
`processHarnessCiWatchers` 内部使用模块级 Map（`lastPollTime`）记录每个 `harness_ci_watch` 任务的上次实际轮询时间戳。每次被 tick 调用时，若距上次轮询不足 30 秒，则跳过该任务的 `checkPrStatus` 调用，仅更新 poll 计数不递增。

**硬阈值**:  
- `POLL_INTERVAL_MS` 常量值为 30000（30 秒）
- 同一任务在 30 秒内被重复 tick 时，`checkPrStatus` 调用次数为 0
- `lastPollTime` 为模块级 Map，key 为 task_id
- 测试验证：连续两次调用 `processHarnessCiWatchers`（间隔 < 30s），`checkPrStatus` 仅被调用一次
