contract_branch: cp-harness-propose-r2-3a6e8f56-r698bc118-a38
sprint_dir: sprints/08300956-kernel-pr-conflict-rebase

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: PR 冲突(DIRTY)路由 generator-fix rebase [r84]

**范围**: 仅 `packages/brain/src/orchestrator/derive.js` 纯函数路由层新增 DIRTY/CONFLICTING → `spawn:generator-fix(pr_conflict_rebase)` 有界路由 + 超界升人审(`pr_conflict_unresolved`)；`tests/gp/f1/` + `sprints/.../tests/` 冻结回归；版本 bump 四处。
**大小**: S

## 合同边界（claim 与可写白名单 — PRD 铁律 #7）

generator 可写白名单（除此清单外禁创建计划外文件；禁止执行为锁死清单）：
- `packages/brain/src/orchestrator/derive.js`（唯一实现面）
- `tests/gp/f1/step3-pr-conflict-rebase-route.test.js`（新回归，PRD #5）
- `sprints/08300956-kernel-pr-conflict-rebase/**`（含冻结测试、合同、DoD、task-plan）
- 版本 bump 四处：`packages/brain/package.json` / `packages/brain/package-lock.json` / `.brain-versions` / `DEFINITION.md`（Brain 版本行）→ 1.273.151 → **1.273.152**
- 行为变更冲突的既有回归测试（若断言与新路由冲突则 claim 更新）：本单经核 `tests/gp/f1/step3-merge-dirty-not-fatal.test.js`（测 kernel-handlers.merge_pr，不改）**无冲突**，不 claim 更新。

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js 含 DIRTY/CONFLICTING → pr_conflict_rebase 路由分支
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('pr_conflict_rebase'))process.exit(1)"
- [ ] [ARTIFACT] derive.js 含超界 pr_conflict_unresolved 升人审
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('pr_conflict_unresolved'))process.exit(1)"
- [ ] [ARTIFACT] 版本四处同步到 1.273.152
  Test: manual:bash -c 'bash scripts/check-version-sync.sh && node -e "process.exit(require(\"./packages/brain/package.json\").version===\"1.273.152\"?0:1)"'

## BEHAVIOR 条目（五行剧本，evaluator 原样真跑 — 真 import derive.js）

- [ ] [BEHAVIOR] [L2] B-01: DIRTY 双PASS 路由 generator-fix rebase
  动作: 构造 mergeStateStatus=DIRTY 的双 PASS merge-gate observed，调用 derive()
  预期观察: derive() 返回 action=spawn:generator-fix, reason=pr_conflict_rebase（不再 merge_pr 死等）
  等待预算: 0s
  留证: vitest 输出末 20 行（含该 it PASS）
  Test: manual:bash -c 'npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js -t "DIRTY 双PASS 路由 generator-fix rebase pr_conflict_rebase"'

- [ ] [BEHAVIOR] [L2] B-02: CONFLICTING 双PASS 路由 generator-fix rebase
  动作: 构造 mergeStateStatus=CONFLICTING 的双 PASS observed，调用 derive()
  预期观察: derive() 返回 action=spawn:generator-fix, reason=pr_conflict_rebase
  等待预算: 0s
  留证: vitest 输出末 20 行（含该 it PASS）
  Test: manual:bash -c 'npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js -t "CONFLICTING 双PASS 路由 generator-fix rebase pr_conflict_rebase"'

- [ ] [BEHAVIOR] [L2] B-03: DIRTY ci_pending 优先于 poll_ci 路由 generator-fix
  动作: 构造 mergeStateStatus=DIRTY 且 ci=pending 的 observed，调用 derive()
  预期观察: derive() 返回 spawn:generator-fix/pr_conflict_rebase，不再 wait:poll_ci 死等（DIRTY 时 GitHub 不触发 CI）
  等待预算: 0s
  留证: vitest 输出末 20 行（含该 it PASS）
  Test: manual:bash -c 'npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js -t "DIRTY ci_pending 优先于 poll_ci 路由 generator-fix"'

- [ ] [BEHAVIOR] [L2] B-04: 有界升人审（≥3 条 rebase 意图行仍 DIRTY）
  动作: 构造含 3 条 reason=pr_conflict_rebase 意图行的 decisionLog + DIRTY，调用 derive()
  预期观察: derive() 返回 action=wait:human_review, reason=pr_conflict_unresolved（第 4 次才升人审）
  等待预算: 0s
  留证: vitest 输出末 20 行（含该 it PASS）
  Test: manual:bash -c 'npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js -t "DIRTY 已有3条rebase意图 第4次升 human_review pr_conflict_unresolved"'

- [ ] [BEHAVIOR] [L2] B-05: 负向非冲突枚举/已 merged 既有路由一字不变
  动作: 逐一构造 BEHIND/CLEAN/BLOCKED/UNSTABLE/null/UNKNOWN、已 merged、CLEAN+ci_pending 的 observed，调用 derive()
  预期观察: BEHIND/CLEAN/BLOCKED/UNSTABLE/null/UNKNOWN → merge_pr；已 merged → report/pr_merged；CLEAN+ci_pending → wait:poll_ci（全部原路由）
  等待预算: 0s
  留证: vitest 输出末 20 行（8 条负向 it 全 PASS）
  Test: manual:bash -c 'npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js -t "负向"'

- [ ] [BEHAVIOR] [L2] B-06: 计数只认 pr_conflict_rebase reason
  动作: 构造含 3 条非 pr_conflict_rebase reason（ci_fail/container_exit）的 generator-fix 意图行 + DIRTY，调用 derive()
  预期观察: derive() 仍返回 spawn:generator-fix/pr_conflict_rebase（其它 reason 不占本界额度，未误升人审）
  等待预算: 0s
  留证: vitest 输出末 20 行（含该 it PASS）
  Test: manual:bash -c 'npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js -t "计数只认 pr_conflict_rebase reason"'

- [ ] [BEHAVIOR] [L2] INV-1 [PR冲突不空等]: DIRTY 不按 CI 卡死空等
  动作: 构造 DIRTY + ci=pending 的 observed，调用 derive()
  预期观察: 不返回 wait:poll_ci（不空等），而是 spawn:generator-fix/pr_conflict_rebase 自愈
  等待预算: 0s
  留证: vitest 输出末 20 行（含该 it PASS）
  Test: manual:bash -c 'npx vitest run sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js -t "DIRTY ci_pending 优先于 poll_ci 路由 generator-fix"'

### Invariant 铁律映射（PRD 第 49-59 行；无对应断言者显式 N/A）

- INV-1 [PR冲突不空等] → 见上方 [BEHAVIOR] INV-1（本 sprint 核心达成）
- INV-2 [merge权归controller]: N/A —— derive 只返回路由决策对象（含 merge_pr），不执行 merge；本单不触碰 merge 执行权，负向断言证明 derive 仍只出 merge_pr 决策交 controller。
- INV-3 [planner分支]: N/A —— 纯函数改动，不涉及分支 checkout/switch。
- INV-4 [验证时钟]: N/A —— 不改 evaluator/validation clock；derive 是纯函数无时钟。
- INV-5 [不写死环境]: N/A —— DIRTY/CONFLICTING 等为 GitHub 协议枚举常量（PRD 假设 #38），非环境假设值；无坐标/阈值/env 硬编码。
- INV-6 [真环境验证]: N/A —— 纯函数逻辑，真 import derive.js 真跑即真验（无替身），无真机接缝。
- INV-7 [多租户]: N/A —— 无租户数据面，纯路由函数。
- INV-8 [单slot串行]: N/A —— 不涉及调度并发编排。
