# Learning: cp-06101029 双轴 Phase 2a — okr_initiatives.project_id 折叠 Scope

## 背景
执行轴收敛 3 层（Project→Initiative→Task）第一步：给 okr_initiatives 加 project_id 直挂 Project，从 scope 回填，绕开 Scope 层。纯增量 migration + smoke。

## 这次纠正了 Phase 1 的一个错教训（重要）

### 根本原因：本地 pre-push hook 与 CI test 对 schema 版本有冲突的双重门禁
加 migration 后涉及 **3 处** schema 版本，必须**一起 bump**到最高 migration 号：
1. `packages/brain/src/selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION`
2. `packages/brain/src/__tests__/selfcheck.test.js` 的 `expect(...).toBe('NNN')`（连测试名）
3. `DEFINITION.md` 的 `Schema 版本: NNN`

**两个门禁顶牛**：
- **本地 pre-push hook**（`hooks/bash-guard.sh` → facts-check `selfcheck_version_sync`）**强制** `EXPECTED_SCHEMA_VERSION == 最高 migration`，否则 **block push**。
- **CI brain-unit**（`selfcheck.test.js`）硬断言 `toBe('<某值>')`。

Phase 1（cp-06100848）我误判 facts-check 是"可忽略的噪音"、把 EXPECTED 退回 293，结果是**靠"另一个 quickcheck 在跑跳过预检"的竞态侥幸 push 过的**（不可靠）。**正解 = selfcheck.js + selfcheck.test.js + DEFINITION.md 三处同步 bump 到最高号**，本地 hook 与 CI test 同时绿。（main 当前停在 293 对 297 是 inconsistent 状态、靠竞态绕过，是仓库系统性问题，值得开 Notion issue。）

### 下次预防
- [ ] 加 migration 时**三处一起 bump**到最高 migration 号：selfcheck.js EXPECTED + selfcheck.test.js 的 toBe + DEFINITION.md Schema 版本行。改完本地 `node scripts/facts-check.mjs` 必绿再 push。
- [ ] migration 号写前 `git fetch origin main && git ls-tree origin/main packages/brain/migrations/ | grep -oE '[0-9]+' | sort -n | tail -1` +1；开 PR 后若 BEHIND，rebase 再复查撞号 + 复查版本号是否还等于最高。
- [ ] 折叠/删除中台表（如 okr_scopes）前先 `grep -rl` 数引用——Scope 被 50 文件活引用，不能直接 DROP，须先 rewire（留给 Phase 2b）。
- [ ] worktree 跑测试前软链根 + packages/brain 两处 node_modules。

## 关联
- Plan: docs/superpowers/plans/2026-06-10-phase2-initiative-unify.md（Phase 2a）
- Spec: docs/superpowers/specs/2026-06-10-canonical-wbs-tree-design.md §5
- Decision: 99ce3259（用现有 okr_initiatives 不新建；Scope 删除分步）/ ccce2e29
- 承接 Phase 1 Learning: cp-06100848（同样的版本地板教训）
