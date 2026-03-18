# Learning: cp-03182029-cto-review-skill

**任务**: 实现 /cto-review skill（CTO整体审查）
**分支**: cp-03182029-cto-review-skill
**日期**: 2026-03-18

---

### 根本原因

**问题**：`/cto-review` skill 文件不存在，Brain #1083 已有 `cto_review` task_type 的路由（`/cto-review`），但执行目标 skill 本体缺失，导致西安 Codex 收到 cto_review 任务时无法找到对应 skill 执行。

**具体原因**：Brain 代码（task-router.js + executor.js + model-registry.js）已注册了 `cto_review` task_type，也有 `request-cto-review` API 端点，但 `packages/workflows/skills/cto-review/SKILL.md` 没有被创建。

---

### 下次预防

- [ ] 新增 Brain task_type 时，同步检查对应的 skill 文件是否存在（`packages/workflows/skills/<skill-name>/SKILL.md`）
- [ ] Brain PR 合并后，立即在 TODO 列表中记录"创建对应 skill 文件"
- [ ] task-router.js 的 SKILL_WHITELIST 可加 CI 检查：确认映射的 skill 路径对应的 SKILL.md 存在

---

### 实现要点

1. **Skill 格式**：参考 `review/SKILL.md` 的 YAML frontmatter + 章节结构
2. **5步流程**：Step 1~5 命名必须精确匹配（CI 的 DoD 验证会检查）
3. **输出格式**：`REVIEW_RESULT: PASS` 和 `REVIEW_RESULT: FAIL` 是 Brain callback 解析的关键字
4. **PRD/DoD 双放**：packages/workflows/ 子树下开发，PRD/DoD 必须放两处（根目录 + packages/workflows/）

---

### 技术债

- verify-step.sh 的 Gate 1/2 在 worktree 场景下有 context 断层：hooks 在主仓库上下文运行（BRANCH=main），无法感知 worktree 的分支和文件。需要通过在主仓库根目录创建软链接（.dod.md → worktree/.dod.md）来绕过，这是脆弱的设计。
- 建议：hooks 应从 `.dev-mode.*` 文件中读取 worktree 路径，而不是从 `git rev-parse --show-toplevel` 获取 PROJECT_ROOT。
