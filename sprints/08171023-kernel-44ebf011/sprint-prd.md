# Sprint PRD — 修复 gan_no_push_streak 误判（提案分支 remote 退 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类会把成功 GAN run 误杀的 kernel 观测缺陷）

## 背景

生产实证（08-15 13:38 -05）：run 7a8e5319 的 proposer 两轮都真实 push 了提案分支（GitHub 上确有 cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a10/-a13），但 kernel 连续两次观测 proposeBranchRn=0，noPushStreak 累到 2，run 以 `gan_no_push_streak` 终态失败。根因：kernel 观测提案分支时的 remote 从 GitHub URL 退化成本地 `origin`（缺 base_repo 兜底），且决策日志已带 `crossCheckMismatch:true` 却无人消费。7 天内 146 条 harness_initiative 里 29 条缺 payload.base_repo，同病随时复发。全部修法落在 `packages/brain`。

## Golden Path（核心场景）

系统从 [proposer 真实 push 提案分支] → 经过 [kernel 用正确 remote 观测 + 缺 base_repo 建单时兜底] → 到达 [观测到 rn≥1，run 不被误判为 no-push]。

具体：
1. 触发条件：proposer 向 GitHub 真实 push 了 `cp-harness-propose-*` 提案分支；kernel 进入 GAN 观测环节。
2. 系统处理：
   - ground-truth 解析提案 remote：`parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)`（`repoMap` 认 `cecelia`/`zenithjoy-workspace` 短名与 GitHub URL 别名）；两者都解析不到时**不退 origin**，置 `observed.proposalRemoteUnresolved=true`。
   - derive：`gan_no_push_streak` 仅当 `crossCheckMismatch===false` 时才允许触发；`crossCheckMismatch===true`（成功回调数 > 观测 rn）视为观测故障，写 `verdict:proposal_observation_mismatch` 日志并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败；`proposalRemoteUnresolved=true` → `reason='proposal_remote_unresolved'`。
   - work-routing-store：`createRoutedTask` 对 coding_mutation 任务在 payload 缺 base_repo 时，从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL 写入 `payload.base_repo`（短名/别名一律规范化为完整 URL）。
3. 可观测结果：对缺 base_repo、repo='cecelia' 的 task，落库 `payload.base_repo === 'https://github.com/perfectuser21/cecelia.git'`；kernel 观测 `proposeBranchRn` 来自 GitHub URL 而非 origin，真实 push 的 run 不再以 `gan_no_push_streak` 失败。

## 边界情况

- base_repo 与 repo 皆空且无 map_scope 映射 → 不执行 `ls-remote origin`，标 `proposalRemoteUnresolved=true`，走 `proposal_remote_unresolved` 独立失败原因，绝不再记成 `gan_no_push_streak`。
- crossCheckMismatch 连续 3 次仍 mismatch → 才判失败（`proposal_observation_mismatch`），避免瞬时观测抖动误杀。
- 短名与别名混用（'cecelia' vs 完整 URL）→ 统一规范化为完整 clone URL。

## 范围限定

**在范围内**：`packages/brain/src/orchestrator/ground-truth.js`、`packages/brain/src/orchestrator/derive.js`、`packages/brain/src/work-routing-store.js` 三点修复；新增 `initiative_runs.failure_reason` 字符串值（不改枚举）；Brain semver 四处同步 + DevGate。

**不在范围内**：不改 counters.js 的 after>before 语义；不改 proposer SKILL；不复活旧 failed run（ff2b0fa9 已死，另建 successor）；不新增 `harness_attempts.failure_class` 枚举。

## 假设

- [ASSUMPTION: `map_scope_repositories` 中 cecelia 的规范 clone URL 为 `https://github.com/perfectuser21/cecelia.git`（与 base_repo 现值一致）。]
- [ASSUMPTION: `crossCheckMismatch` 由既有 counters 逻辑（成功回调数 vs 观测 rn）产出，本单只消费不改语义。]
- [ASSUMPTION: 合同冻结测试必须放 `sprints/08171023-kernel-44ebf011/tests/`；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 repo 短名兜底 + 禁退 origin。
- `packages/brain/src/orchestrator/derive.js`: gan_no_push_streak 门控 + 新增两个 failure_reason 分支。
- `packages/brain/src/work-routing-store.js`: createRoutedTask 缺 base_repo 时回填规范 URL。
- `packages/brain/package.json` 及版本四处同步点: semver bump。

## Response Schema

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）；下列为 PrepPRD 显式约束 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 可观测: 观测故障必须写 `verdict:proposal_observation_mismatch` 日志行（crossCheckMismatch 不得被静默丢弃）
- 版本要求: Brain semver 四处同步；DevGate 三项通过（facts-check / check-version-sync / check-dod-mapping）
- 失败分类: 新增 `initiative_runs.failure_reason` 字符串值 `proposal_remote_unresolved` / `proposal_observation_mismatch`，不改 harness_attempts.failure_class 枚举

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [planner分支] Planner 必须使用服务端签发的 role branch，不得自行 checkout/switch（来源: area）
- [重试身份] Generator 基础设施重试须保持 attempt 身份不变，不得把基础设施失败混入 generator-fix（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl localhost:5221 + psql）
# 期望验收点（自然语言）：
# 1. 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative；
#    psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'。
# 2. kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin（proposalRemoteUnresolved=false）。
# 3. 回归夹具：用 run 7a8e5319 decisionLog + 空 base_repo + 假 ls-remote（URL 返回两条 propose 分支、
#    origin 返回空）→ 旧代码 rn=0、新代码 rn=1；crossCheckMismatch=true 时 action 非 gan_no_push_streak。
```

## journey_type: autonomous
## journey_type_reason: 全部修法落在 packages/brain（kernel 编排/后端逻辑），无 UI、无 agent bridge、无 engine 改动。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端修复，E2E 用 curl localhost:5221 + psql（scratch 库）在本地 evaluator 验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
