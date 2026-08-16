# Sprint PRD — 修复 gan_no_push_streak 误判（提案 remote 退 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（Harness GAN 观测可信度：消除真 push 被误判为 no-push 的整类假失败）

## 背景

生产实证（08-15 13:38 -05）：run 7a8e5319（task ff2b0fa9）的 proposer 两轮都真实 push 了提案分支（GitHub 上存在 `cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a10/-a13`），kernel 却连续两次观测 `proposeBranchRn=0`，`noPushStreak` 累到 2，run 以 `gan_no_push_streak` 终态失败。决策日志 hop10/13 已带 `crossCheckMismatch:true` 却无人消费。

根因三点（均在 `packages/brain`）：
1. `ground-truth.js` 提案 remote 解析：`base_repo` 命中 GitHub 正则才用 URL，否则退 `'origin'`；task ff2b0fa9 的 `payload.base_repo` 为空、`payload.repo='cecelia'` 短名未被兜底 → 退 `'origin'`。
2. kernel cwd 的 workspace `origin` 指向本地路径 → `git ls-remote --heads origin cp-harness-propose-*` 只列本机分支，永远看不到 GitHub 上的真提案分支 → rn 恒 0。
3. 7 天内 146 条 harness_initiative 任务里 29 条缺 `payload.base_repo`（自愈 successor / 人工建单不回填），同病随时复发。

本单显式升档 **capability-change-v1**：Proposer 直出合同（含冻结失败测试，push 到 propose 分支）→ Generator → Evaluator → Judge → 人审。

## Golden Path（核心场景）

系统从 [Brain 派发含真 push 的 GAN 提案] → 经过 [kernel 提案 remote 解析 + 观测 + derive 判定 + 建任务口回填] → 到达 [真 push 不再被误判为 no-push；缺 base_repo 任务落库即带完整 URL]。

具体：
1. **提案 remote 解析（ground-truth.js）**：`parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)` —— `base_repo` 空时用 `repo` 短名（`cecelia`/`zenithjoy-workspace` 别名）经 repoMap 兜底解析成 `https://github.com/<owner>/<repo>.git`；两者都解析不到时**禁止退 `'origin'`**，改置 `observed.proposalRemoteUnresolved=true`。
2. **观测 rn**：`ls-remote` 对 GitHub URL 执行，能看到 proposer 真实 push 的提案分支 → rn≥1（旧代码对 origin 恒 0）。
3. **derive 判定（derive.js）**：`gan_no_push_streak` 只允许在 `counters.crossCheckMismatch===false` 时触发；`crossCheckMismatch===true`（proposer 成功回调数 > 观测 rn）视为观测故障 → 写 `verdict:proposal_observation_mismatch` 日志并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败；`proposalRemoteUnresolved=true` → `reason='proposal_remote_unresolved'`（独立 failure_reason，不得再记成 gan_no_push_streak）。
4. **建任务口回填（work-routing-store.js `createRoutedTask`）**：`coding_mutation` 任务在 metadata/payload 缺 `base_repo` 时，从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL 写入 `payload.base_repo`；短名/别名一律规范化为完整 URL。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- `base_repo` 与 `repo` 皆空/皆无法解析 → `proposalRemoteUnresolved=true`，不执行 `ls-remote origin`，failure_reason=`proposal_remote_unresolved`。
- proposer 回调成功数 > 观测 rn（观测故障）→ 不递增 noPushStreak，重新观测，满 3 次才失败。
- 短名 `cecelia` 与别名（`zenithjoy-workspace`）均需经 repoMap 归一为完整 GitHub URL。
- 已死 run（ff2b0fa9）不复活；修复上线后另建 successor。

## 范围限定

**在范围内**：`packages/brain` 内 ground-truth.js 提案 remote 解析、derive.js 的 no_push_streak/mismatch 判定、work-routing-store.js 建任务口 base_repo 回填；对应单测 + 回归夹具；Brain semver 四处同步；DevGate 三项。
**不在范围内**：不改 `counters.js` 的 `after>before` 语义；不改 proposer SKILL；不复活旧 failed run；不改 `harness_attempts.failure_class` 枚举（本单只加 `initiative_runs.failure_reason` 字符串值）。

## 假设

- [ASSUMPTION: repoMap（github-pr-discovery.js）已认 `cecelia`/`zenithjoy-workspace` 短名与 GitHub URL 别名，直接复用其解析逻辑]
- [ASSUMPTION: `map_scope_repositories` 提供 repo/aliases → owner/repo 的映射，可推出规范 clone URL]
- [ASSUMPTION: Proposer 合同冻结测试文件放在 `sprints/08162248-kernel-e8f7797f/tests/`（kernel 采集冻结产物只认此目录）；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`：提案 remote 解析加 `repo` 短名兜底 + 无解禁退 origin，置 `proposalRemoteUnresolved`
- `packages/brain/src/orchestrator/derive.js`：`gan_no_push_streak` 加 `crossCheckMismatch===false` 门 + `proposal_observation_mismatch`/`proposal_remote_unresolved` 两个独立 failure_reason
- `packages/brain/src/work-routing-store.js`：`createRoutedTask` 对 coding_mutation 缺 base_repo 时从 map_scope_repositories 回填规范 URL
- `packages/brain/src/orchestrator/github-pr-discovery.js`：复用 repoMap 短名/别名解析（如需导出）
- `packages/brain/package.json` 等四处：Brain 版本 semver bump 同步
- `sprints/08162248-kernel-e8f7797f/tests/`：合同冻结失败测试（ground-truth / derive / work-routing-store 单测 + run 7a8e5319 回归夹具）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均为空）+ PrepPRD 显式 NFR，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain 版本 semver bump 四处同步（PrepPRD 显式）
- 可观测: 观测故障必须写 `verdict:proposal_observation_mismatch` 日志行（不吞掉 crossCheckMismatch）；failure_reason 必须落 `initiative_runs.failure_reason`，与 gan_no_push_streak 区分（PrepPRD 显式）
- 门禁: DevGate 三项通过（facts-check / check-version-sync / check-dod-mapping）；failure_reason 只加 `initiative_runs.failure_reason` 字符串值，不改 `harness_attempts.failure_class` 枚举（不触发 migration）（PrepPRD 显式）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 task 无 step/journey_feature 级）；仅注入 F1 harness/kernel 相关铁律，android_realmachine 线 capture-triage learnings 出线不注入 -->
- [planner分支] Planner 只用服务端签发的 PLANNER_BRANCH，禁止 Provider 内自行 checkout/switch（来源: area）
- [Generator Brain URL] Fleet Generator 的 Brain URL 以服务端下发为权威（来源: area）
- [validation clock] Kernel 对已存在 PR 采用 evaluator 的 validation clock（来源: area）
- [generator身份] generator 基础设施重试须保持 identity 稳定（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 仅 planned ability，无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位 + 自然语言验收点；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 将填入 local_api 真实脚本（curl localhost:5221 + psql scratch 库）
# 期望验收点（自然语言）：
# 1) 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative，
#    psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'。
# 2) kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin（且 proposalRemoteUnresolved 缺省为 false）。
# 3) 回归夹具：用 run 7a8e5319 decisionLog + 空 base_repo + 假 ls-remote（URL 返回两条 propose 分支、
#    origin 返回空）→ 旧代码 rn=0、新代码 rn=1。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落 packages/brain 后端 orchestrator/建任务口，无 UI/远端 agent 协议/engine 参与。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，E2E 走本地 evaluator（curl localhost:5221 + psql scratch 库 + kernel run.js --dry-run）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定，ability_id 为空无 golden_path step）
