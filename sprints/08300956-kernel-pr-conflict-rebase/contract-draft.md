# Sprint Contract Draft (Round 1) — PR 冲突(DIRTY)路由 generator-fix rebase [r84]

**锚定父路声明**: 覆盖父路 `factory/F1 造完真验`（journey e6f803f2）第 3 步（merge gate 前的路由裁决）。

**journey_type**: autonomous
**target_environment**: local_api（纯 Brain 后端 `derive.js` 纯函数路由，evaluator 本地 vitest 真 import 即可，无真机/DB 写）

> 唯一实现面：`packages/brain/src/orchestrator/derive.js`（纯函数状态机）。改动为在 merge gate 前新增
> DIRTY/CONFLICTING → `spawn:generator-fix(pr_conflict_rebase)` 有界路由 + 超界升人审。

---

## Response Schema（推导来源: PRD 字面 + api_registry 无 HTTP 端点）

`N/A — 任务无 HTTP 响应`。本 sprint 不新增/修改任何 HTTP 端点，`derive()` 是纯函数，返回**路由决策对象**（内部契约，非对外 schema）。为让 evaluator 机检，把返回对象字面 key 固化如下：

### 函数返回契约: `derive(observed) → { phase, action, reason }`

**新增/命中 DIRTY 或 CONFLICTING（未 merged）时**:
```json
{"phase": "generate", "action": "spawn:generator-fix", "reason": "pr_conflict_rebase"}
```
- `action` (string, 必填): 字面量 `"spawn:generator-fix"`（来源——PRD 要求 #1；ACTION.SPAWN_GENERATOR_FIX 常量）
- `reason` (string, 必填): 字面量 `"pr_conflict_rebase"`（来源——PRD 要求 #1，generator-fix 指令锚，禁止改名）

**同一 run 已累计 ≥3 条 `reason=pr_conflict_rebase` 意图行仍 DIRTY**:
```json
{"phase": "review", "action": "wait:human_review", "reason": "pr_conflict_unresolved"}
```
- `action` (string, 必填): 字面量 `"wait:human_review"`（来源——PRD 要求 #2；ACTION.WAIT_HUMAN_REVIEW）
- `reason` (string, 必填): 字面量 `"pr_conflict_unresolved"`（来源——PRD 要求 #2，禁止改名）

**禁用字段名 / 禁用改写**: 禁止把 `reason` 写成 `conflict_rebase` / `dirty_rebase` / `pr_rebase` / `pr_conflict` 等同义替换；`action` 禁止写成 `spawn:generator`（那是全新 generator，非 fix）。PRD 给的 `pr_conflict_rebase` / `pr_conflict_unresolved` 是不可改的 ground truth。

**Error / 负向（既有路由一字不变）**: BEHIND/CLEAN/BLOCKED/UNSTABLE/null/UNKNOWN → 原样返回既有决策（`merge_pr`/`all_gates_passed`、`wait:poll_ci`/`ci_pending` 等）；已 merged → `report`/`pr_merged` 短路。

---

## Golden Path

[merge gate 前 PR 呈 DIRTY] → [derive 路由 spawn:generator-fix rebase / 有界重试] → [PR 恢复可合 或 超界升人审]

### Step 1: 双 PASS + PR 存在未 merged + `mergeStateStatus ∈ {DIRTY, CONFLICTING}`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步（第 18-19 行）直接定义。

**可观测行为**: `derive()` 在 merge gate 前读到 `observed.pr.mergeStateStatus` 为冲突枚举，返回 `spawn:generator-fix`，`reason=pr_conflict_rebase`，**优先于** `wait:poll_ci` / `merge_pr` / `wait:human_review`。

**验证命令**:
```bash
# 真 import derive.js，构造 DIRTY 双 PASS observed，断言路由（见 tests/ 冻结用例）
npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js \
  -t "DIRTY 双PASS 路由 generator-fix rebase pr_conflict_rebase"
# 期望：exit 0（该 it PASS）
```
**硬阈值**: `action == "spawn:generator-fix"` 且 `reason == "pr_conflict_rebase"`；对 `ci=pending`（poll_ci 死等根因）与 `reviewRequired=true`（human_review）两种前置状态同样命中。

---

### Step 2: 有界升人审（≥3 条 pr_conflict_rebase 意图行仍 DIRTY）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步（第 20 行）+ 边界情况（第 28 行）直接定义；计数口径 `[AI_ADDED]` 理由：机械可重放的意图行计数是唯一确定性有界信号（禁 Date/时间戳），且阈值 3 < 全局熔断阈值 5，本专用闸先兜住。

**可观测行为**: 同一 run 内 `decisionLog` 已存在 ≥3 条 `action=spawn:generator-fix` 且 `detail.reason=pr_conflict_rebase` 的意图行、当前仍 DIRTY → `derive()` 返回 `wait:human_review`，`reason=pr_conflict_unresolved`（人审请求行由 `loop.humanReviewDetail` 带候选头锚，derive 只返回决策）。第 1/2/3 次仍派 generator-fix，第 4 次才升人审。

**验证命令**:
```bash
npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js \
  -t "DIRTY 已有3条rebase意图 第4次升 human_review pr_conflict_unresolved"
# 期望：exit 0
```
**硬阈值**: 已 2 条 → 第 3 次 `spawn:generator-fix`；已 3 条 → `wait:human_review` 且 `reason=pr_conflict_unresolved`。计数**只认** `reason=pr_conflict_rebase`（其它 reason 的 generator-fix 不占额度）。

---

### Step 3: 负向 —— 非冲突枚举 / 已 merged 既有路由一字不变
**来源**: `[FROM_PRD]` — PRD 要求 #3/#4（第 21 行）+ 边界情况（第 27 行）直接定义。

**可观测行为**: `mergeStateStatus ∈ {BEHIND, CLEAN, BLOCKED, UNSTABLE}` 及 `null`/`UNKNOWN` 不视为冲突，既有路由不变（BEHIND/CLEAN → `merge_pr`；CLEAN+ci=pending → `wait:poll_ci`）；`pr.merged=true` → `report`/`pr_merged` 短路，不受影响。

**验证命令**:
```bash
npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js \
  -t "负向"
# 期望：exit 0（全部 8 条负向 it PASS）
```
**硬阈值**: 6 类非冲突枚举 + 已 merged + CLEAN ci_pending 共 8 条负向断言全 PASS（修前修后均 GREEN，回归护栏）。

---

## 已知约束（来自回归测试 + 累积 FR）

- [tests/gp/f1/step3-merge-dirty-not-fatal.js] `kernel-handlers.merge_pr` 遇 DIRTY/CONFLICTING 返回 BLOCKED（fail-closed 兜底）；本 sprint **不改** merge_pr（不做 #1），该测试保持 GREEN——derive 层的 rebase 路由在 merge_pr 被调用前就接管了 DIRTY，两者不冲突。
- [tests/gp/f1/step3-mapci-behind-required-fail.js] BEHIND 不豁免 required 红（ground-truth.mapCiStatus）；本 sprint 不动 ground-truth，BEHIND 路由保持既有 merge_pr/update-branch。
- [累积FR] context-manifest: unavailable（postgres=false，端点不可达，记一行不静默跳过）。本 line 累积 FR 为空（PRD 第 64 行「本 line 暂无历史」）。

## 历史约束三源（铁律 → INV 映射）

见 `contract-dod.md` INV-1..INV-8 条目（PRD Invariant 铁律逐条映射 + N/A 声明）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | `derive()` 在 merge gate 前对 DIRTY/CONFLICTING（未 merged）路由 `spawn:generator-fix(pr_conflict_rebase)`，优先于 poll_ci/merge_pr/human_review；≥3 条 rebase 意图行仍 DIRTY 升人审(`pr_conflict_unresolved`)。 |
| **NFR（做得多好）** | | 纯函数确定性可重放（同 observed 产同路由，禁 Date/时间戳）；rebase 有界上限 3。 |
| **Invariant（永不违反）** | | [PR冲突不空等] 不按 CI 卡死空等；[merge权归controller] derive 只出路由决策不自 merge；负向零回归（非冲突枚举/已 merged 路由不变）。 |
| **判定点（怎么知道）** | | 见判定点登记表——本任务判定点为纯枚举字符串比对（`mergeStateStatus`），无对模糊现实的推断，N/A。 |
| **保质期（何时过期）** | | 路由规则随 GitHub `mergeStateStatus` 枚举语义有效；无 token/数据保质期。 |
| **死亡告警（停了谁知道）** | | 升人审（`pr_conflict_unresolved`）即告警出口；全局熔断阈值 5 为二级兜底。 |
| **失败语义（挂了怎么办）** | | 见失败语义声明。rebase 有界重试幂等（意图行计数可重放），超界 fail-closed 升人审，不静默放行。 |
| **效果确认（已发≠已生效）** | | derive 为纯决策函数，效果由下游 generator-fix rebase 实际执行 + 下一 tick 重新观测 `mergeStateStatus` 确认（非本 sprint 范围，reason 字符串即指令锚）。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |

`（本任务无接缝判定点，N/A）`——`mergeStateStatus` 是上游 observe 层已填充的 GitHub 原值枚举字符串（PRD 假设第 38 行），derive 仅做确定性字符串枚举比对，不推断外部真实状态。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| DIRTY/CONFLICTING 首次命中 | 路由 spawn:generator-fix(pr_conflict_rebase) | 是（意图行计数纯 decisionLog 可重放） | generator-fix rebase 到 origin/main |
| DIRTY 已累计 ≥3 条 rebase 意图行 | 路由 wait:human_review(pr_conflict_unresolved) | 是（同一 decisionLog 产同决策） | fail-closed 升人审带候选头锚，禁静默放行 |
| `mergeStateStatus` 缺失/null/UNKNOWN | 不误触发 rebase，走既有路由 | 是 | 既有 merge_pr/poll_ci 兜底不变 |

### 输入对抗面（对外暴露 agent 必填）

`N/A` —— `derive()` 是内部纯函数状态机，输入 `observed` 由服务端 ground-truth 层构造，不接受外部用户直接写入，无 prompt injection 面。

---

## 禁 mock 边清单

本单改动命中「状态机（状态迁移/终态判定）」+「跨模块数据传递（`observed.pr.mergeStateStatus` / `decisionLog` 意图行 → 路由决策）」，故：

- 代码 ↔ `derive.js` 路由函数（本单改 merge gate 前分支，测试必须**真 import** `packages/brain/src/orchestrator/derive.js` 调 `derive()`，禁 `vi.mock`/stub derive 或其内部路由函数）
- `derive` ↔ `observed.pr.mergeStateStatus` / `observed.decisionLog`（本单新读这两条数据边，测试直接构造真实 observed 对象注入，禁用替身伪造路由返回值）

> 冻结测试（sprints/.../tests/ 与 tests/gp/f1/）均真 import derive.js、零 `vi.mock`，纯函数可重放。无 DB 写路径（postgres=false），无需 integration Postgres。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

> 当前仓库（cecelia）根目录无 `product-map/generated/product-map.json`，本段跳过不阻塞。

---

## Contract Gate

contract-gate: present (cecelia worktree, packages/brain/src/lib/contract-gate.js exists) —— 本合同 BEHAVIOR/E2E 断言均 `npx vitest run ... -t` exit-code 驱动（真 import derive.js），不涉及 curl-no-jq / count-no-timewindow / `|| true` 吞错等反模式；DB 写路径为空（纯函数），无时间窗要求。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> 纯函数路由改动。E2E 即：对空环境（无需 Postgres）跑冻结的两处回归套件（真 import derive.js），
> 全 15 用例 GREEN，且校验版本四处同步（generator green 时 bump 1.273.151 → 1.273.152）。
> 冻结测试位于 sprints/**、tests/** 两个根 vitest include 内，从仓库根 `npx vitest run` 合法。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

echo "▶ Step 1: 冻结 RED 套件（sprint dir，真 import derive.js）"
npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js --no-cache

echo "▶ Step 2: 永久回归位（tests/gp/f1，PRD #5）"
npx vitest run tests/gp/f1/step3-pr-conflict-rebase-route.test.js --no-cache

echo "▶ Step 3: 既有 merge_pr fail-closed 回归不破（不做 #1）"
npx vitest run tests/gp/f1/step3-merge-dirty-not-fatal.test.js --no-cache

echo "▶ Step 4: 版本四处同步（generator green 后应全绿：1.273.152）"
bash scripts/check-version-sync.sh

echo "✅ Golden Path 验证通过：DIRTY/CONFLICTING 自愈路由 + 有界升人审 + 负向零回归 + 版本同步"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `observed.pr.mergeStateStatus` 传大小写混杂（`Dirty`/`dirty`）或前后空格 —— 断言不因大小写/空白误触发或误漏触发（确认实现按 GitHub 原值大写枚举精确匹配，非模糊 includes）。
- 重复提交: 同一 run 连续多 tick 命中 DIRTY —— 确认意图行计数严格递增到 3 才升人审，不因单 tick 重放重复计数。
- 中途中断: 第 2 条 rebase 后 PR 短暂变 CLEAN 又回 DIRTY —— 确认计数只认历史 rebase 意图行，不因中途状态抖动重置或跳过有界。
- 边界值: 恰好 2 条 vs 恰好 3 条 rebase 意图行的临界（第 3 次派 / 第 4 次升人审）；`mergeStateStatus` 为空字符串 `""` 与 `null` 同等不触发。
发现分级: P0/P1（DIRTY 仍死等 / 负向枚举被误路由到 rebase / 计数错位提前或漏升人审）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| DIRTY/CONFLICTING 有界 rebase 路由（冻结） | `sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js` | `DIRTY 双PASS 路由 generator-fix rebase pr_conflict_rebase` / `DIRTY 已有3条rebase意图 第4次升 human_review pr_conflict_unresolved` / `负向 BEHIND 仍走 merge_pr all_gates_passed` | 7 failed \| 8 passed（新路由 RED，负向 GREEN） |
| 同套永久回归位（补充，PRD #5） | `tests/gp/f1/step3-pr-conflict-rebase-route.test.js` | `DIRTY 双PASS 路由 generator-fix rebase pr_conflict_rebase` / `DIRTY 已有3条rebase意图 第4次升 human_review pr_conflict_unresolved` / `负向 BEHIND 仍走 merge_pr all_gates_passed` | 7 failed \| 8 passed（新路由 RED，负向 GREEN） |
