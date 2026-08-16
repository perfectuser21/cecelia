# Sprint PRD — 修复 gan_no_push_streak 误判（提案分支观测退回本地 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（harness kernel GAN 观测正确性，消除假失败终态）

## 背景

生产实证 08-15 13:38：run 7a8e5319（task ff2b0fa9）proposer 两轮都真实 push 了提案分支（GitHub 上存在 -a10/-a13 两个 commit），kernel 却连续两次观测 `proposeBranchRn=0`，`noPushStreak` 到 2，run 以 `gan_no_push_streak` 终态假失败；决策日志 hop10/13 已带 `crossCheckMismatch:true` 却无人消费。根因：① `ground-truth.js` 提案 remote 解析在 `base_repo` 空时退回 `'origin'`，而 kernel worktree 的 origin 是本地路径 → `git ls-remote origin` 永远看不到 GitHub 提案分支，rn 恒 0；② `derive.js` 未消费 `crossCheckMismatch` 就递增 streak；③ 建任务口缺 `base_repo` 兜底（7 天内 146 单里 29 单缺）。

## Golden Path（核心场景）

系统从 [缺 base_repo 的 harness 任务入队] → 经过 [建任务口回填 URL / kernel 用正确 remote 观测提案分支 / derive 消费 crossCheckMismatch] → 到达 [真实 push 被计为 rn≥1，不再误判 gan_no_push_streak]

具体：
1. 建任务：POST `harness_initiative` 不带 `base_repo`、`payload.repo='cecelia'` → work-routing-store 对 coding_mutation 任务从 map_scope_repositories 的 repo/aliases 推出规范 clone URL，回填 `payload.base_repo='https://github.com/perfectuser21/cecelia.git'`
2. GAN 观测：ground-truth 以 `parseBaseRepo(base_repo) ?? parseBaseRepo(repo)` 解析 proposalRemote，`git ls-remote --heads` 命中 GitHub URL 而非本地 origin；两者皆解析不到时**不退 origin**，置 `observed.proposalRemoteUnresolved=true`
3. derive 判定：`gan_no_push_streak` 仅在 `crossCheckMismatch===false` 时触发；`crossCheckMismatch===true`（成功回调数 > 观测 rn）写 `verdict:proposal_observation_mismatch` 日志并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败；`proposalRemoteUnresolved=true` → `reason='proposal_remote_unresolved'`
4. 出口（可观测）：真实 push 被观测为 `proposeBranchRn≥1`，run 不再以 `gan_no_push_streak` 假失败；无法解析 remote / 观测持续故障时落独立 `failure_reason`

## 边界情况

- `base_repo` 与 `repo` 皆空 → 不执行 `ls-remote origin`，`proposalRemoteUnresolved===true`
- 短名/别名（`cecelia` / `zenithjoy-workspace`）→ 一律规范化为完整 GitHub clone URL
- `crossCheckMismatch=true` 连续 3 次仍 mismatch → 以 `proposal_observation_mismatch` 终态失败（有界，不无限重观测）

## 范围限定

**在范围内**：`ground-truth.js` 提案 remote 解析与兜底；`derive.js` streak 判定消费 crossCheckMismatch + 两个独立 failure_reason；`work-routing-store.js` 建任务口 base_repo 回填。
**不在范围内**：不改 `counters.js` 的 after>before 语义；不改 proposer SKILL；不复活旧 failed run（ff2b0fa9 已死，另建 successor）；不改 `harness_attempts.failure_class` 枚举（本单只加 `initiative_runs.failure_reason` 字符串值）。

## 假设

- [ASSUMPTION: `github-pr-discovery.js` 的 repoMap 已认 `cecelia` / `zenithjoy-workspace` 短名与 GitHub URL 别名]
- [ASSUMPTION: `MAX_NO_PUSH_STREAK` 常量已存在于 constants，本单复用不新增阈值]
- [ASSUMPTION: proposer 冻结合同测试放 `sprints/08170551-kernel-73870d1b/tests/`；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 repo 兜底 + 禁退 origin，置 proposalRemoteUnresolved
- `packages/brain/src/orchestrator/derive.js`: gan_no_push_streak 门 crossCheckMismatch，新增两个 failure_reason
- `packages/brain/src/work-routing-store.js`: createRoutedTask 对 coding_mutation 缺 base_repo 时回填规范 URL
- `packages/brain/package.json`: semver bump（四处同步）
- `sprints/08170551-kernel-73870d1b/tests/`: 冻结合同测试（proposer 产出）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空）+ PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 观测重试: crossCheckMismatch 连续 3 次仍 mismatch 才终态失败（有界重观测，来源: PrepPRD 修法 B）
- 版本要求: Brain semver bump 四处同步（来源: PrepPRD）
- 可观测: `proposal_observation_mismatch` / `proposal_remote_unresolved` 必须写 `initiative_runs.failure_reason` 独立值，不得再混记为 `gan_no_push_streak`（来源: PrepPRD）
- 门禁: DevGate 三项通过（facts-check / check-version-sync / check-dod-mapping，来源: PrepPRD + CLAUDE.md）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(空) + journey_feature(ability_id 空跳过) + area 三源，取与本 kernel 单相关的清洁铁律 -->
- [planner分支] planner 必须在服务端签发的 role branch 上工作，禁自行 checkout（来源: area）
- [Generator重试身份] generator 基建失败重试保持身份不变（来源: area）
- [Fleet Brain URL] Generator/kernel 以 Brain 下发 URL 为权威（来源: area）
- [kernelPR时钟] kernel 对既有 PR 采用 evaluator 验证时钟（来源: area）
- [env来源] target_environment 从 DB tasks.payload 读取，不从文件（来源: area）
- [merge权] generator 禁止自行 merge PR，merge 权归 controller（来源: area）
- [语义一致] 同一语义在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [null契约显式else] 调用"失败返回 null/false"契约的函数后必须显式写 else 分支（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [测试多租户] 测试默认多租户（来源: area）
- [租户隔离] 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths 仅含 planned ability，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql scratch 库 + node run.js --dry-run）。

```bash
# 占位：proposer 将填入 local_api 真实脚本
# 期望验收点（自然语言）：
# 1. 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative；
#    psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'
# 2. kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin（回归夹具：假 ls-remote 对 URL 返回两条 propose 分支、对 origin 返回空 → 旧码 rn=0 / 新码 rn=1）
# 3. derive：crossCheckMismatch=true 且 noPushStreak>=MAX 时 action 不是 gan_no_push_streak
```

## journey_type: autonomous
## journey_type_reason: 全部改动落在 packages/brain/src/orchestrator + work-routing-store，纯后端 kernel 逻辑，无 UI/远端 agent 参与。
## target_environment: local_api
## target_environment_reason: payload 显式 local_api；验收走本地 curl localhost:5221 + psql scratch 库 + node run.js --dry-run。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
