# Sprint PRD — 修复 gan_no_push_streak 误判：提案分支观测退回本地 origin + 缺 base_repo 任务不兜底

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（harness GAN 循环消除一类假失败，提升自治可信度）

## 背景

生产实证（08-15 13:38 -05）：run 7a8e5319（task ff2b0fa9）proposer 两轮都真实 push 了提案分支到 GitHub，kernel 却连续两次观测 `proposeBranchRn=0`，`noPushStreak` 到 2 → run 以 `gan_no_push_streak` 终态假失败。根因是 kernel 观测提案分支时把 remote 退回了本地 `origin`：`ground-truth.js:736` 用 `parseBaseRepo(taskPayload.base_repo)`，task ff2b0fa9 的 `payload.base_repo` 为空（`payload.repo='cecelia'` 短名未被拿来兜底）→ 走 `'origin'`；而 kernel 进程 cwd 的 worktree origin 指向本地路径，`git ls-remote --heads origin cp-harness-propose-*` 永远看不到 GitHub 上的提案分支 → rn 恒 0。7 天内 146 条 harness_initiative 任务中 29 条缺 `payload.base_repo`，同病随时复发。决策日志 hop10/13 已带 `crossCheckMismatch:true` 却无人消费。

## Golden Path（核心场景）

系统从 [proposer 真实 push 提案分支] → 经过 [kernel 用正确 remote 观测 + 缺 base_repo 建单时回填] → 到达 [不再把真 push 误判为 no-push]

具体：
1. **触发**：一条 `harness_initiative` 任务 `payload.base_repo` 为空、`payload.repo='cecelia'`，proposer 已真实 push `cp-harness-propose-*` 分支到 GitHub。
2. **系统处理 A（提案 remote 解析）**：`ground-truth.js` 解析提案 remote 时 `parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)`——短名 `cecelia` 经 repoMap 别名解析出 `https://github.com/perfectuser21/cecelia.git`；`git ls-remote --heads` 对该 URL 执行 → 观测到真实提案分支。两者都解析不到时**禁止退 `origin`**，置 `observed.proposalRemoteUnresolved=true`。
3. **系统处理 B（derive 判定）**：`gan_no_push_streak` 只在 `counters.crossCheckMismatch===false` 时才允许触发；`crossCheckMismatch===true`（proposer 成功回调数 > 观测 rn）视为观测故障——写 `verdict:proposal_observation_mismatch` 日志行并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败；`proposalRemoteUnresolved=true` 则以 `reason='proposal_remote_unresolved'` 失败（独立 failure_reason，不得再记成 `gan_no_push_streak`）。
4. **系统处理 C（建单口回填）**：`work-routing-store.js` 的 `createRoutedTask` 对 `coding_mutation` 任务在 metadata/payload 缺 `base_repo` 时，从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL 写入 `payload.base_repo`；短名/别名一律规范化为完整 `https://github.com/<owner>/<repo>.git`。
5. **可观测出口**：同一场景下真 push 不再被算作 no-push；`observed.proposeBranchRn` 来自 GitHub URL 而非 origin；落库任务 `payload.base_repo` 恒为完整 URL。

## 边界情况

- `base_repo` 与 `repo` 皆空 → 不执行 `ls-remote origin`，`proposalRemoteUnresolved=true`，derive 走 `proposal_remote_unresolved`。
- `crossCheckMismatch=true` 且 `noPushStreak>=MAX_NO_PUSH_STREAK` → action 不得是 `gan_no_push_streak`。
- 连续 3 次仍 mismatch → 才允许以 `proposal_observation_mismatch` 失败。
- 短名/别名（`cecelia`/`zenithjoy-workspace`）→ 一律规范化为完整 GitHub URL 再落库。

## 范围限定

**在范围内**：`ground-truth.js` 提案 remote 解析 + unresolved 标记；`derive.js` 的 `gan_no_push_streak` 门控与 mismatch 重观测/失败分类；`work-routing-store.js` 建单口 `base_repo` 回填；新增 `initiative_runs.failure_reason` 字符串值（`proposal_remote_unresolved` / `proposal_observation_mismatch`）；回归夹具复现 run 7a8e5319 旧 rn=0 / 新 rn=1。

**不在范围内**：不改 `counters.js` 的 `after>before` 语义；不改 proposer SKILL；不复活旧 failed run（ff2b0fa9 已死，修复上线后另建 successor）；不改 `harness_attempts.failure_class` 枚举（本单只加 `initiative_runs.failure_reason` 字符串值，不需 enum migration）。

## 假设

- [ASSUMPTION: `github-pr-discovery.js` 的 `repoMap` 已认 `cecelia` / `zenithjoy-workspace` 短名与其 GitHub URL 别名，`ground-truth.js` 复用同一解析入口。]
- [ASSUMPTION: `MAX_NO_PUSH_STREAK` 与 mismatch 重观测上限 3 为独立计数器，互不递增污染。]
- [ASSUMPTION: 合同冻结测试必须放在 `sprints/08180154-kernel-6bd08539/tests/`（kernel 采集冻结产物只认此目录）；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 `payload.repo` 兜底 + `proposalRemoteUnresolved` 标记（当前 :736 起）
- `packages/brain/src/orchestrator/derive.js`: `gan_no_push_streak` 门控 + mismatch 重观测/独立失败分类
- `packages/brain/src/work-routing-store.js`: `createRoutedTask` 缺 `base_repo` 时回填规范 URL
- `packages/brain/src/orchestrator/github-pr-discovery.js`: repoMap 别名解析（复用/只读参照）
- `packages/brain/src/orchestrator/run.js`: `--dry-run` 输出 `observed.proposeBranchRn` 用于 E2E 验证
- `packages/brain/package.json` 等四处: semver bump 同步

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + journey_feature 两源均空）；以下为 PrepPRD 显式约束 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: mismatch 重观测上限 = 3 次（连续 3 次仍 mismatch 才失败）
- 版本要求: Brain semver 四处同步；DevGate 三项（facts-check / check-version-sync / check-dod-mapping）通过
- 可观测: 失败必须记独立 `failure_reason`（`proposal_remote_unresolved` / `proposal_observation_mismatch`），不得折叠成 `gan_no_push_streak`；`crossCheckMismatch` 观测故障必须写 `proposal_observation_mismatch` 日志行

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源空）；仅注入与本 harness-kernel sprint 相关项，area 内 Android/部署类 capture-triage 学习条与本单无关已略 -->
- [planner分支] planner 只用服务端签发的 PLANNER_BRANCH，禁自行 checkout/switch（来源: area/planner_role_branch）
- [GeneratorBrainURL] Fleet Generator 的 Brain URL 以服务端下发为权威，不本机猜测（来源: area/Fleet Generator Brain URL authority）
- [重试身份] generator 基础设施重试必须保持同一 identity，不裂变新单（来源: area/generator_infrastructure_retry_identity）
- [Kernel时钟] Kernel 对既有 PR 采用 evaluator validation 时钟，不自造判定基准（来源: area/Kernel existing PR evaluator validation clock adoption）
- [语义同源] 同一语义（如 base_repo 解析/未解析）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [模板核对] Proposer 复用历史合同模板（尤其 E2E 断言）前必须核对本次真实派发/执行历史，不假设与先例路径相同（来源: area）
- [红commit] Red commit 必须只 `git add` 精确路径（*.test.ts/*.test.js），禁止 `git add .`（来源: area）
- [禁自merge] generator 禁止自行 merge PR，merge 权归 controller（来源: area）
- [会话独享] evaluator 临时脚本必须落会话独享路径（含 session id），禁共享 /tmp 固定文件名（来源: area）
- [系统] 单 slot 串行任务，并行只许跨 slot；禁止写死环境假设值；真环境验证才算 done；测试默认多租户；凭据安全；日志脱敏；端点鉴权；租户隔离（来源: area/[系统]）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + psql + `node src/orchestrator/run.js --dry-run`），写进 contract-draft.md 的 `## E2E 验收`。

```bash
# 占位：proposer 将填入真实 local_api 脚本
# 期望验收点（自然语言）：
# 1) 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative
#    → psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'
# 2) kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的
#    observed.proposeBranchRn 来自 GitHub URL 解析而非 origin
# 3) 回归夹具（run 7a8e5319 decisionLog + 空 base_repo + 假 ls-remote：
#    对 URL 返两条 propose 分支、对 origin 返空）→ 旧代码 rn=0、新代码 rn=1
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端（orchestrator kernel + 建单口），无 UI/远端 agent/engine 路径线索，命中 brain→autonomous。
## target_environment: local_api
## target_environment_reason: 仅 packages/brain 纯后端，E2E 走本地 evaluator（curl localhost:5221 + psql scratch 库 + node run.js --dry-run），与 payload.target_environment 一致。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
