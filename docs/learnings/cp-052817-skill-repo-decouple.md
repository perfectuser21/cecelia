# Learning: Skill Repo 完全解耦

### 根本原因
skill 文件长期混在 cecelia monorepo 里（packages/workflows/skills/ + packages/engine/skills/），
导致：
- AI agent 在 main 分支直接改 skill 触发 git stash 积累（共 121 个 stash）
- CI 和本机用两套 skill，版本不同步
- bump-version.sh 联动 SKILL.md，每次 Engine 版本 bump 都额外带上 skill 文件
- harness-shared.js 的 SKILL_SEARCH_DIRS 第 4 条 monorepo fallback 掩盖了问题

### 解决方案
- 迁移：所有 skill 移到独立 private repo zenithjoy-skills（103 个）
- 本机：~/.claude/skills/ 103 个软链接指向新 repo
- cecelia 清理：删除 packages/workflows/skills/（59 目录）和 packages/engine/skills/（3 目录）
- 修复依赖：harness-shared.js、bump-version.sh、check-engine-hygiene.cjs、CI、合同文件

### 下次预防
- [ ] skill 改动统一在 zenithjoy-skills repo commit，不允许在 cecelia 里有 skill 目录
- [ ] Engine version bump 是 5 文件联动：package.json / package-lock.json / VERSION / .hook-core-version / regression-contract.yaml
- [ ] harness-shared.js SKILL_SEARCH_DIRS 只有 3 条（~/.claude-account*/skills + ~/.claude/skills）
- [ ] 不允许在 main 分支直接改任何受版本管理的文件
