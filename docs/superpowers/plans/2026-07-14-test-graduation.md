# 刀1 测试入册（毕业机制 + 清偿42孤儿）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。步骤用 checkbox 追踪。

**Goal:** merge 后测试有明确毕业去处与搬运脚本；42 个 sprints 孤儿全部清偿（毕业/归档），guard 棘轮 orphans 锁死 0。

**Architecture:** `scripts/graduate-sprint-tests.mjs`（纯 Node，供后续 harness-report/engine-ship 调用）+ 三分法清偿 + vitest include 扩 `tests/regression/**`。

**路由规则（毕业目标按测试类型定，不是一刀切）：**
| 测试类型 | 判据 | 去处 | 跑道 |
|---|---|---|---|
| brain/服务端/纯 node | import brain 源码或纯逻辑 | `tests/regression/<sprint-slug>/` | brain vitest（include 新增）|
| Dashboard React（.tsx/jsdom）| import react/testing-library | `apps/dashboard/` 现有测试目录（先读其 vitest config 确认 include 与环境）| workspace-test job |
| e2e-verify.sh | — | `scripts/smoke/e2e/<sprint-slug>.sh` | 刀3 接 nightly（本 PR 只入池；顶层 A2 判据不涉及子目录）|
| Playwright .spec.ts（e2e/ 目录）| import @playwright/test | 与 e2e-verify 同池 `scripts/smoke/e2e/`（改名保留）或归档（若依赖已死的 staging 页面）| 同上 |

**三分法：**
- ≥2026-07-10 新增（真欠账 10 个：4 tests + 4 e2e + 2 headed-smoke contract）→ 毕业，红修绿
- <2026-07-10（~32 个，07-10 大扫除判定脚手架未清）→ `git mv` 到 `sprints/archive/<原sprint名>/`（可逆；守活逻辑当时已升格 src/__tests__ 不复活）
- 毕业后与 `packages/brain/src/__tests__/` 现有测试语义重复的 → 归档不入册（在 PR 描述列明）

---

### Task 1: graduate-sprint-tests.mjs + TDD

**Files:** Create `scripts/graduate-sprint-tests.mjs`、`tests/graduate-sprint-tests.test.ts`

- [ ] Step 1 failing test（commit-1）：tmp fixture sprint（tests/a.test.ts + e2e-verify.sh）→ 断言：
  - `graduate(root, sprintDir, {dryRun:true})` 返回 `{tests:[{from,to}], e2e:[{from,to}]}`，to 分别为 `tests/regression/<slug>/a.test.ts` 与 `scripts/smoke/e2e/<slug>.sh`
  - 非 dryRun 真搬（fs 层面 rename+mkdir，保留子路径）；目标已存在同名 → 抛错不覆盖
  - slug 取 sprint 目录名去掉日期前缀非法字符转 `-`
  - 跑法：`cd packages/brain && npx vitest run ../../tests/graduate-sprint-tests.test.ts`
- [ ] Step 2 实现（commit-2）：纯函数 `planGraduation(root, sprintDir)` + `graduate(...)` CLI（`--sprint <dir> [--dry-run]`），CLI 尾部打印「记得下调 scripts/test-pyramid-baseline.json 的 orphans」

### Task 2: vitest include + 清偿 42 孤儿

**Files:** Modify `packages/brain/vitest.config.js`（include 加 `'../../tests/regression/**/*.{test,spec}.?(c|m)[jt]s?(x)'`）；42 个孤儿文件按上表路由 git mv；Modify `scripts/test-pyramid-baseline.json`

- [ ] Step 1：按日期与类型出三分清单（git log 首次入库日期已盘：07-13×9 + 07-08×1 = 真欠账；其余归档）
- [ ] Step 2：归档批（~32 个）`git mv` 进 `sprints/archive/`，一个 commit
- [ ] Step 3：毕业批逐个搬 + 修 import 路径/mock 至绿；跑不绿且功能已废弃 → 改归档并记录。dashboard React 测试先读 `apps/dashboard` vitest/test 配置再落位，用 workspace 的测试命令验证
- [ ] Step 4：baseline 更新：orphans→0；permanent 重新实测（含新增 regression 文件与 dashboard 落位文件；若 dashboard 目录不在 permanent_roots 且新落位文件在其中，把该测试目录加进 permanent_roots 并注明 layer）
- [ ] Step 5：全量验证：`node scripts/test-pyramid-guard.mjs`（孤儿 0、全绿）+ brain vitest 跑 tests/regression 全绿 + dashboard 测试命令全绿 + `bash scripts/__tests__/test-pyramid-guard.test.sh`
- [ ] Step 6：DevGate 三件套（碰了 brain 包配置）：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/engine/scripts/devgate/check-dod-mapping.cjs`

### Task 3: DoD + learning

- [ ] `DoD.cp-07141125-test-graduation.md`：至少 3 条 [BEHAVIOR]（guard 孤儿=0 manual:node；graduate 脚本测试 tests/ 路径；归档后 sprints 非 archive 无测试 manual:node -e 断言），全 [x]
- [ ] `docs/learnings/cp-07141125-test-graduation.md`：### 根本原因（入册无机制+大扫除留规矩没守卫）/ ### 下次预防（- [ ] harness-report/engine-ship 接 graduate 脚本=刀1b skills repo PR）
