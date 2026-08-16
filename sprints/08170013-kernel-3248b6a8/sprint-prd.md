# Sprint PRD — gan_no_push_streak 误判修复：提案分支观测退 origin + 缺 base_repo 不兜底

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness GAN 环节一类假失败终态，提升自治管道可信度）

## 背景

生产实证（08-15 13:38 -05）run 7a8e5319（task ff2b0fa9）proposer 两轮都真实 push 了提案分支到 GitHub，
kernel 却连续两次观测 proposeBranchRn=0，noPushStreak 到 2 → run 以 `gan_no_push_streak` 终态假失败；
决策日志 hop10/13 已带 `crossCheckMismatch:true` 却无人消费。根因是 `ground-truth.js` 在 `payload.base_repo`
为空时把提案 remote 退回本地 `origin`（kernel worktree 的 origin 指向本机路径），`git ls-remote origin` 永远
看不到 GitHub 上的提案分支 → rn 恒 0；且 7 天内 146 条 harness_initiative 任务里 29 条缺 `payload.base_repo`，同病随时复发。

## Golden Path（核心场景）

系统（harness kernel）从 [建任务口] → 经过 [提案分支观测] → 到达 [不再误判 no-push]

具体：
1. Brain 派发一条 harness_initiative（coding_mutation）任务，payload 只带 `repo='cecelia'`、无 `base_repo` → `createRoutedTask` 落库时从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL，回填 `payload.base_repo` = `https://github.com/perfectuser21/cecelia.git`。
2. GAN 阶段 proposer 真实 push 提案分支（如 `cp-harness-propose-r1-<task8>-r<run8>-a10`）到 GitHub。
3. kernel `ground-truth.js` 观测提案分支：优先 `parseBaseRepo(payload.base_repo)`，缺则 fallback `parseBaseRepo(payload.repo)`（短名 `cecelia`/`zenithjoy-workspace` 别名认作 GitHub URL），拼出 `git ls-remote --heads "https://github.com/perfectuser21/cecelia.git" ...`；两者都解析不到时 **禁止退 `origin`**，置 `observed.proposalRemoteUnresolved=true`。
4. `derive.js` 判定：`crossCheckMismatch===true`（proposer 成功回调数 > 观测 rn）视为观测故障 → 写 `proposal_observation_mismatch` 日志行并重新观测、**不递增** noPushStreak，连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败；`proposalRemoteUnresolved===true` → `reason='proposal_remote_unresolved'`；只有 `crossCheckMismatch===false` 时 `gan_no_push_streak` 才允许触发。
5. 出口：真实 push 的提案分支被正确观测到 `proposeBranchRn>=1`，run 不再以 `gan_no_push_streak` 假失败。

## 边界情况

- `base_repo` 与 `repo` 皆空 → 不执行 `ls-remote origin`，`proposalRemoteUnresolved=true`，独立失败原因，不得记成 `gan_no_push_streak`。
- 短名/别名（`cecelia`、`zenithjoy-workspace`）→ 规范化为完整 `https://github.com/<owner>/<repo>.git`。
- `crossCheckMismatch=true` 且 `noPushStreak>=MAX_NO_PUSH_STREAK`（=2）→ action 仍不得是 `gan_no_push_streak`；观测故障连续 3 次才终态失败，避免单次网络抖动即杀 run。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/ground-truth.js` 提案 remote 解析（fallback + 禁退 origin + unresolved 标记）
- `packages/brain/src/orchestrator/derive.js` no-push 判定门（crossCheckMismatch 消费 + 两个新 failure_reason）
- `packages/brain/src/work-routing-store.js` `createRoutedTask` 缺 base_repo 回填
- Brain 版本 semver bump 四处同步；DevGate 三项通过
- 冻结测试放 `sprints/08170013-kernel-3248b6a8/tests/`（永久回归由 Generator 复制到 `packages/brain/src/**/__tests__/`）

**不在范围内**：
- 不改 `counters.js` 的 after>before 语义
- 不改 proposer SKILL
- 不复活旧 failed run（ff2b0fa9 已死，修复上线后另建 successor）
- 只加 `initiative_runs.failure_reason` 字符串值，**不改 `harness_attempts.failure_class` 枚举**（无 migration）

## 假设

- [ASSUMPTION: `payload.thin_prd` 为空，Scope 以 task 标题/描述的修法 A/B/C + 验收断言为产品法律。]
- [ASSUMPTION: `parseBaseRepo` 与 `github-pr-discovery.js` 的 repoMap 已能把短名 `cecelia` 解析到 `perfectuser21/cecelia`；本单复用其解析能力。]
- [ASSUMPTION: `map_scope_repositories` 表含 repo/aliases → clone URL 的可推导映射，供 createRoutedTask 回填。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 fallback + unresolved 标记，禁退 origin
- `packages/brain/src/orchestrator/derive.js`: gan_no_push_streak 触发门加 crossCheckMismatch 守卫 + 两个新 failure_reason
- `packages/brain/src/work-routing-store.js`: `createRoutedTask` 对缺 base_repo 的 coding_mutation 任务回填规范 clone URL
- `packages/brain/package.json` + 版本四处同步点: semver bump
- `sprints/08170013-kernel-3248b6a8/tests/`: 冻结回归测试（单测 3 组 + 回归夹具）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ 本 sprint 硬约束 -->
- 超时/延迟 + 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain semver bump 四处同步；DevGate 三项（facts-check / check-version-sync / check-dod-mapping）必须通过
- 可观测: 观测故障必须写 `proposal_observation_mismatch` 决策日志行；新失败原因 `proposal_remote_unresolved` / `proposal_observation_mismatch` 独立于 `gan_no_push_streak`

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 line ability_id 为空，step/feature 级为空） -->
- [Fleet Generator Brain URL authority] Fleet 侧观测/派发以 Brain 权威 URL 为准，不得退本地路径（来源: area）
- [Kernel PR evaluator validation clock] kernel 对既有 PR 采用 evaluator 校验时钟，不得自造时钟漂移（来源: area）
- [planner_role_branch] Planner 只在服务端签发的 PLANNER_BRANCH 上作业，不自行 checkout/switch（来源: area）
- [generator_infrastructure_retry_identity] 基础设施重试须保持身份一致，不改 run/attempt 身份（来源: area）
- [vitest include 语义] 合同验证命令须实跑确认 exit code：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 0，冻结测试须落在被采集/被跑的范围内（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey 现有 ability 均为 planned 态 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql + node run.js）。

```bash
# 占位：proposer 将填入真实 local_api 脚本
# 期望验收点（自然语言）：
# 1) 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative；
#    psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'
# 2) kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin
# 单测断言（proposer 翻成 [BEHAVIOR]）：
#  - ground-truth：base_repo 空 + repo='cecelia' → ls-remote 命令串含 https://github.com/perfectuser21/cecelia.git；
#    base_repo 与 repo 皆空 → 不执行 ls-remote origin，observed.proposalRemoteUnresolved===true
#  - derive：crossCheckMismatch=true 且 noPushStreak>=MAX_NO_PUSH_STREAK → action 不是 gan_no_push_streak；
#    proposalRemoteUnresolved=true → reason='proposal_remote_unresolved'
#  - work-routing-store：POST /tasks 不带 base_repo、payload.repo='cecelia' → 落库 payload.base_repo 为完整 URL
#  - 回归夹具：用 run 7a8e5319 的 decisionLog + 空 base_repo + 假 ls-remote（URL 返两条 propose 分支、origin 返空）
#    → 旧代码 rn=0 / 新代码 rn=1
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain orchestrator 后端逻辑（ground-truth/derive/work-routing-store），无 UI/agent 协议/engine hook。
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端，E2E 用本地 evaluator curl localhost:5221 + psql + node src/orchestrator/run.js。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
