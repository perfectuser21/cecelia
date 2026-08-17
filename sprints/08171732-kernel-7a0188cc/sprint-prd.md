# Sprint PRD — 修复 gan_no_push_streak 误判（提案分支观测退 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness GAN 观测假失败，提升自动交付可信度）

## 背景

生产实证（08-15 13:38 -05）：run 7a8e5319（task ff2b0fa9）proposer 两轮都真实 push 了提案分支到 GitHub，kernel 却连续两次观测 `proposeBranchRn=0`，noPushStreak 到 2 → run 以 `gan_no_push_streak` 终态假失败；决策日志已带 `crossCheckMismatch:true` 却无人消费。根因：提案 remote 解析在 `base_repo` 为空时退到本地 `origin`（本机 clone 的 origin 指向本地路径），`git ls-remote --heads origin` 永远看不到 GitHub 上的提案分支 → rn 恒 0。7 天内 146 条 harness_initiative 任务里 29 条缺 `payload.base_repo`，同病随时复发。

## Golden Path（核心场景）

系统从 [proposer 真实 push 提案分支] → 经过 [kernel 正确解析提案 remote 并观测] → 到达 [rn≥1 不误判 / 缺 base_repo 建单即回填]

具体：
1. proposer 把提案分支 push 到 GitHub（如 `cp-harness-propose-r1-<task>-<run>-a13`）。
2. kernel 解析提案 remote：`parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)`；`repo='cecelia'` 短名经别名表映射为 `https://github.com/perfectuser21/cecelia.git`，`git ls-remote --heads` 打到该 URL，观测到提案分支 → `proposeBranchRn≥1`。
3. 两者都解析不到时**禁止退 origin**：置 `observed.proposalRemoteUnresolved=true`，derive 据此 `mark_failed` reason=`proposal_remote_unresolved`（独立 failure_reason，不再记成 gan_no_push_streak）。
4. derive 侧：`gan_no_push_streak` 仅在 `counters.crossCheckMismatch===false` 时才触发；`crossCheckMismatch===true`（成功回调数 > 观测 rn）视为观测故障，写 `verdict:proposal_observation_mismatch` 日志并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 reason=`proposal_observation_mismatch` 失败。
5. 建任务口：`createRoutedTask` 对 `coding_mutation` 任务在 payload 缺 `base_repo` 时，从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL 写入 `payload.base_repo`，短名/别名一律规范化为完整 URL。

## 边界情况

- `base_repo` 与 `repo` 皆空 → 不执行 `ls-remote origin`，`proposalRemoteUnresolved=true`，走 `proposal_remote_unresolved` 失败路径。
- kernel worktree 的 origin 指向本地路径 → 绝不因此把真 push 算成 no-push。
- 别名（`cecelia` / `zenithjoy-workspace` 短名）必须命中 repoMap 才规范化，未知短名不猜测。
- `crossCheckMismatch` 连续 3 次仍 mismatch → 才允许失败（reason=proposal_observation_mismatch），避免无限重观测。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/ground-truth.js` 提案 remote 解析（base_repo→repo 兜底、禁退 origin、unresolved 标记）。
- `packages/brain/src/orchestrator/derive.js` gan_no_push_streak 触发条件 + crossCheckMismatch 重观测 + 两个新 failure_reason 消费。
- `packages/brain/src/**/work-routing-store.js` createRoutedTask 缺 base_repo 时回填规范 URL。
- Brain 版本 semver bump 四处同步；DevGate 三项通过。
- 合同冻结测试放 `sprints/08171732-kernel-7a0188cc/tests/`（永久回归由 Generator 复制到 `packages/brain/src/**/__tests__/`）。

**不在范围内**：
- 不改 `counters.js` 的 after>before 语义；不改 proposer SKILL。
- 不复活旧 failed run（ff2b0fa9 已死，修复上线后另建 successor）。
- 不改 `harness_attempts.failure_class` 枚举（本单只加 `initiative_runs.failure_reason` 字符串值）。

## 假设

- [ASSUMPTION: `map_scope_repositories` 内含 `cecelia` → `https://github.com/perfectuser21/cecelia.git` 的 repo/aliases 映射，与 github-pr-discovery.js 的 repoMap 一致。]
- [ASSUMPTION: `initiative_runs.failure_reason` 为自由字符串列，新增 `proposal_remote_unresolved` / `proposal_observation_mismatch` 无需 migration；若涉枚举列则需同步 migration + schema↔code parity 测试。]
- [ASSUMPTION: `MAX_NO_PUSH_STREAK` 与重观测上限 3 次为现有常量，沿用不改语义。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`：提案 remote 解析兜底 + 禁退 origin + unresolved 标记。
- `packages/brain/src/orchestrator/derive.js`：gan_no_push_streak 触发条件 + crossCheckMismatch 重观测 + 新 reason 消费。
- `packages/brain/src/**/work-routing-store.js`：createRoutedTask 缺 base_repo 回填规范 URL。
- `packages/brain/package.json` 及版本同步四处：semver bump。
- `sprints/08171732-kernel-7a0188cc/tests/`：合同冻结测试落位。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空）；PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 提案观测最多重试 3 次后判失败（crossCheckMismatch 场景）
- 版本要求: Brain semver bump 四处同步；DevGate 三项通过
- 可观测: 观测故障必须写 `proposal_observation_mismatch` 日志行；新 failure_reason 独立记入 initiative_runs

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 级为空）；仅注入与本 sprint 相关者 -->
- [planner_role_branch] Provider 内禁止自行 checkout/switch，必须用服务端签发的 PLANNER_BRANCH（来源: area）
- [retry_identity] generator/kernel 基础设施重试须保持同一逻辑身份，重观测不得伪造新失败（来源: area）
- [真观测优先] 真实 push 的提案分支绝不能被算成 no-push；观测退到本地 origin 属禁止行为（本 sprint 铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；当前 line 仅 planned 态 ability，无 done/working -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl localhost:5221 + psql scratch 库）
# 期望验收点（自然语言）：
# 1. 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative，
#    psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'。
# 2. kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin（ls-remote 命令串含 github.com/perfectuser21/cecelia.git）。
# 3. 回归夹具：用 run 7a8e5319 的 decisionLog + 空 base_repo + 假 ls-remote（对 URL 返回两条
#    propose 分支、对 origin 返回空）→ 旧代码 rn=0、新代码 rn=1。
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain 后端（orchestrator/work-routing-store），无 UI/远端 agent/engine 路径，属纯后端自治。
## target_environment: local_api
## target_environment_reason: 仅 packages/brain 纯后端/kernel 逻辑，E2E 用 curl localhost:5221 + psql scratch 库本地验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
