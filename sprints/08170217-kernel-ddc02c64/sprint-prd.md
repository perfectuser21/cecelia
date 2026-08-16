# Sprint PRD — 修复 gan_no_push_streak 误判（提案分支观测退 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness GAN 循环因观测故障产生的假失败）

## 背景

生产实证（08-15 13:38 -05）run 7a8e5319（task ff2b0fa9）proposer 两轮都真实 push 了提案分支（GitHub 上确有 cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a10/-a13），kernel 却连续两次观测 proposeBranchRn=0 → noPushStreak 到 2 → run 以 gan_no_push_streak 终态失败。根因：ground-truth 只在 payload.base_repo 命中 GitHub 模式时才用 GitHub URL，否则退回本地 'origin'；而 kernel workspace 的 origin 指向本机克隆路径，ls-remote origin 永远看不到 GitHub 上的提案分支 → rn 恒 0。7 天内 146 条 harness 任务里 29 条缺 payload.base_repo，同病随时复发。决策日志 hop10/13 已带 crossCheckMismatch:true 却无人消费。

## Golden Path（核心场景）

系统从 [proposer 真实 push 提案分支] → 经过 [kernel 从正确 remote 观测分支] → 到达 [真 push 被正确计数、run 不再被误杀]。

具体：
1. Proposer 真实 push 提案分支到 GitHub（cp-harness-propose-*）并成功回调。
2. Kernel `ground-truth.js` 解析提案 remote：优先 `parseBaseRepo(payload.base_repo)`；为空时退回 `parseBaseRepo(payload.repo)` 短名（经 github-pr-discovery repoMap 把 'cecelia'/'zenithjoy-workspace' 别名规范为 GitHub URL）；**两者都解析不到时禁止退 'origin'**，而是 `observed.proposalRemoteUnresolved=true`。
3. `git ls-remote --heads <GitHub URL>` 列出提案分支 → observed.proposeBranchRn ≥ 1（真 push 被正确观测，不再恒 0）。
4. `derive.js` 决策：`gan_no_push_streak` 仅当 `counters.crossCheckMismatch===false` 才允许触发；`crossCheckMismatch===true`（成功回调数 > 观测 rn）判为观测故障 → 写 `verdict:proposal_observation_mismatch` 日志行并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败；`proposalRemoteUnresolved===true` → `reason='proposal_remote_unresolved'`（独立 failure_reason，不得再记成 gan_no_push_streak）。
5. 建任务口 `work-routing-store.js#createRoutedTask`：coding_mutation 任务在 metadata/payload 缺 base_repo 时，从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL 写入 `payload.base_repo`（短名/别名一律规范化为完整 URL）。

出口：真 push 的 run 不再被 gan_no_push_streak 误杀；缺 base_repo 的新任务落库即带完整 GitHub URL。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- base_repo 与 repo 皆空 → 不执行 `ls-remote origin`，proposalRemoteUnresolved=true，失败原因独立。
- repo 短名不在 repoMap 别名表 → 视为解析不到，走 unresolved 分支，不猜测 URL。
- crossCheckMismatch 连续 3 次仍不消除 → 以 proposal_observation_mismatch 收敛失败，避免无限重观测。
- 非 coding_mutation 任务缺 base_repo → 不强行回填（回填只针对 coding_mutation）。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/ground-truth.js` 提案 remote 解析（base_repo → repo 兜底 → unresolved，禁退 origin）。
- `packages/brain/src/orchestrator/derive.js` gan_no_push_streak 触发条件门控 + 两个新 failure_reason 字符串值。
- `packages/brain/src/work-routing-store.js#createRoutedTask` 缺 base_repo 回填规范 URL。
- Brain semver bump 四处同步；DevGate 三项通过。

**不在范围内**：
- 不改 `counters.js` 的 after>before 语义。
- 不改 proposer SKILL。
- 不复活旧 failed run（ff2b0fa9 已死，修复上线后另建 successor）。
- 只加 `initiative_runs.failure_reason` 字符串值，**不改** harness_attempts.failure_class 枚举（故本单无 enum migration）。

## 假设

- [ASSUMPTION: github-pr-discovery.js 的 repoMap 已认 'cecelia'/'zenithjoy-workspace' 短名与 GitHub URL 别名，proposer 复用即可，无需新建映射。]
- [ASSUMPTION: 合同冻结测试与内容可原样复用前一单（1bc5cd92 的 sprints/08160958-kernel-1bc5cd92/tests/ 及 a1c207df 合同），本单硬约束是**测试文件必须落在 sprints/08170217-kernel-ddc02c64/tests/**；永久回归由 Generator 复制到 packages/brain/src/**/__tests__/。]
- [ASSUMPTION: MAX_NO_PUSH_STREAK 常量语义不变（=2），仅新增触发前的 crossCheckMismatch 门控。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 repo 兜底 + unresolved 分支，禁退 origin（当前 736-742 行）。
- `packages/brain/src/orchestrator/derive.js`: gan_no_push_streak 门控（923-924 行附近）+ proposal_observation_mismatch/proposal_remote_unresolved 分支。
- `packages/brain/src/work-routing-store.js`: createRoutedTask 缺 base_repo 从 map_scope_repositories 回填规范 URL。
- `packages/brain/src/orchestrator/github-pr-discovery.js`: 复用 repoMap 别名解析（只读引用，预计不改或小改导出）。
- `packages/brain/package.json` 等四处: semver bump 同步。
- `sprints/08170217-kernel-ddc02c64/tests/`: 合同冻结测试落地位置（kernel 只认此目录）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 无命中（step/feature 均空）；以下为 PrepPRD 显式约束 -->
- 版本要求: Brain semver 四处同步 bump（package.json 等），DevGate 三项（facts-check / check-version-sync / check-dod-mapping）必须通过。
- schema↔code parity: 新 failure_reason 若涉及 harness_attempts.failure_class 枚举需同步 migration + parity 测试；本单仅加 initiative_runs.failure_reason 字符串值，不触发 enum migration。
- 可观测: crossCheckMismatch 观测故障必须写 `verdict:proposal_observation_mismatch` 日志行（不静默吞）。
- Unified Map: task.payload.map_repo 未提供（map_scope=["F1"]，map_repo=null）→ Map 快照未配置，本单不做领域猜测。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 均空；以下为 area 级中与本 kernel/harness line 相关者 -->
- [观测即真相] 提案分支观测必须打到承载真 push 的 remote，禁止用本地 origin 冒充 GitHub 观测（来源: 本单根因，area）
- [Fleet Brain URL] Fleet Generator 的 Brain/仓库 URL 以服务端权威为准（来源: area · Fleet Generator Brain URL authority）
- [planner 分支] Planner 使用服务端签发的 PLANNER_BRANCH，不自行 checkout/switch（来源: area · planner_role_branch）
- [kernel 验证时钟] Kernel 对既有 PR 采用 evaluator validation clock（来源: area · Kernel existing PR evaluator validation clock adoption）
<!-- 注: 其余 area invariant（capture-triage/android_realmachine 等）不属本 line 范围，未注入 -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史 golden_path 记录）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api（curl + psql）填入 contract-draft.md。

```bash
# 占位：proposer 将填入 local_api 真实脚本（curl localhost:5221 + psql scratch 库）
# 期望验收点（自然语言）：
# 1. 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative；
#    psql 查 tasks.payload->>'base_repo' === 'https://github.com/perfectuser21/cecelia.git'。
# 2. kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin（proposalRemote 含 github.com，rn 不恒 0）。
# 3. 回归夹具：用 run 7a8e5319 的 decisionLog + 空 base_repo + 假 ls-remote
#    （对 URL 返回两条 propose 分支、对 origin 返回空）→ 旧代码 rn=0、新代码 rn=1。
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain 后端（orchestrator + work-routing-store），无 UI、无远端 agent 协议、无 engine hooks。
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部/后端逻辑与建任务口，E2E 走本地 evaluator（curl localhost:5221 + psql scratch 库）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
