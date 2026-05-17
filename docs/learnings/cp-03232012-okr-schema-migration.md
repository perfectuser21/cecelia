# Learning: OKR migration 179 — goals/projects → 新 OKR 表完整迁移

## 变更摘要

Migration 179 将旧 `goals`/`projects` 表数据完整迁移至新 OKR 层级表（visions/objectives/key_results/okr_projects/okr_scopes/okr_initiatives），并更新 selfcheck.js EXPECTED_SCHEMA_VERSION 至 179。

### 根本原因

**Bug 1：migration SQL 引用了不存在的列 `custom_props`**
`goals` 和 `projects` 是旧表，没有 `custom_props` 列。该列只在 migration 177 的新 OKR 表里定义。CI 用空库重跑所有 migration，因此报 `column g.custom_props does not exist`。

**Bug 2：task card 未 commit 到分支**
`.task-cp-03232012-okr-schema-migration.md` 文件只存在于 worktree 目录，没有随 PR commit 提交。CI 的 `check-dod-mapping.cjs` 找不到分支对应的 task card，回退到 `.dod.md`（旧 okr-seven-tables DoD），导致检查 `selfcheck.js` 包含 '177' 失败。

**Bug 3：Learning 文件在合并前缺失**
Learning 必须在第一次 push 前写好并加入 commit，不能事后补。

### 下次预防

- [ ] migration SQL 只能引用旧表已有的列。在写 SELECT 语句前，先用 `grep "ALTER TABLE.*ADD COLUMN" migrations/` 确认列存在
- [ ] 新建的 OKR 新表列（`custom_props` 等）不要在引用旧表数据时直接 SELECT，用字面量代替：`'{}'::jsonb AS custom_props`
- [ ] task card 文件必须在 Stage 2 Code 结束前 `git add` 并 commit，不能只在 worktree 目录存放
- [ ] Learning 文件必须在第一次 `git push` 前写好并加入 commit
- [ ] CI 用空库重跑所有 migration——本地已有数据不代表 CI 能通过，需单独验证 schema 兼容性
