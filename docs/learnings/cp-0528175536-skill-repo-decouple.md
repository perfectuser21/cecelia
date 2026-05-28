## Skill Repo 完全解耦（2026-05-28）

### 根本原因
skill 文件长期混在 cecelia monorepo（packages/workflows/skills/ + packages/engine/skills/），导致：
- AI agent 在 main 分支直接改 skill → 触发 git stash → 积累 121 个 stash
- CI 和本机用两套 skill，版本不同步
- bump-version.sh 联动 SKILL.md，每次 Engine 版本 bump 都额外带上 skill 文件
- harness-shared.js SKILL_SEARCH_DIRS 第 4 条 monorepo fallback 掩盖问题

迁移过程中还发现：packages/engine/skills/dev/scripts/ 里的执行脚本（parse-dev-args.sh、worktree-manage.sh 等）不是 AI 提示词，是引擎执行脚本，不该移走——这是本 PR 最大的遗漏，导致 CI engine-tests 失败。

另外：多个进行中的 sprint 测试（harness-self-heal、cecelia-pipeline-viz-v2、dev-visibility-v3 等）是预存在失败，需要加入 vitest exclude 列表。

### 下次预防
- [ ] 迁移 skill 时区分「AI 提示词（SKILL.md）」和「执行脚本（scripts/）」，两者不能一起移走
- [ ] skill 改动统一在 zenithjoy-skills repo commit，不允许在 cecelia 里有 SKILL.md 文件
- [ ] Engine version bump 是 5 文件联动（删掉了 SKILL.md，记住是 5 个）
- [ ] harness-shared.js SKILL_SEARCH_DIRS 只有 3 条，不再有 monorepo fallback
- [ ] 大规模删文件 PR 前，先查哪些测试直接读这些文件路径（grep readFileSync + grep execFile）
- [ ] 新 sprint 测试加进 vitest exclude 前，先确认是预存在失败还是本 PR 引入的
