# Sprint PRD — gan_no_push_streak 误判修复：提案分支观测退到 origin 本地 remote + 缺 base_repo 不兜底

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 内核把"真 push 的提案分支"误判成 no-push 而杀 run 的假失败）

## 背景

生产实证（08-15 13:38 -05）：run 7a8e5319（task ff2b0fa9）proposer 两轮都真实 push 了提案分支到 GitHub，kernel 却连续两次观测 proposeBranchRn=0，noPushStreak 累到 2 → run 以 `gan_no_push_streak` 终态失败。根因是提案分支的观测 remote 退化到了本机 origin：`ground-truth.js` 只在 `payload.base_repo` 命中 GitHub URL 时用 GitHub remote，否则退 `'origin'`；而 kernel 进程 cwd 的 worktree origin 指向本地路径，`git ls-remote --heads origin cp-harness-propose-*` 永远看不到 GitHub 上的真分支 → rn 恒 0。7 天内 146 条 harness_initiative 任务里 29 条缺 `payload.base_repo`，同病随时复发。决策日志已带 `crossCheckMismatch:true` 却无人消费。

## Golden Path（核心场景）

系统从 [kernel 观测提案分支] → 经过 [remote 解析 + mismatch 复核 + 建单口回填] → 到达 [真 push 被正确计数，不再假失败]

具体：
1. **提案 remote 解析**：kernel 观测提案分支前，按 `parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)` 解析 remote（repoMap 认 `cecelia`/`zenithjoy-workspace` 短名与 GitHub URL 别名）；两者都解析不到时**禁止退 `origin`**，置 `observed.proposalRemoteUnresolved=true`。
2. **mismatch 复核**：`gan_no_push_streak` 只在 `counters.crossCheckMismatch===false` 时才允许触发；`crossCheckMismatch===true`（proposer 成功回调数 > 观测 rn）视为观测故障 → 写 `verdict:proposal_observation_mismatch` 日志行并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败。`proposalRemoteUnresolved=true` 时 derive 以独立 `reason='proposal_remote_unresolved'` 失败（不得再记成 `gan_no_push_streak`）。
3. **建单口回填**：`createRoutedTask` 对 `coding_mutation` 任务，若 metadata/payload 缺 `base_repo`，从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL 写入 `payload.base_repo`；短名/别名一律规范化为完整 `https://github.com/<owner>/<repo>.git`。
4. **可观测结果**：对空 base_repo + repo='cecelia' 的任务，`ls-remote` 命令串包含 `https://github.com/perfectuser21/cecelia.git`；kernel dry-run 输出的 `observed.proposeBranchRn` 来自 GitHub URL 而非 origin。

## 边界情况

- base_repo 与 repo 皆空且无法从 map_scope 推出 → `proposalRemoteUnresolved=true`，不执行 `ls-remote origin`，derive 以 `proposal_remote_unresolved` 失败（区别于 no-push）。
- crossCheckMismatch=true 但复核 3 次仍不一致 → `proposal_observation_mismatch` 失败，noPushStreak 全程不递增。
- 短名/别名（`cecelia` / `zenithjoy-workspace`）→ 一律规范化为完整 GitHub URL 落库。

## 范围限定

**在范围内**：`ground-truth.js` 提案 remote 解析回退链；`derive.js` mismatch 复核 + 两个新 failure_reason 字符串；`work-routing-store.js` 建单口 base_repo 回填；三处对应单测 + 回归夹具；Brain semver 四处同步。
**不在范围内**：不改 `counters.js` 的 after>before 语义；不改 proposer SKILL；不复活旧 failed run（ff2b0fa9 已死，修复上线后另建 successor）；本单只加 `initiative_runs.failure_reason` 字符串值，**不改 `harness_attempts.failure_class` 枚举**（故无枚举 migration）。

## 假设

- [ASSUMPTION: `parseBaseRepo` 与 repoMap 短名别名解析能力已存在于 `github-pr-discovery.js`，本单复用不新造。]
- [ASSUMPTION: 复核上限沿用 3 次（与 MAX_NO_PUSH_STREAK 语义并列，独立计数）。]
- [ASSUMPTION: 合同冻结测试放 `sprints/08172023-kernel-f9f4cda2/tests/`；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析回退链（base_repo→repo→unresolved，禁退 origin）
- `packages/brain/src/orchestrator/derive.js`: gan_no_push_streak 门控 + proposal_observation_mismatch / proposal_remote_unresolved 两个 failure_reason
- `packages/brain/src/work-routing-store.js`: createRoutedTask 建单口 base_repo 回填
- `packages/brain/package.json` 等四处: semver bump 同步
- `sprints/08172023-kernel-f9f4cda2/tests/`: 合同冻结测试（ground-truth / derive / work-routing-store 单测 + run 7a8e5319 回归夹具）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 两源均空数组），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain semver 四处同步 + DevGate 三项通过（facts-check / check-version-sync / check-dod-mapping）
- 可观测: crossCheckMismatch 复核必须写 `verdict:proposal_observation_mismatch` 日志行；新 failure_reason 必须落 `initiative_runs.failure_reason`

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(空) + journey_feature(无 ability_id，空) + area 三源合并去重 -->
- [planner_role_branch] Planner 只在服务端签发的 PLANNER_BRANCH 上提交，不自行 checkout/switch（来源: area）
- [Brain URL authority] Fleet Generator 一切 Brain 交互以服务端注入的 Brain URL 为准，禁止硬编码/本机猜测（来源: area）
- [generator_retry_identity] Generator 基础设施重试须保持 identity 幂等，不得因重试改变任务身份（来源: area）
- [evaluator_pr_clock] Kernel 复用既有 PR 的 evaluator 校验时钟，不得因分支重建而重置观测（来源: area）
- [relay_base_repo] relay/建单点火必须把 base_repo（或 pr_url）写入 task payload，分支名带 task short（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql + kernel dry-run）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql + node src/orchestrator/run.js --dry-run）
# 期望验收点（自然语言）：
# 1. 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative
#    → psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'
# 2. kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL remote 而非 origin
# 3. 用 run 7a8e5319 的 decisionLog + 空 base_repo + 假 ls-remote（对 URL 返两条 propose 分支、对 origin 返空）
#    → 旧代码 rn=0（复现假失败）、新代码 rn=1（修复）
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain/（orchestrator + work-routing-store），纯后端内核逻辑，无 UI/agent 协议/engine 面。
## target_environment: local_api
## target_environment_reason: 验收走 curl localhost:5221 建单 + psql 查 tasks.payload + 本地 kernel dry-run，均在本地 evaluator（payload 已显式 local_api）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
