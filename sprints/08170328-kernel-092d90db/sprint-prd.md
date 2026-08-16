# Sprint PRD — 修复 gan_no_push_streak 误判（提案分支观测退到本地 origin + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness GAN 环节的假失败，提升自治管道可信度）

## 背景

生产实证（08-15 13:38 -05）：run 7a8e5319 的 proposer 两轮都真实 push 了提案分支到 GitHub，kernel 却连续两次观测 `proposeBranchRn=0`，`noPushStreak` 到 2，run 以 `gan_no_push_streak` 终态失败。根因：①`ground-truth.js` 提案 remote 解析仅认 `payload.base_repo`，缺失时退 `'origin'`（本地路径 remote），`git ls-remote origin` 永远看不到 GitHub 上的提案分支；②`derive.js` 忽略了决策日志里已带的 `crossCheckMismatch:true`（proposer 成功回调数 > 观测 rn 的观测故障信号）；③建任务口不回填 `base_repo`，7 天内 29/146 条 harness 任务缺此字段，同病随时复发。

## Golden Path（核心场景）

系统从 [kernel 观测提案分支] → 经过 [用正确的 GitHub remote 解析 + 观测故障重试] → 到达 [真实 push 被正确计入 rn，run 不再假失败]

具体：
1. kernel 对某 task 观测提案分支时，`ground-truth.js` 先用 `parseBaseRepo(payload.base_repo)`，命中失败再回退 `parseBaseRepo(payload.repo)`；`repo='cecelia'` 短名经 repoMap 解析为 `perfectuser21/cecelia` → `git ls-remote` 命令串使用 `https://github.com/perfectuser21/cecelia.git`。
2. `base_repo` 与 `repo` 皆无法解析时，**禁止退 `'origin'`**：置 `observed.proposalRemoteUnresolved=true`，`derive.js` 据此 `mark_failed` `reason='proposal_remote_unresolved'`（独立 failure_reason，不再记成 `gan_no_push_streak`）。
3. `derive.js` 的 `gan_no_push_streak` 只在 `counters.crossCheckMismatch===false` 时触发；`crossCheckMismatch===true` 视为观测故障，写 `verdict:proposal_observation_mismatch` 日志行并重新观测（不递增 `noPushStreak`），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败。
4. 建任务口（`work-routing-store.js createRoutedTask`）对 `coding_mutation` 任务在 payload 缺 `base_repo` 时，从 `map_scope_repositories` 的 repo/aliases 推出规范 clone URL 写入 `payload.base_repo`，短名/别名一律规范化为完整 URL。

## 边界情况

- `base_repo` 已是完整 URL：直接采用，不被 `repo` 兜底覆盖。
- `base_repo` 空、`repo` 也空且 `map_scope` 无匹配仓库：`proposalRemoteUnresolved=true`，不执行 `ls-remote origin`。
- 非 `coding_mutation` 任务：建任务口不回填 `base_repo`（避免误改无关任务）。
- 观测故障与真 no-push 区分：仅 `crossCheckMismatch===true` 走重试；`false` 时保持原 `gan_no_push_streak` 语义。

## 范围限定

**在范围内**：`packages/brain` 的 `orchestrator/ground-truth.js`、`orchestrator/derive.js`、`work-routing-store.js` 三处修法；`initiative_runs.failure_reason` 新增字符串值；Brain semver bump 四处同步。
**不在范围内**：不改 `counters.js` 的 `after>before` 语义；不改 proposer SKILL；不复活旧 failed run（ff2b0fa9 已死，另建 successor）；不改 `harness_attempts.failure_class` 枚举（本单只加字符串值，不加枚举 → 无 migration）。

## 假设

- [ASSUMPTION: `parseBaseRepo` 的 repoMap 已认 `cecelia`/`zenithjoy-workspace` 短名与 GitHub URL 别名（已核实 orchestrator/github-pr-discovery.js:2-4）。]
- [ASSUMPTION: `crossCheckMismatch` 已由现有 counters 逻辑填充到决策日志，本单只新增消费方，不改其产生语义。]
- [ASSUMPTION: 合同冻结测试放 `sprints/08170328-kernel-092d90db/tests/`（kernel 采集冻结产物只认此目录）；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析加 `payload.repo` 回退 + 无解不退 origin 改置 `proposalRemoteUnresolved`。
- `packages/brain/src/orchestrator/derive.js`: `gan_no_push_streak` 加 `crossCheckMismatch===false` 前置条件；新增 `proposal_observation_mismatch` / `proposal_remote_unresolved` 两个 failure_reason 分支。
- `packages/brain/src/work-routing-store.js`: `createRoutedTask` 对 coding_mutation 缺 base_repo 时从 `map_scope_repositories` 回填规范 clone URL。
- `packages/brain/package.json` 及 selfcheck/facts 四处版本同步位。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；以下取 PrepPRD 显式约束 -->
- 版本要求: Brain semver bump 四处同步（DevGate `check-version-sync.sh` 通过）
- 门禁: DevGate 三项通过（facts-check / version-sync / dod-mapping）
- 可观测: 观测故障与真 no-push 必须落成**可区分的 failure_reason**（`proposal_observation_mismatch` / `proposal_remote_unresolved`），不得混入 `gan_no_push_streak`
- schema 变更: 本单只加 `initiative_runs.failure_reason` 字符串值，不改 `failure_class` 枚举 → 无 migration；若后续涉枚举需同步 schema↔code parity 测试

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级筛选出与 harness kernel 直接相关者 -->
- [planner_role_branch] Planner workspace 必须停在服务端签发的 planner_branch，Provider 可校验但禁止 checkout/switch（来源: area）
- [generator_infrastructure_retry_identity] 基础设施失败必须重试原始服务端派发动作，不得改派身份（来源: area）
- [Fleet Generator Brain URL authority] 必须注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁止为单 Attempt 手工绕过（来源: area）
- [Kernel existing PR evaluator validation clock] validation_clock_required 默认 fail-closed，pr_url/pr_head_sha 与 GitHub 实时观测不一致一律拒绝（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql + node run.js --dry-run）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl localhost:5221 + psql + node src/orchestrator/run.js --dry-run）
# 期望验收点（自然语言）：
# 1) 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative；
#    psql 查 tasks.payload->>'base_repo' === 'https://github.com/perfectuser21/cecelia.git'。
# 2) kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin；ls-remote 命令串含 https://github.com/perfectuser21/cecelia.git。
# 3) 回归夹具：用 run 7a8e5319 的 decisionLog + 空 base_repo + 假 ls-remote（对 URL 返回两条 propose 分支、
#    对 origin 返回空）复现旧代码 rn=0 / 新代码 rn=1。
```

## journey_type: autonomous
## journey_type_reason: 本单纯改 packages/brain 后端 orchestrator/建任务口，无 UI/远端 agent/engine 触及，属自治后端。
## target_environment: local_api
## target_environment_reason: 验收仅需 curl localhost:5221 + psql scratch 库 + 本地 node run.js --dry-run，纯 Brain 后端，无浏览器/Windows/远端服务器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
