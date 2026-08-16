# Sprint PRD — 修复 gan_no_push_streak 误判（提案分支观测退到 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness GAN 环一个假失败终态，提高自治管道可信度）

## 背景

生产实证 08-15 13:38 -05：run 7a8e5319（task ff2b0fa9）Proposer 两轮都真实 push 了提案分支到
GitHub，但 kernel 连续两次观测 proposeBranchRn=0，noPushStreak 累到 2 → run 以
`gan_no_push_streak` 假失败终态。三条根因：① `ground-truth.js` 提案 remote 在 base_repo 为空时退回
`origin`，而 kernel worktree 的 origin 是本机路径，ls-remote 永远看不到 GitHub 分支 → rn 恒 0；
② `derive.js` 在 `crossCheckMismatch===true`（观测故障信号）时仍递增 noPushStreak 并终态失败，无人消费；
③ 7 天内 146 条 harness_initiative 有 29 条缺 base_repo，建任务口不回填 → 随时复发。

## Golden Path（核心场景）

系统从 [建 coding_mutation 任务] → 经过 [Proposer 真 push + kernel 观测提案分支] → 到达
[真 push 被正确计入 rn，不误判 gan_no_push_streak]。

具体：
1. Brain `createRoutedTask` 建一条 coding_mutation harness_initiative 任务；即使调用方未带
   `base_repo`，落库 payload 的 `base_repo` 也被回填为规范 clone URL
   `https://github.com/perfectuser21/cecelia.git`（从 map_scope_repositories 的 repo/aliases 推导）。
2. Proposer 真实 push 提案分支到 GitHub；kernel `ground-truth.js` 解析提案 remote 时优先用
   `parseBaseRepo(payload.base_repo)`，缺失则回退 `parseBaseRepo(payload.repo)`（短名 'cecelia' 经
   repoMap 别名解析为 GitHub URL），据此对 GitHub URL 跑 `git ls-remote` → 观测到真实分支，rn≥1。
3. 若 base_repo 与 repo 都解析不到 → **禁止退 'origin'**：置
   `observed.proposalRemoteUnresolved=true`，`derive.js` 以独立
   `reason='proposal_remote_unresolved'` mark_failed，绝不再记成 gan_no_push_streak。
4. 当 `counters.crossCheckMismatch===true`（proposer 成功回调数 > 观测 rn，即观测故障）时，
   `derive.js` 不触发 gan_no_push_streak、不递增 noPushStreak，改写 `verdict:proposal_observation_mismatch`
   日志行并重新观测；连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败。

## 边界情况

- base_repo 与 repo 皆空/皆无法解析 → proposalRemoteUnresolved=true，不跑 ls-remote origin。
- crossCheckMismatch=true 但 noPushStreak 已达上限 → action 必须**不是** gan_no_push_streak。
- crossCheckMismatch=false 且真无 push → 保持原 gan_no_push_streak 语义不变，不误伤正常失败。

## 范围限定

**在范围内**：`ground-truth.js` 提案 remote 解析（base_repo→repo 回退 + 禁 origin 兜底）；
`derive.js` gan_no_push_streak 触发门（crossCheckMismatch 守卫 + 两新 failure_reason 字符串值）；
`work-routing-store.js` createRoutedTask 对 coding_mutation 缺 base_repo 时回填规范 URL；
以及三点单测 + run 7a8e5319 回归夹具 + Final E2E（scratch 库数据写入 + kernel --dry-run 观测）。

**不在范围内**：不改 `counters.js` 的 after>before 语义与 crossCheckMismatch 计算；不改 Proposer SKILL；
不复活旧 failed run；不改 harness_attempts.failure_class 枚举（本单只加 initiative_runs.failure_reason 字符串值，不加 migration）。

## 假设

- [ASSUMPTION: `parseBaseRepo` 可把短名 'cecelia' 经 github-pr-discovery repoMap 别名解析为
  perfectuser21/cecelia；若不能则在 ground-truth 内接 repoMap 别名表。]
- [ASSUMPTION: map_scope_repositories 含 cecelia 的 repo/aliases，可推出 owner/repo 组装 clone URL。MAX_NO_PUSH_STREAK 仍为 2；proposal_observation_mismatch 连续上限取 3。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 repo 回退 + proposalRemoteUnresolved 标志。
- `packages/brain/src/orchestrator/derive.js`: gan_no_push_streak 门加 crossCheckMismatch 守卫 + 两新 reason。
- `packages/brain/src/work-routing-store.js`: createRoutedTask payload 回填 base_repo 规范 URL。
- `packages/brain/package.json`(+ 版本四处同步): semver bump；`sprints/08161919-kernel-cddddfca/tests/`: 合同冻结测试（Proposer 直出，禁放 src/__tests__/）。

## Response Schema

- N/A（无对外新增/变更 HTTP 响应契约；变更为 orchestrator 内部字段 observed.proposalRemoteUnresolved + payload.base_repo 回填，Proposer 按 api_registry 复核）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + feature 双查均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain semver bump 四处同步；DevGate 三项（facts-check / check-version-sync / check-dod-mapping）必过
- 可观测: proposal_observation_mismatch 与 proposal_remote_unresolved 必须各写独立 verdict/日志行，不得复用 gan_no_push_streak

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 两源为空（ability_id=null）；area 源仅命中 off-domain 项，未注入。以下为本单硬约束（task「不做」+ 根因契约），视同本 line 铁律 -->
- [独立失败因] proposal_remote_unresolved 与 proposal_observation_mismatch 必须是独立 failure_reason，禁止再折叠回 gan_no_push_streak（来源: 本单约束）
- [禁 origin 兜底] base_repo 与 repo 皆解析不到时禁止退 'origin' 跑 ls-remote，必须置 proposalRemoteUnresolved=true（来源: 本单约束）
- [不改语义] counters.js 的 after>before 与 crossCheckMismatch 计算不得改动（来源: 本单约束）
- [不加枚举] harness_attempts.failure_class 枚举不变，本单只加 initiative_runs.failure_reason 字符串值（来源: 本单约束）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line（journey e6f803f2）已完成 ability 的 golden_path；查询结果均为 planned 态，无已验收 ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 Proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 按 local_api 填真实脚本（curl localhost:5221 + psql scratch 库）。期望验收点：
# 1) POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative → psql 查
#    tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'。
# 2) kernel `run.js --dry-run` 输出的 observed.proposeBranchRn 来自 GitHub URL 而非 origin。
# 3) 回归夹具复现 run 7a8e5319：旧代码 rn=0 / 新代码 rn=1。
```

## journey_type: autonomous
## journey_type_reason: 变更全部落在 packages/brain（纯后端 orchestrator + 建单口），无 UI/agent 协议/engine 参与。
## target_environment: local_api
## target_environment_reason: Brain 内部编排逻辑，E2E 用 curl localhost:5221 + psql 对本地 scratch 库验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
