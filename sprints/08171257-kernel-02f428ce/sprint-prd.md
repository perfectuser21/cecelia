# Sprint PRD — 修复 gan_no_push_streak 误判（提案分支观测退到 origin 本地 remote + 缺 base_repo 不兜底）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness GAN 循环的假失败终态，提升自主开发管线可信度）

## 背景

生产实证（08-15 13:38 -05）：run 7a8e5319（task ff2b0fa9）Proposer 两轮都真实 push 了提案分支（GitHub 上存在 cp-harness-propose-r1-ff2b0fa9-r7a8e5319-a10 / -a13），但 kernel 连续两次观测 proposeBranchRn=0，noPushStreak 到 2，run 以 `gan_no_push_streak` 假失败终态。决策日志 hop10/13 已带 `crossCheckMismatch:true` 却无人消费。根因：缺 payload.base_repo 时提案 remote 退回本地 `origin`（指向本机路径），`git ls-remote origin` 永远看不到 GitHub 上的提案分支 → rn 恒 0。7 天内 146 条 harness_initiative 有 29 条缺 base_repo，同病随时复发。

## Golden Path（核心场景）

系统（kernel）从 [观测提案分支] → 经过 [解析提案 remote + 交叉核对] → 到达 [正确的失败原因或继续 GAN]。

具体：
1. kernel 在 GAN 循环中调用 ground-truth 观测提案分支数（proposeBranchRn）。缺 payload.base_repo 时用 payload.repo 短名（'cecelia'/'zenithjoy-workspace' 别名）兜底解析为规范 GitHub clone URL；两者都解析不到时**禁止退 'origin'**，置 `observed.proposalRemoteUnresolved=true`。
2. derive 消费观测：`gan_no_push_streak` 只允许在 `counters.crossCheckMismatch===false` 时触发。`crossCheckMismatch===true`（Proposer 成功回调数 > 观测 rn）视为观测故障 → 写 `verdict:proposal_observation_mismatch` 日志并重新观测（不递增 noPushStreak），连续 3 次仍 mismatch 才以 `reason='proposal_observation_mismatch'` 失败；`proposalRemoteUnresolved=true` 则以独立 `reason='proposal_remote_unresolved'` 失败。
3. 建任务口回填：createRoutedTask 对 coding_mutation 任务在 payload 缺 base_repo 时，从 map_scope_repositories 的 repo/aliases 推出规范 clone URL 写入 payload.base_repo（短名/别名一律规范化为完整 URL）。
4. 可观测结果：真 push 的提案分支被正确计入 rn（rn≥1，不再假 no-push）；缺 base_repo 的新任务落库即带完整 URL。

## 边界情况

- base_repo 与 repo 皆空且 map 无法解析 → `proposalRemoteUnresolved=true`，独立失败原因，不得再记成 gan_no_push_streak。
- crossCheckMismatch 连续 3 次仍不一致 → 才允许以 proposal_observation_mismatch 失败（前 2 次只重新观测）。
- 已死的 run ff2b0fa9 不复活；修复上线后另建 successor。

## 范围限定

**在范围内**：packages/brain 三处修改 —
- `packages/brain/src/orchestrator/ground-truth.js`（提案 remote 解析 + proposalRemoteUnresolved）
- `packages/brain/src/orchestrator/derive.js`（crossCheckMismatch 门控 + 两个新 failure_reason）
- `packages/brain/src/work-routing-store.js`（createRoutedTask base_repo 回填）
- initiative_runs.failure_reason 新增字符串值（proposal_remote_unresolved / proposal_observation_mismatch）；Brain semver 四处同步 + DevGate 三项。

**不在范围内**：不改 counters.js 的 after>before 语义；不改 Proposer SKILL；不复活旧 failed run；不改 harness_attempts.failure_class 枚举（本单只加字符串值，不动枚举 migration）。

## 假设

- [ASSUMPTION: parseBaseRepo/repoMap 已认 'cecelia' 与 GitHub URL 别名互认（沿用 github-pr-discovery.js repoMap）]。
- [ASSUMPTION: MAX_NO_PUSH_STREAK 保持 2 不变；新增的 mismatch 重试上限为 3]。
- [ASSUMPTION: 合同冻结测试放 sprints/08171257-kernel-02f428ce/tests/，永久回归测试由 Generator 复制到 packages/brain/src/**/__tests__/]。

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 提案 remote 解析改为 base_repo→repo 兜底 + 禁退 origin（约 736-742 行）
- `packages/brain/src/orchestrator/derive.js`: gan_no_push_streak 门控 crossCheckMismatch + 新 failure_reason（约 948-949 行）
- `packages/brain/src/work-routing-store.js`: createRoutedTask 回填 base_repo（约 153+ 行）
- `packages/brain/package.json` 等 4 处: semver bump 同步

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 Proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl + psql）
# 期望验收点（自然语言）：
# 1. 对 scratch 库 POST 一条不带 base_repo、payload.repo='cecelia' 的 harness_initiative，
#    psql 查 tasks.payload->>'base_repo' == 'https://github.com/perfectuser21/cecelia.git'。
# 2. kernel `node src/orchestrator/run.js --dry-run` 对该 task 输出的 observed.proposeBranchRn
#    来自 GitHub URL 而非 origin（ls-remote 命令串含 github.com/perfectuser21/cecelia.git）。
# 3. 回归夹具：用 run 7a8e5319 的 decisionLog + 空 base_repo + 假 ls-remote（URL 返两条 propose 分支、
#    origin 返空）复现旧代码 rn=0 / 新代码 rn=1。
```

## NFR 约束

<!-- 来源: decisions category=nfr 空；PrepPRD 显式约束 -->
- 版本要求: Brain semver bump 四处同步（package.json 等），DevGate 三项（facts-check / check-version-sync / check-dod-mapping）全过
- 可观测: 新增 failure_reason（proposal_remote_unresolved / proposal_observation_mismatch）必须写入 initiative_runs 日志行，与 gan_no_push_streak 严格区分
- 数据一致: failure_reason 仅加 initiative_runs 字符串值，不触及 harness_attempts.failure_class 枚举（免 migration）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（harness kernel 相关） -->
- [planner分支] Planner workspace 必须停在服务端签发的 planner_branch，Provider 不得 checkout/switch（来源: area）
- [基础设施重试身份] Generator 基础设施失败必须重派原始服务端动作：generator 重派 generator，generator-fix 重派 generator-fix（来源: area）
- [Brain URL 权威] Dispatcher 与 Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁止单 Attempt 手工绕过（来源: area）
- [Evaluator 时钟] validation_clock_required 默认 fail-closed；仅 hotfix 且 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时建一次共享 clock，缺失/不一致一律拒绝（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 kernel 编排逻辑（ground-truth/derive/work-routing-store），无 UI/远端 agent/engine hook 触及
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；验收走本地 evaluator curl localhost:5221 + psql
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
