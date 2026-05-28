# Design: Skill Repo 完全解耦

**日期**: 2026-05-28  
**分支**: cp-0528175536-skill-repo-decouple  
**目标**: 从 cecelia 删除所有 skill 目录，skill 完全迁移到 zenithjoy-skills repo

## 背景

Skill 文件（`~/.claude/skills/`）已迁移到独立 repo `github.com/perfectuser21/zenithjoy-skills`。本地软链接（103 个）已全部更新指向新 repo。cecelia 里保留的 `packages/workflows/skills/`（59 个目录）和 `packages/engine/skills/`（3 个目录）是冗余，会造成双写不一致和 stash 污染。本 PR 完成最后的清理。

## 架构

Skill 加载路径（`harness-shared.js` SKILL_SEARCH_DIRS）原有 4 个搜索位置：
1. `~/.claude-account1/skills`
2. `~/.claude-account2/skills`
3. `~/.claude/skills` ← 本机走这里，已通过软链接指向 zenithjoy-skills ✅
4. `packages/workflows/skills` ← CI fallback，本 PR 删除

删除第 4 项后，本机使用第 3 项（软链接）。CI 环境不需要真实 skill 文件（所有测试均 mock `loadSkillContent`，唯一例外的测试改为 inline 内容断言）。

## 改动清单

### 运行时代码
- `packages/brain/src/harness-shared.js:38` — 删除 `packages/workflows/skills` fallback 路径及其注释

### 测试修复
- `packages/brain/src/workflows/__tests__/await-callback-retry.test.js:27-33` — 把 `readFileSync(harness-generator/SKILL.md)` 改为 `vi.mock` 或内联字符串断言，不再依赖文件系统

### 脚本
- `packages/workflows/scripts/deploy-workflow-skills.sh` — 整文件删除（职责是部署 packages/workflows/skills/，已无用）
- `scripts/generate-skills-index.mjs` — 更新 `SKILLS_DIR` 指向 `path.join(os.homedir(), 'perfect21/zenithjoy-skills')`

### Engine 工具
- `packages/engine/scripts/bump-version.sh` — 删 `SKILL_MD` 变量及 `update_skill_md` 调用（Engine version bump 由 6 文件联动降至 5 文件）
- `packages/engine/scripts/devgate/check-engine-hygiene.cjs` — 删 Check 4 里 `packages/engine/skills/dev/SKILL.md` 版本同步目标

### CI
- `.github/workflows/ci.yml:322-330` — 删除 feature-registry skill 目录 guard（目录不再存在）
- `.github/workflows/harness-v5-checks.yml` — 删除 `paths` filter 里的 `packages/workflows/skills/**` 条目

### 配置 & 合同
- `packages/engine/config/required-dev-paths.yml:18` — 删除 `packages/engine/skills/dev/` 条目
- `packages/engine/regression-contract.yaml:2981` — 删除 S4-001 intent-expand 存在性断言
- `packages/workflows/regression-contract.yaml:31` — 删除 weibo-publisher 测试路径条目
- `packages/quality/contracts/cecelia-module-boundaries.yaml:82` — 更新 provider 字段为 zenithjoy-skills

### 删除目录
- `packages/workflows/skills/` — git rm 全部 59 个 skill 目录
- `packages/engine/skills/` — git rm 全部 3 个 skill 目录（dev、engine-ship、engine-worktree）

## 测试策略

- **Unit**：`harness-shared.test.js` 测试 `loadSkillContent` 返回空串（文件不存在时）— 继续通过 ✅
- **Unit**：`await-callback-retry.test.js` — 改为 inline 断言 ✅
- **CI**：brain-unit 全套跑通（所有 skill 调用均已 mock）
- **本机验证**：`loadSkillContent('harness-generator')` 通过 `~/.claude/skills` 软链接找到 zenithjoy-skills 里的文件

## 成功标准

- `packages/workflows/skills/` 和 `packages/engine/skills/` 从 git 历史删除
- `harness-shared.js` 不再有 `packages/workflows/skills` 路径
- brain-unit CI 全绿
- Engine version bump 脚本正常（5 文件联动）
