# Sprint PRD — 修复 gan_no_push_streak 误判（提案分支观测退到本地 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（Harness kernel 观测正确性修复，消除 GAN 假失败）

## 背景

生产实证（08-15 13:38 -05）run 7a8e5319 的 proposer 两轮都真实 push 了提案分支到 GitHub，
kernel 却连续两次观测 proposeBranchRn=0，noPushStreak 到 2 → run 以 `gan_no_push_streak` 终态失败。
根因有三：(1) `ground-truth.js` 解析提案 remote 时，仅 `payload.base_repo` 命中 GitHub 模式才用 GitHub URL，
否则退 `'origin'`；(2) kernel 进程 cwd 的 workspace 其 `origin` 指向本地路径，`git ls-remote origin` 永远看不到
GitHub 上的提案分支 → rn 恒 0 → 真 push 被算 no-push；(3) 决策日志已带 `crossCheckMismatch:true` 却无人消费。
7 天内 146 条 harness_initiative 有 29 条缺 `payload.base_repo`，同病随时复发。

## Golden Path（核心场景）

系统从 [提案分支已推到 GitHub] → 经过 [kernel 用权威 GitHub URL 观测 + 建单口回填 base_repo] → 到达 [rn 反映真实 push，不再误判]

具体：
1. **触发**：一条 harness_initiative 任务（`payload.base_repo` 可能为空，仅有 `payload.repo='cecelia'` 短名）进入 GAN，proposer 真实 push 了提案分支到 GitHub。
2. **系统处理 A（remote 解析）**：`ground-truth.js` 观测提案分支时，remote 解析优先级为 `parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)`；短名 `cecelia` 经 repoMap 别名规范化为 `https://github.com/perfectuser21/cecelia.git`。两者都解析不到时**禁止退 `origin`**，改置 `observed.proposalRemoteUnresolved=true`。
3. **系统处理 B（误判闸）**：`derive.js` 只在 `counters.crossCheckMismatch===false` 时才允许触发 `gan_no_push_streak`；`crossCheckMismatch===true`（成功回调数 > 观测 rn）视为观测故障，写 `verdict:proposal_observation_mismatch` 日志行并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败；`proposalRemoteUnresolved===true` → `reason='proposal_remote_unresolved'`。
4. **系统处理 C（建单口回填）**：`work-routing-store.js` 的 `createRoutedTask` 对 `coding_mutation` 任务，在 payload/metadata 缺 `base_repo` 时，从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL 写入 `payload.base_repo`。
5. **可观测结果**：真实 push 的提案分支被观测到（rn≥1），run 不再以 `gan_no_push_streak` 假失败；缺 base_repo 任务落库即带完整 URL。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- `payload.base_repo` 空 + `payload.repo` 空 → 不执行 `ls-remote origin`，`proposalRemoteUnresolved=true`，独立 failure_reason，**不得**再记成 `gan_no_push_streak`。
- 短名 / 别名（`cecelia` / `zenithjoy-workspace`）→ 一律规范化为完整 GitHub URL。
- `crossCheckMismatch=true` 连续 <3 次 → 重新观测，noPushStreak 不递增；满 3 次才失败。
- 已死 run（ff2b0fa9）不复活，修复上线后另建 successor。

## 范围限定

**在范围内**：`packages/brain` 内三处修改（ground-truth.js remote 解析 + derive.js 误判闸 + work-routing-store.js 建单回填）；新增 `initiative_runs.failure_reason` 字符串值 `proposal_remote_unresolved` / `proposal_observation_mismatch`；Brain semver bump 四处同步；DevGate 三项通过。

**不在范围内**：不改 `counters.js` 的 after>before 语义；不改 proposer SKILL；不复活旧 failed run；不改 `harness_attempts.failure_class` 枚举（本单只加字符串值，不动枚举 migration）。

## 假设

- [ASSUMPTION: repoMap（`work-routing-store.js` / `github-pr-discovery` 语义中的别名表）已认 `cecelia` → `perfectuser21/cecelia` 别名；proposer 直接复用，无需新建映射。]
- [ASSUMPTION: 合同冻结测试文件必须落在 `sprints/08170843-kernel-0a8f1e2f/tests/`；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`。]
- [ASSUMPTION: 前一单 1bc5cd92 / f9f943fc 的合同与测试内容可原样复用，仅需修正测试文件落位。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 `payload.repo` 兜底 + 双空时置 `proposalRemoteUnresolved`。
- `packages/brain/src/orchestrator/derive.js`: `gan_no_push_streak` 加 `crossCheckMismatch===false` 前置条件 + 新增两个 failure_reason 分支。
- `packages/brain/src/work-routing-store.js`: `createRoutedTask` 对 coding_mutation 缺 base_repo 时从 map_scope_repositories 回填规范 URL。
- `packages/brain/package.json`: semver bump（四处同步）。
- `sprints/08170843-kernel-0a8f1e2f/tests/`: 合同冻结测试（Proposer 产出）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ 任务描述显式约束 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain semver 四处同步（package.json / DEFINITION.md / selfcheck EXPECTED_SCHEMA_VERSION 等），DevGate 三项通过
- 可观测: 观测故障与 remote 未解析必须写**独立** failure_reason（`proposal_observation_mismatch` / `proposal_remote_unresolved`），不得吞进 `gan_no_push_streak`

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 源为空，statement 字段为 null，标签取自 topic）-->
- [Brain URL 权威] kernel/Generator 观测提案分支必须走 Brain 授权的 GitHub URL，禁止退回本地 origin（来源: area）
- [planner role branch] planner 使用服务端签发的 PLANNER_BRANCH，不自行 checkout/switch（来源: area）
- [failure 归因] infrastructure/观测故障不得记成 GAN 逻辑失败终态（来源: area · generator_infrastructure_retry_identity）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql+node dry-run。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl + psql + node run.js --dry-run）
# 期望验收点（自然语言）：
# 1) 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative；
#    psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'。
# 2) kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin（回归夹具：假 ls-remote 对 URL 返两条 propose 分支/对 origin 返空 → 旧码 rn=0、新码 rn=1）。
# 3) crossCheckMismatch=true 且 noPushStreak>=MAX_NO_PUSH_STREAK → action 不是 gan_no_push_streak。
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain（harness kernel 编排/观测逻辑），纯后端自治流程，无 UI/agent 协议。
## target_environment: local_api
## target_environment_reason: 验收走本地 evaluator：curl localhost:5221 + psql scratch 库 + node src/orchestrator/run.js --dry-run，无浏览器/远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定，ability_id 为空）
