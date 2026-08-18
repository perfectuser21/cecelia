# Sprint PRD — 修复 gan_no_push_streak 误判：提案分支观测退到 origin 本地 remote + 缺 base_repo 不兜底

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：+0.5%（消除 harness GAN 环误判，避免真提案被判 no-push 而 mark_failed）

## 背景

issue_ref：run 7a8e5319 / task ff2b0fa9 gan_no_push_streak。
ground-truth 观测提案分支时（`packages/brain/src/orchestrator/ground-truth.js`），
`taskRepo = parseBaseRepo(taskPayload.base_repo)` 只读 `base_repo`；当任务 payload 缺 `base_repo`
（或其值无法解析为 GitHub slug）时 `taskRepo` 为 null，`proposalRemote` 静默退回 `origin`。
`origin` 是 Brain 自身检出的本地 remote，结构上看不到 proposer 已推到 GitHub 的
`cp-harness-propose-r*` 分支 → `git ls-remote --heads origin ...` 返回空 → `proposeBranchRn` 恒为 0
→ `deriveCounters` 的 `noPushStreak` 持续累积 → 达 `MAX_NO_PUSH_STREAK(2)` → `deriveGan` 返回
`gan_no_push_streak` 把任务 `mark_failed`。而 proposer 明明真推了。
对比 `github-pr-discovery.js:34` 的 PR 发现路径用的是 `parseBaseRepo(base_repo ?? repo)` 兜底链，
观测路径却缺这一环，两处不一致即根因。此误判同样卡死 `capability-change-v1` r3 直出合同档
（`derive.js` 的 `proposeBranchRn >= 1` 收敛门永远不满足）。

## Golden Path（核心场景）

系统从 [proposer 真推了提案分支] → 经过 [ground-truth 在正确 remote 上观测] → 到达 [GAN 正常收敛，不误判 no-push]

具体：
1. [触发条件] 一个 harness 任务 payload 带 `repo`（如 `"cecelia"`）但**缺 `base_repo`**（或 base_repo 无法解析为 GitHub slug）；proposer 已把 `cp-harness-propose-r1-<shortTask>-...` 分支真推到 GitHub。
2. [系统处理] ground-truth 解析提案 remote 时按兜底链 `base_repo → repo → repo-map` 解析出真实 GitHub slug（`perfectuser21/cecelia`）；`git ls-remote --heads` 打到 `https://github.com/<slug>.git` 而非 `origin`；当仍无法解析出 GitHub slug 时，**不得**把本地 `origin` 的空结果当作"未推送"的权威结论去累积 `noPushStreak`（fail-closed 兜底）。
3. [可观测结果] `proposeBranchRn` 观测到 ≥1；`noPushStreak` 保持 0；`deriveGan` 不返回 `gan_no_push_streak`，任务继续走 reviewer / 直出合同收敛，不被 `mark_failed`。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **缺 base_repo 但有 repo**：走 `repo`（经 DEFAULT_REPO_MAP，`cecelia → perfectuser21/cecelia`）兜底，观测打到真实 remote。
- **base_repo 与 repo 均缺失/均不可解析**：不得静默退 `origin` 把空结果当权威 no-push；需 fail-closed（不累积 noPushStreak / 不据此 mark_failed），把不确定性交由既有 no-verdict / budget / hop 上限收口，避免"假 no-push"。
- **base_repo 正常可解析**：行为逐字节不变（零回归红线）——仍打到 `https://github.com/<slug>.git`。
- **ls-remote 命令本身失败/超时**：沿用现有 `execTolerant` 容错语义，失败不得被解读为"未推送"。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/ground-truth.js` 提案 remote 解析：补 `?? taskPayload.repo` 兜底链，与 `discoverPrFromGithub` 对齐；无法解析 GitHub slug 时对 `noPushStreak` 累积做 fail-closed 兜底。
- 新增复现该误判的 failing test（缺 base_repo + 真推分支 → 断言不退 origin、observed proposeBranchRn≥1、derive 不出 gan_no_push_streak），修复后永久保留为回归测试。

**不在范围内**：
- 不改 `MAX_NO_PUSH_STREAK` 阈值（仍为 2）、不改 `deriveGan` / `caps` 判定语义。
- 不改 `parseBaseRepo` 现有解析规则、不改 PR 发现路径。
- 不动 GAN 相位链、reviewer/proposer 路由、直出合同档的其它判定。

## 假设

- [ASSUMPTION: `taskPayload.repo` 是与 `discoverPrFromGithub` 同源的兜底字段，经 `parseBaseRepo` + DEFAULT_REPO_MAP 可把 `"cecelia"` 解析为 `perfectuser21/cecelia`。]
- [ASSUMPTION: 当前受影响任务 payload 同时带 `base_repo`（全 url）与 `repo:"cecelia"`；修复对二者齐全时零回归。]
- [ASSUMPTION: fail-closed 的具体收口点（跳过累积 vs 观测标记 unresolved）由 proposer 在合同阶段按最小改动确定，不引入新失败态。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`：提案 remote 解析兜底链 + fail-closed（第 736–742 行一带）。
- `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`：新增缺-base_repo 误判复现用例（回归保留）。
- （可能）`packages/brain/src/orchestrator/__tests__/derive.test.js` 或 `counters.test.js`：断言修复后不产生 `gan_no_push_streak` / `noPushStreak` 不累积。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task 返回空）+ PrepPRD；无显式 NFR，仅沿用既有容错语义 -->
- 超时/延迟: 待定（PrepPRD/decisions 未指定）；沿用 ls-remote 既有 `execTolerant` 容错，不新增阻塞。
- 频控: 无
- 版本要求: 无
- 可观测: 观测无法解析真实 remote 时须留痕（不静默吞成 no-push），便于归因。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [观测真相] ground-truth 观测提案分支必须打到能看到已推分支的真实 remote；本地 `origin` 结构上看不到 GitHub 已推分支，其空结果不得作为"未推送"权威结论累积 noPushStreak（来源: 本 sprint 根因，写入 Golden Path/边界作对抗锚点）
- [nightly-red 归因] 连续 ≥3 晚同一 job 红时，issue 须贴失败 step 最后 20 行原始 stdout（非 PowerShell 截断输出）（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收历史 golden-path；journey 现有 ability 均为 planned 态）

## E2E 验收

> Planner 初稿此区块留占位 + 自然语言验收点；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node --test 单测为主，无需外部服务）。

```bash
# 占位：proposer 将填入 local_api 脚本（node --test 运行 orchestrator 单测）
# 期望验收点（自然语言）：
# 1) 构造 taskPayload 缺 base_repo 但含 repo:"cecelia"，注入可记录 ls-remote 命令的 execCmd；
#    断言实际 ls-remote 命令目标为 https://github.com/perfectuser21/cecelia.git，不含裸 "origin"。
# 2) 在有已推 propose 分支的 ls-remote 输出下，observed.proposeBranchRn ≥ 1、noPushStreak == 0。
# 3) 把该 observed 喂给 derive，返回的 action/reason 不为 gan_no_push_streak（未被 mark_failed）。
# 4) 回归：base_repo 正常可解析时，remote 解析与既有行为逐字节一致（无回归）。
# 命令示例：node --test packages/brain/src/orchestrator/__tests__/ground-truth.test.js
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/（GAN 编排纯后端观测逻辑），无 UI/agent 协议/engine 介入，按 if-elif 链命中 autonomous。
## target_environment: local_api
## target_environment_reason: payload.target_environment 显式为 local_api；验收为 node --test 单测 + 本地 orchestrator 逻辑，无需外部机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
