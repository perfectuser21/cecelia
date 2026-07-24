# Kernel Live-Chain Hotfix Design

## 背景

PR #4226 已部署为 Brain `1.267.65`。随后 mixed-provider fire drill
（task `617f2dad-0940-4c77-bd3e-3ef711c3d939`，run
`b932ad01-5e1b-4d11-ae7d-ab9c179d2700`）真实暴露两个接缝缺口：

1. generator 复用了合同分支 `cp-harness-propose-r1-617f2dad-a2` 创建 PR，
   因而触发 branch naming、TDD commit order、test contract 和测试金字塔门禁。
2. generator-fix 完成后没有写入 `verdict:generator-fix-callback`；kernel 观察一次后
   以 `generator_fix_callback_missing_after_observation` 终局，而没有进入预期的
   `no_progress_same_sha` 收敛判定。

本 hotfix 只闭合这两个真实链路缺口，不改 #4226 已批准的收敛模型、人审模型或
合同语义。

## 根因证据

### 缺口 A：generator 缺少任务 ID 环境变量

`packages/brain/src/orchestrator/dispatcher.js` 的 detached launcher 只注入
`CECELIA_TASK_ID`。但 `packages/workflows/skills/harness-generator/SKILL.md`
创建合规实现分支时只接受 `HARNESS_TASK_ID`，为空即拒绝创建 `cp-*` 分支。

因此 TaskBundle 虽然含 `inputs.task_id`，generator 进程的既有分支创建合同仍然断开。
fire drill 的实际 PR #4293 head 分支正是合同分支，和该缺口一致。

### 缺口 B：callback 把 provider 自报 SHA 当作入口条件

`packages/brain/src/routes/harness-callback.js` 的
`appendGeneratorFixCallback()` 只从以下三个结构化位置读取 claimed SHA：

- `artifacts[].type === "pull_request" && artifacts[].head_sha`
- `decision.pr_head_sha`
- `provider_metadata.pr_head_sha`

真实 Codex generator-fix 结果只返回字符串 artifacts，且没有 SHA。当前代码在查询
run 的 `pr_url` 之前就 `return`，所以服务端明明可以向 GitHub 取权威 head，却没有
执行对账，也没有写 callback verdict。

## 方案比较

### 方案 A：服务端权威对账 + 环境变量兼容注入（采用）

- launcher 同时注入 `HARNESS_TASK_ID` 与现有 `CECELIA_TASK_ID`。
- callback 有合法 claimed SHA 时保持现有“自报 SHA + GitHub 对账”路径。
- callback 没有 claimed SHA 时，以 run 已知的 `pr_url` 调用同款 resolver，使用
  GitHub 当前 head 作为权威 callback SHA。
- resolver 暂时失败或 `pr_url` 尚未落库时写 `verification_pending`，不得误判假 SHA。

优点：不解析 LLM 自然语言；不信任执行体；直接利用已有外部真相；改动集中且兼容
旧 provider 输出。

### 方案 B：收紧 HarnessResult schema，强制 provider 返回 pull_request 对象

缺少结构化 PR artifact 的 callback 直接 HTTP 400。

优点：输出合同更整齐。缺点：现有 Claude/Codex/Grok adapter 和 runner 都要同步升级；
单个 provider 格式漂移会把原本可由 GitHub 对账恢复的 run 变成基础设施失败，扩大
hotfix 范围。

### 方案 C：从 summary 或字符串 artifacts 提取 PR/SHA

实现最省代码，但违反“只认结构化证据、不从自然语言猜进展”的收敛铁律，而且允许
执行体通过文字伪造进展。本方案明确禁止。

## 详细设计

### 1. Generator 分支合同接通

在 `createDetachedLauncher()` 传给 runner 的 env 中追加：

```text
HARNESS_TASK_ID = bundle.inputs.task_id
```

保留现有 `CECELIA_TASK_ID`，避免影响其他 relay/runner 消费者。两者必须来自同一个
服务端 TaskBundle 字段，不能接受 worker 自报覆盖。

回归测试必须通过真实 `createDetachedLauncher()` 调用检查：

- generator 收到 `HARNESS_TASK_ID`
- 它与 `CECELIA_TASK_ID` 相等
- evaluator/reviewer 等既有 env 和 Git 写保护不回归

### 2. Generator-fix callback 服务端回退

`appendGeneratorFixCallback()` 先读取对应 `spawn:generator-fix` intent 与 run
`pr_url`，再决定验证路径：

1. 有 claimed SHA：
   - 格式非法：`invalid / callback_sha_invalid`
   - resolver 得到相同 SHA：`verified`
   - resolver 暂时不可用、无结果，或 GitHub head 已前进：`verification_pending`
   - 对账成功且明确不匹配：`unverified / callback_sha_unverified`
2. 无 claimed SHA：
   - `pr_url` 存在且 resolver 成功：使用 GitHub head，写 `verified`
   - resolver 失败、无结果或 `pr_url` 缺失：以 trigger SHA 作为观察锚，
     写 `verification_pending`

无 claimed SHA 时绝不读取 summary、checks 或字符串 artifacts。GitHub resolver 的
返回值仍必须经过 40 位小写 hex normalize。

当权威 GitHub head 与 fix intent 的 trigger SHA 相同时，既有 counters 必须推导：

```text
noProgress = true
noProgressReason = no_progress_same_sha
```

从而不再落入“callback 完全缺失”的观察周期。

### 3. 错误处理和兼容边界

- resolver 网络错误是 pending，不是假 SHA，不得立即 FAILED。
- `pr_url` 缺失是 pending，不得从 provider 文字猜 URL。
- 有 claimed SHA 的既有对抗语义保持不变。
- callback append 继续按 attempt ID 幂等，每次 attempt 恰一行。
- 不修改 `MAX_HOPS`、deadline、patience、失败集合历史或人审出口。
- 不修改现有合同测试来迁就实现。

## 测试设计

严格 Red→Green，测试提交先于实现提交。

### Red 1：launcher 环境变量

在 `packages/brain/src/orchestrator/__tests__/dispatcher.test.js` 增加回归测试，使用
真实 detached launcher 捕获 `spawnDetached` 参数，断言 generator env 同时具有一致的
`HARNESS_TASK_ID` 和 `CECELIA_TASK_ID`。当前实现应因前者为 `undefined` 而真红。

### Red 2：无 claimed SHA 的真实 callback

在 `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js` 增加真 Router
回归场景：

- 已存在 `spawn:generator-fix` intent，trigger SHA 为 40 位合法 SHA
- run 已有 `pr_url`
- Codex 风格结果只有字符串 artifacts，不带任何 SHA
- 注入 resolver 返回与 trigger 相同的 GitHub head

断言 callback HTTP 成功，且只写一行
`verdict:generator-fix-callback`，其 `verification_status=verified`、
`pr_head_sha=trigger SHA`。

再增加 resolver 抛错场景，断言写 `verification_pending`，不写
`callback_sha_unverified`。

### 集成回归

扩展或复用 kernel callback flow/真 PG 集成测试，证明：

```text
spawn:generator-fix
→ provider callback（无 claimed SHA）
→ verdict:generator-fix-callback
→ counters.noProgress=true
→ terminal no_progress_same_sha
```

同时保留现有假 SHA、大写 SHA、短 SHA、head 前进和 legacy callback 回放测试全绿。

## 验收

1. 两组新增测试均有真 Red 输出和 Green 输出。
2. callback、dispatcher、kernel callback flow 定向回归全绿。
3. Brain kernel 回归池、真 PostgreSQL 集成测试、DevGate 全绿。
4. Brain 版本按合并时 main 的下一可用版本分配，并同步 `.brain-versions`、
   `packages/brain/DEFINITION.md` 等现行四处版本账本。
5. 独立 hotfix PR 保持 kernel live-chain 范围，不混入 fire-drill 文档 PR #4293。
6. PR 设 `review_required=true`，evaluator PASS、judge PASS、CI 全绿后停在人工门，
   不自批、不预授权合并。
7. 合并并部署后重跑同一 mixed-provider fire drill；必须同时证明：
   - generator 使用新的合规 `cp-*` 实现分支；
   - 一次无变更 generator-fix 通过服务端对账命中
     `no_progress_same_sha`，而不是 callback missing；
   - 不产生第二次 fix，不发生误 merge。
