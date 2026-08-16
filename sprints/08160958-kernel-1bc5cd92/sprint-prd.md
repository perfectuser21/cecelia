# Sprint PRD — gan_no_push_streak 误判修复（提案分支观测退 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 Harness GAN 假失败，提升 run 可信度）

## 背景

生产实证 08-15：run 7a8e5319（task ff2b0fa9）proposer 两轮都真实 push 了提案分支（GitHub 上确有 cp-harness-propose-r1-...-a10/-a13），kernel 却连续两次观测 proposeBranchRn=0，noPushStreak 到 2 → run 以 gan_no_push_streak 假失败。根因：① ground-truth.js 提案 remote 在 payload.base_repo 为空时退回本地 'origin'（payload.repo='cecelia' 短名未被拿来兜底）；② kernel worktree 的 origin 指向本地路径，`git ls-remote --heads origin` 看不到 GitHub 提案分支 → rn 恒 0；③ 决策日志已带 crossCheckMismatch:true 却无人消费。7 天内 146 条 harness_initiative 有 29 条缺 base_repo，同病随时复发。

## Golden Path（核心场景）

系统从 [proposer 真实 push 提案分支] → 经过 [kernel 用正确 remote 观测 + derive 尊重 crossCheckMismatch] → 到达 [proposeBranchRn 反映 GitHub 真实分支，不再假 gan_no_push_streak]

具体：
1. proposer 成功 push 提案分支到 GitHub（回调数 > 0）
2. ground-truth.js 解析提案 remote：`parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)`；两者都解析不到时**禁止退 'origin'**，置 `observed.proposalRemoteUnresolved=true`
3. `git ls-remote` 对 GitHub URL（如 https://github.com/perfectuser21/cecelia.git）执行 → rn 反映真实提案分支数（≥1）
4. derive.js：gan_no_push_streak 只在 `crossCheckMismatch===false` 时触发；`crossCheckMismatch===true`（回调数 > 观测 rn）视为观测故障 → 写 `verdict:proposal_observation_mismatch` 日志并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败
5. `proposalRemoteUnresolved===true` → derive mark_failed，独立 `reason='proposal_remote_unresolved'`（不得再记成 gan_no_push_streak）
6. 建任务口（work-routing-store.js createRoutedTask）对 coding_mutation 任务缺 base_repo 时，从 map_scope_repositories 的 repo/aliases 推出规范 clone URL 写入 payload.base_repo（短名/别名一律规范化为完整 URL）

## 边界情况

- base_repo 与 repo 皆空 → 不执行 `ls-remote origin`，proposalRemoteUnresolved=true，走独立 failure_reason
- crossCheckMismatch=true 且 noPushStreak>=MAX_NO_PUSH_STREAK → action 不得是 gan_no_push_streak
- 连续 3 次观测仍 mismatch → 才允许以 proposal_observation_mismatch 终态失败
- 短名 'cecelia' / 别名（github-pr-discovery.js repoMap）→ 规范化为 https://github.com/perfectuser21/cecelia.git

## 范围限定

**在范围内**：
- packages/brain/src/orchestrator/ground-truth.js 提案 remote 解析（base_repo→repo 兜底，禁退 origin）
- packages/brain/src/orchestrator/derive.js（crossCheckMismatch 门控 + 两个独立 failure_reason）
- packages/brain/src/work-routing-store.js createRoutedTask（缺 base_repo 回填规范 URL）
- 回归夹具复现 run 7a8e5319（旧代码 rn=0 / 新代码 rn=1）
- 仅新增 initiative_runs.failure_reason 字符串值；Brain semver bump 四处同步 + DevGate 三项

**不在范围内**：
- 不改 counters.js 的 after>before 语义
- 不改 proposer SKILL
- 不复活旧 failed run（ff2b0fa9 已死，修复上线后另建 successor）
- 不改 harness_attempts.failure_class 枚举（本单只加字符串值，故不需 migration）

## 假设

- [ASSUMPTION: MAX_NO_PUSH_STREAK 常量已存在于 derive.js，本单复用不新增]
- [ASSUMPTION: github-pr-discovery.js 已导出可复用的 repoMap/parseBaseRepo 别名解析，ground-truth.js 与 work-routing-store.js 直接引用]
- [ASSUMPTION: proposalRemoteUnresolved 为 observed 对象新增布尔字段，counters/derive 消费但不改 counters after>before 语义]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 repo 兜底 + 禁退 origin + proposalRemoteUnresolved 字段
- `packages/brain/src/orchestrator/derive.js`: gan_no_push_streak 门控 crossCheckMismatch + proposal_remote_unresolved/proposal_observation_mismatch 两个 failure_reason
- `packages/brain/src/work-routing-store.js`: createRoutedTask 缺 base_repo 时回填规范 clone URL
- `packages/brain/src/orchestrator/github-pr-discovery.js`: 若 parseBaseRepo/repoMap 需导出以复用（只读复用，不改语义）
- `packages/brain/package.json` 及版本四处同步点: semver bump

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + feature 双源均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain semver bump 四处同步（package.json / DEFINITION.md / selfcheck EXPECTED_SCHEMA_VERSION 等），DevGate 三项通过
- 可观测: proposal_observation_mismatch 与 proposal_remote_unresolved 必须各自写独立 verdict/failure_reason 日志行，不得复用 gan_no_push_streak 标签

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step + journey_feature 两源为空） -->
- [generator_retry_identity] Generator 基础设施失败必须重试原始服务端派发动作（首次→generator，fix→generator-fix）（来源: area）
- [planner_role_branch] Planner workspace 必须停在服务端签发的 planner_branch，Provider 可校验但不得 checkout/switch（来源: area）
- [fleet_brain_url_authority] Dispatcher 与 Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁止为单 Attempt 手工绕过（来源: area）
- [evaluator_validation_clock] validation_clock 默认 fail-closed；仅 hotfix 且 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时建一次共享 clock（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 已完成 ability 的 golden_path -->
（本 line 暂无已验收历史：该 journey 现有 ability 均为 planned 态，无 done/working 行为可回退）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将填入真实 local_api 脚本（curl localhost:5221 + psql scratch 库）
# 期望验收点（自然语言）：
# 1. 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative；
#    psql 查 tasks.payload->>'base_repo' 等于 https://github.com/perfectuser21/cecelia.git
# 2. kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin（remote 串含 github.com/perfectuser21/cecelia.git）
# 3. 回归夹具：run 7a8e5319 decisionLog + 空 base_repo + 假 ls-remote（URL 返两条 propose 分支、origin 返空）
#    → 旧代码 rn=0、新代码 rn=1
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端改动（orchestrator + 建任务口），无 UI/agent 协议/engine 介入
## target_environment: local_api
## target_environment_reason: 仅 packages/brain 与纯 API 验证，E2E 走本地 evaluator（curl localhost:5221 + psql scratch 库）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定；task.ability_id 为 null，无 golden_path step）
