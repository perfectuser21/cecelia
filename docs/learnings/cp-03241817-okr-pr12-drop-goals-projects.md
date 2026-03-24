# Learning: OKR PR12 — DROP goals/projects 旧表收尾

## 根本原因

1. **Migration 编号冲突**：PR12 最初使用 `185_drop_goals_projects.sql`，但在 PR 开发期间另一个 PR 已将 `185_drop_tasks_project_id_fkey.sql` 合并进 main，导致 L2 Consistency Gate 失败（migration 编号重复）。
   - 解决：将本 PR migration 重编为 `186_drop_goals_projects.sql`，并同步更新 `selfcheck.js`、`DEFINITION.md` 及所有版本断言测试。

2. **测试 Fixture 未同步迁移**：多个测试文件的 `beforeEach`/`afterEach` 仍在 INSERT/DELETE 已 DROP 的旧表（`goals`、`projects`、`project_kr_links`），导致 Brain Integration shards 报 `relation "goals" does not exist` / `relation "projects" does not exist`。
   - 受影响文件：`planner.test.js`、`planner-initiative-plan.test.js`、`planner-learning-penalty.test.js`、`actions-dedup.test.js`、`tick-dispatch-scope-decomposing.test.js`、`tick-drain.test.js`、`tick-kr-decomp.test.js` 等。
   - 解决：将所有旧表 fixture 迁移至 `key_results`、`okr_projects`，cleanup 改为对应新表。

3. **DoD Task Card 编号未同步**：migration 重编后，DoD 中的验收测试仍在检查 `186_` 前缀（最终修复：将 `.task-cp-*.md` 里所有 `185_` 引用统一改为 `186_`）。

4. **救援 session worktree 目录被删**：pipeline patrol 触发的 rescue session 使用了一个独立 worktree（`cd9e67fb-...`），该目录在上下文中断后被删除，导致后续 Bash 工具因 CWD 不存在而全部失败。
   - 解决：使用 `EnterWorktree` 创建新的 rescue-session worktree，恢复 Bash 工具可用性。

## 下次预防

- [ ] 当 PR 里新增 migration 时，**合并前必须先确认 main 的最新 migration 编号**（`git log origin/main --oneline -- packages/brain/migrations/ | head -1`），防止编号冲突。
- [ ] DROP 旧表的 migration 落地后，**必须全局搜索测试文件中的旧表引用**：`grep -rn "INTO goals\|INTO projects\|INTO project_kr_links\|FROM goals\|FROM projects" packages/brain/src/__tests__/`，确保所有 fixture 已迁移。
- [ ] DoD Task Card 中的 migration 编号验收命令（`startsWith('186_')`）要与 migration 文件名**同步更新**，可在 rename migration 时一起改。
- [ ] Pipeline patrol rescue 任务需要一个稳定的 worktree，避免在长时间跨对话任务中 CWD 失效；必要时在对话开始时立即 `EnterWorktree`。
