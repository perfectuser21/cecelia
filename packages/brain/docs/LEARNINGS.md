# Development Learnings

## [2026-05-03] PROBE_FAIL_SELF_DRIVE_HEALTH — DB 写入失败时内存 grace 回退 (cp-05030003)

### 根本原因

`probeSelfDriveHealth` 的宽限期逻辑依赖 DB 中的 `loop_started` 事件。
如果 Brain 启动时 `startSelfDriveLoop()` 的 `recordEvent('loop_started')` 因 DB 短暂不可用而失败（静默 catch），
宽限期 `loopStartedHealthy` 永远为 false（`loopStartedAt = null`）。

同时，2min 首次 cycle 的 `recordEvent('no_action')` 若也失败，则 `successCnt=0`。

此时探针会看到：
- loop IS 运行中（`getSelfDriveStatus().running = true`）
- DB 中无任何 `self_drive` 事件
- 宽限期不适用 → `ok=false`，触发无限 auto-fix 循环

### 修复内容

**`packages/brain/src/self-drive.js`**：
- 新增模块级变量 `_loopStartedAt = null`，在 `startSelfDriveLoop()` 中于设置 `_driveTimer` 前记录
- `getSelfDriveStatus()` 新增 `started_at` 字段暴露该值

**`packages/brain/src/capability-probe.js`**：
- 在 `probeSelfDriveHealth` 中保存 `sdStatus`（含 `started_at`）到 `selfDriveStatusForGrace`
- DB 宽限期失效后，新增 in-memory 回退：若 `successCnt=0 && errorCnt=0 && started_at` 在 6h 内，返回 `ok:true`
- 有 cycle_error 时不使用 in-memory 宽限（区分 DB 写失败 vs 真实 LLM 失败）

### 测试覆盖

`src/__tests__/capability-probe-highlevel.test.js` 新增 3 个测试：
- `ok:true` — loop 运行、DB 事件缺失、started_at 在 30min 内（主修复场景）
- `ok:false` — started_at > 6h（超出宽限期，真实 cycle 未执行）
- `ok:false` — started_at 在 30min 内但有 cycle_error（真实失败，不宽恕）

`src/__tests__/self-drive.test.js` 更新 `getSelfDriveStatus` 断言加入 `started_at`。

### 设计决策

宽限期 6h 与 DB `loop_started` 宽限期一致，覆盖默认间隔（4h/12h）+ 缓冲。
`errorCnt > 0` 时不使用内存宽限，防止 LLM 真实失败被掩盖。

---

## [2026-05-03] Auth 失败指数退避计数持久化 — Brain 重启后退避计数归零 (cp-05030002)

### 根本原因

`_authFailureCountMap`（账号连续 auth 失败计数）仅存活于内存，Brain 重启后清零。

指数退避逻辑：失败次数 → 退避时长（2h → 4h → 8h → 24h），重启后计数从 0 开始，
account3 等失效账号每次 Brain 重启后只被熔断 2h，而非应有的 8h/16h/24h，
导致短时间内重复产生 auth 错误和诊断任务，self_drive_health 探针被持续触发。

### 修复内容

**`packages/brain/migrations/259_account_usage_auth_fail_count.sql`**：
- `account_usage_cache` 表新增 `auth_fail_count INTEGER NOT NULL DEFAULT 0` 列

**`packages/brain/src/account-usage.js`**：
- `markAuthFailure()` — INSERT/ON CONFLICT 中增加 `auth_fail_count` 列，持久化当前失败计数
- `resetAuthFailureCount()` — 新增 `UPDATE account_usage_cache SET auth_fail_count = 0`
- `loadAuthFailuresFromDB()` — SELECT 增加 `auth_fail_count` 列，Brain 启动时恢复内存计数

**`packages/brain/src/selfcheck.js`**：
- `EXPECTED_SCHEMA_VERSION` 更新为 `'259'`

### 测试覆盖

`src/__tests__/account-usage.test.js` 新增 7 个测试（`Auth Fail Count Persistence` describe）：
- `markAuthFailure` 首次写 `auth_fail_count=1`
- 连续失败累积计数到 DB
- 第 4 次指数退避封顶（count=4）
- `resetAuthFailureCount` 有记录时更新 DB
- `resetAuthFailureCount` 无记录时不触发 DB
- `loadAuthFailuresFromDB` 恢复计数后下次从正确位置继续累积
- `auth_fail_count=0` 不恢复到内存（避免覆盖初始状态）

### 预防措施

**Brain 状态持久化原则**：所有影响"下次行为"的内存计数器（退避计数、熔断状态）
必须同步写入 DB，并在 `loadXxxFromDB()` 中恢复，防止重启导致保护机制失效。

## [2026-03-10] Brain 任务重复派发 — 代码已修但任务仍在队列 (PR #800)

### 根本原因
Brain 在 2026-03-08 生成了「修复 cortex _reflectionState 不检查过期」任务，但 PR #791（代码修复）和 PR #796（D5 单测）已先行合并，任务状态未同步更新。导致 Brain 重新派发时该任务已是 done 状态，但 Brain 队列仍有记录。

### 下次预防
- [ ] PR 合并后如果对应 Brain 任务存在，自动调用 `PATCH /api/brain/tasks/:id` 将状态更新为 `completed`
- [ ] Brain 派发任务时检测相关 PR 是否已合并（通过 PR title/branch 比对）
- [ ] DoD 中已完成的 D1-D6 条目也必须提供 `Test:` 字段（指向对应测试文件路径）

### Technical Note
`_loadReflectionStateFromDB()` 过期检查逻辑：使用 `lastSeen ?? firstSeen` 作为滑动窗口起点，超过 `REFLECTION_WINDOW_MS`（30 分钟）则跳过加载并 DELETE from DB。本 PR 补充了启动清理时的可观测性日志。

## [2026-03-08] cortex 输出去重熔断 — 阻断皮层回声室 (PR #700)

### Problem
皮层连续 8 轮输出同一份 root_cause 诊断，反思系统退化为回声室。现有 `_reflectionState` 是输入级去重（基于事件哈希 type+failure_class+task_type），无法拦截"输入不同但 LLM 输出相同"的回声。

### Solution
在 `analyzeDeep` 中新增 `_outputDedupState`（输出级去重）：
- 对 LLM 返回的 `decision.analysis.root_cause` 做 SHA256 内容哈希
- 相同诊断 ≥2 次自动熔断（比输入级阈值 3 更严格）
- 独立 Map + 独立持久化（`cortex_output_dedup:*` key in working_memory）
- 复用 30 分钟时间窗口

### Architecture Pattern
**双层去重架构**：输入级（事件特征）+ 输出级（诊断内容），两层独立管理。输入级防止重复分析同类事件，输出级防止 LLM 陷入固定模式输出。阈值不同（输入 3，输出 2）因为输出相同 = 确定无新信息。

### Key Decision
- 输出去重放在 LLM 调用**之后**（而非之前），因为需要先拿到 LLM 输出才能比较
- 第 1 次调用正常返回并记录 hash，第 2 次相同输出直接 fallback
- 这意味着最多浪费 1 次 LLM 调用就能检测到回声

## [2026-03-07] pr-callback-handler 同步更新 pr_url 和 pr_merged_at 列 (PR #594)

### Bug
- **新增列未写入**：migration 130 为 tasks 表新增了 `pr_url` 和 `pr_merged_at` 直接列，但 `handlePrMerged` SQL UPDATE 写于 migration 之前，只更新了 `metadata`/`payload` 中的 JSON 值，未更新直接列。导致 `GET /api/brain/metrics/success-rate` 通过 `pr_merged_at IS NOT NULL` 判断时永远返回 `success_rate: 0`。

### Fix
- 在 `handlePrMerged` SQL UPDATE 中增加 `pr_url = $5` 和 `pr_merged_at = COALESCE($6::timestamp, NOW())`
- `RETURNING` 子句增加 `pr_url, pr_merged_at`
- 参数列表扩展为 6 个：`[taskId, mergedAt, prMeta, payloadUpdate, prUrl, mergedAt]`

### CI 坑
- version-check CI 在 rebase 后发现 `origin/main` 已有相同版本号（另一个 PR 并行合并）→ 需再次 bump 版本。模式：**版本 bump 要紧接在 PR 创建后、不能假设 main 版本不变**。
- `workflow_dispatch` 触发的 CI run 不与 PR checks 关联，需要通过实际 push 触发 PR event。

## [2026-03-05] 统一账号选择入口 (PR #547)

### Bug
- **已有测试未适配统一入口**：`llm-caller-account-selection.test.js` ACS2 测试 mock 了废弃的 `selectBestAccountForHaiku`，但 `llm-caller.js` 已改为统一调用 `selectBestAccount({ model: 'haiku' })`，导致 mock 不生效、CI 失败。修复：更新 mock 目标为 `selectBestAccount`。

### Architecture
- **双入口合并为单入口**：原有 `selectBestAccount()`（Sonnet/Opus 三阶段降级）和 `selectBestAccountForHaiku()`（独立 5h 配额）两个函数，现统一为 `selectBestAccount({ model })` 单入口。`model: 'haiku'` 走 Haiku 独立模式，其他走三阶段降级链。
- **spending cap 过滤统一**：所有模型（Sonnet/Opus/Haiku）现在都在同一个函数内过滤 spending cap 账号，消除了 Haiku 路径遗漏 spending cap 检查的风险。

### Impact Level: High
消除了 Brain 内部 LLM 调用的双路径分裂，所有 `callLLM()` 调用统一走 `selectBestAccount({ model })`，spending cap 检测无死角。

## [2026-02-08] Alertness Signal Path Implementation (KR4)

### Bug
- **Version sync issue**: CI failed initially because brain version (1.14.0) wasn't updated in DEFINITION.md and .brain-versions file. The facts-check.mjs script enforces consistency across all version references.
- **Merge conflicts**: Multiple merge conflicts occurred with develop branch, particularly in PRD/DOD files and version numbers. Need to fetch and merge develop earlier in the process.

### Optimization Points  
- **Version management**: Consider automating version bumps across all files (package.json, package-lock.json, DEFINITION.md, .brain-versions) to prevent sync issues.
- **Workflow improvement**: The /dev workflow could benefit from automatic develop branch merge before creating PR to reduce conflicts.

### Technical Achievements
- **Modular architecture**: Successfully implemented a fully modular alertness system with clean separation of concerns.
- **Seamless integration**: Integrated with existing tick loop without breaking functionality.
- **Comprehensive testing**: Created 5 test suites with good coverage.

### Impact Level: Medium
Successfully adds self-diagnosis capability to Cecelia Brain, critical for system reliability.
