# Learning: cp-06101029 双轴 Phase 2a — okr_initiatives.project_id 折叠 Scope

## 背景
执行轴收敛 3 层（Project→Initiative→Task）第一步：给 okr_initiatives 加 project_id 直挂 Project，从 scope 回填，绕开 Scope 层。纯增量 migration + smoke。

## 这次确认的两点（沿用 Phase 1 教训，未踩新坑）

### 根本原因
1. **EXPECTED_SCHEMA_VERSION 是地板，不随 migration 上调**：facts-check 本地会报 `selfcheck='293' but highest migration='298'`，但这是**本地 DevGate 噪音、非 CI 门禁**——CI 的 `selfcheck.test.js` 硬断言 `toBe('293')`，main 自己也是 293 对 297。改它=挂 CI brain-unit。已在 Phase 1（cp-06100848）踩过，本刀直接不碰。
2. **migration 号开 PR 前必查 origin/main 最新**：本刀写前 `git ls-tree origin/main` 确认 main 到 297 → 取 298，无撞号。

### 下次预防
- [ ] 加 migration **永不**改 `EXPECTED_SCHEMA_VERSION` / `DEFINITION.md` Schema 版本行（它是地板）；本地 facts-check 该条失败忽略。
- [ ] migration 号写前 `git fetch origin main && git ls-tree origin/main packages/brain/migrations/ | grep -oE '[0-9]+' | sort -n | tail -1` +1；开 PR 后若 BEHIND，rebase 再复查撞号。
- [ ] 折叠/删除中台表（如 okr_scopes）前先 `grep -rl` 数引用——Scope 被 50 文件活引用，不能直接 DROP，须先 rewire（留给 Phase 2b）。
- [ ] worktree 跑测试前软链根 + packages/brain 两处 node_modules。

## 关联
- Plan: docs/superpowers/plans/2026-06-10-phase2-initiative-unify.md（Phase 2a）
- Spec: docs/superpowers/specs/2026-06-10-canonical-wbs-tree-design.md §5
- Decision: 99ce3259（用现有 okr_initiatives 不新建；Scope 删除分步）/ ccce2e29
- 承接 Phase 1 Learning: cp-06100848（同样的版本地板教训）
