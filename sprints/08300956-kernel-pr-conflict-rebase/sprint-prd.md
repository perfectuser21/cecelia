# Sprint PRD — PR 与 main 冲突(DIRTY)路由 generator-fix rebase，根除死等/判死 [r84]

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（补齐 kernel run merge 阶段 DIRTY 冲突的唯一未覆盖自愈路由）

## 背景

r83（run 32873c79）零人碰跑到 judge PASS + merge gate，但其基线早于 45 批 #5089 合并，两者都 bump 同一版本号（`.brain-versions` / `DEFINITION.md` 版本行 / `packages/brain/package.json` / `package-lock`）→ PR 变 DIRTY。DIRTY 的 PR GitHub 不触发 `pull_request` 工作流（CI 永不绿），`kernel-handlers.merge_pr` 遇 DIRTY 只返回 BLOCKED，没有任何自愈路由——只能死等或判死（automation_deadline_exceeded）。本 sprint 在 `derive.js`（纯函数路由层）新增 DIRTY/CONFLICTING → `spawn:generator-fix` 的有界 rebase 路由，把"kernel run 在途禁合任何 PR"的绕开症状替换为真正的自愈。

## Golden Path（核心场景）

系统从 [merge gate 前 PR 呈 DIRTY] → 经过 [路由到 generator-fix rebase / 有界重试] → 到达 [PR 恢复可合 或 升人审]

具体：
1. 双 PASS 且 PR 存在、未 merged，`derive()` 读到 `observed.pr.mergeStateStatus ∈ {DIRTY, CONFLICTING}`。
2. `derive()` 优先于 `wait:poll_ci` / `merge_pr` / `wait:human_review` 返回 `spawn:generator-fix`，`reason` 固定 `pr_conflict_rebase`（generator-fix 据此在候选工作区 rebase 到 origin/main、解冲突，版本文件冲突取 main 当前版本 +1 并四处同步）。
3. 有界：同一 run 内 `reason=pr_conflict_rebase` 的 `spawn:generator-fix` 意图行已达 ≥3 条仍 DIRTY → `derive()` 返回 `wait:human_review`，`reason` 固定 `pr_conflict_unresolved`（人审请求行照既有 humanReviewDetail 带候选头锚）。
4. 负向：`mergeStateStatus ∈ {BEHIND, CLEAN, BLOCKED, UNSTABLE}` 的既有路由一字不变（BEHIND 仍走 `merge_pr` 的 update-branch ≤3）；`pr` 已 merged 不受影响。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- `mergeStateStatus` 缺失/为 null/UNKNOWN：不视为冲突，走既有路由（不误触发 rebase）。
- 第 3 次 rebase 与升人审的边界：第 1、2、3 次仍派 generator-fix，第 4 次（≥3 已累计）才升人审——RED 必须覆盖"第 4 次仍 DIRTY 升人审"。
- 计数只认 `reason=pr_conflict_rebase` 的意图行，其它 reason 的 generator-fix 不计入本界。

## 范围限定

**在范围内**：仅 `packages/brain/src/orchestrator/derive.js` 纯函数路由层新增 DIRTY/CONFLICTING 分支 + 有界升人审；`tests/gp/f1/` 新增 RED 回归；版本 bump 四处；DoD.md；sprints 目录。
**不在范围内**：`kernel-handlers.merge_pr` 的 DIRTY→BLOCKED 兜底（fail-closed 保留，不改）；generator-fix 的提示词/bundle（reason 字符串即指令锚）；publisher 发布路径。

## 假设

- [ASSUMPTION: `observed.pr.mergeStateStatus` 已由上游 observe 层填充为 GitHub 原值枚举字符串（DIRTY/CONFLICTING/BEHIND/CLEAN/BLOCKED/UNSTABLE/UNKNOWN）；RED 直接构造 observed 对象注入。]
- [ASSUMPTION: 有界阈值 3 指"已存在 ≥3 条 pr_conflict_rebase 意图行"后升人审，与 thin_prd "≥3 条仍 DIRTY → 人审" 一致。]

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空（ability 未挂 NFR 决策）；以下取自 PrepPRD 显式约束 -->
- 确定性/可重放: `derive()` 保持纯函数，同一 observed 输入产出同一路由（thin_prd「纯函数可重放」）。
- 有界/频控: `pr_conflict_rebase` 重试上限 3 次，超界升人审（`pr_conflict_unresolved`）。
- 可观测: 路由 reason 为固定字符串常量（`pr_conflict_rebase` / `pr_conflict_unresolved`），供 evaluator 机检与 generator-fix 指令锚定。
- 版本要求: 无外部版本约束。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 为空，以下取 area 级三源合并去重（仅注入与本 sprint 相关铁律 + 系统级铁律） -->
- [PR冲突不空等] PR 处于 CONFLICTING/DIRTY 时 GitHub 静默不触发 pull_request CI，禁止按 CI 卡死空等（来源: area）
- [merge权归controller] generator/generator-fix 禁止自行 merge PR，merge 权归 controller（来源: area）
- [planner分支] planner/各角色使用服务端签发的 role branch，禁在 Provider 内自行 checkout/switch（来源: area）
- [验证时钟] Kernel 既有 PR 的 evaluator 必须继承既有 validation clock，不得冻结（来源: area）
- [不写死环境] 禁止写死环境假设值（来源: area 系统）
- [真环境验证] 真环境验证才算 done（来源: area 系统）
- [多租户] 测试默认多租户隔离（来源: area 系统）
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area 系统）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`: 新增 DIRTY/CONFLICTING → spawn:generator-fix(pr_conflict_rebase) 有界路由 + 超界升人审。
- `tests/gp/f1/step3-pr-conflict-rebase-route.test.js`（新建，避让已有 step3-merge-dirty-not-fatal.test.js）: RED 复刻 r83 场景，真 import derive.js，禁 mock 被改的边。
- `.brain-versions` / `DEFINITION.md` 版本行 / `packages/brain/package.json` / `package-lock.json`: 版本 bump 四处同步。
- `sprints/08300956-kernel-pr-conflict-rebase/DoD.md`: DoD→Test 映射。
- 行为变更冲突的既有回归测试（如 step3-merge-dirty-not-fatal.test.js）: 若既有断言与新路由冲突则 claim 更新。

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（vitest 真 import derive.js + curl/psql 断言路由）。

```bash
# 占位：proposer 将填入 local_api 脚本
# 期望验收点（自然语言）：
#  1) DIRTY 现状复刻：修前 observed.pr.mergeStateStatus=DIRTY → 死等/无自愈路由（RED 断言旧行为）。
#  2) 修后路由：同 observed → derive() 返回 action=spawn:generator-fix, reason=pr_conflict_rebase。
#  3) 有界升人审：已存在 ≥3 条 pr_conflict_rebase 意图行且仍 DIRTY → action=wait:human_review, reason=pr_conflict_unresolved。
#  4) 负向不回退：BEHIND→merge_pr(update-branch)、CLEAN→merge_pr、已 merged 不受影响，逐一断言原路由未变。
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 纯后端路由函数 derive.js，无 UI/远端 agent/engine 介入。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，evaluator 本地 vitest 真 import derive.js + curl localhost:5221 断言即可，无需真机。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: F1-step3（map_scope=F1；PrepPRD 未提供 Step UUID）
