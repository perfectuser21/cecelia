# Skill Repo 完全解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 cecelia 彻底删除 `packages/workflows/skills/` 和 `packages/engine/skills/`，修复所有依赖这些路径的代码、测试、脚本和配置。

**Architecture:** Skill 文件已迁移到独立 repo `zenithjoy-skills`，本机 `~/.claude/skills/` 103 个软链接全部指向新 repo。本 PR 清理 cecelia 里的冗余副本，并修复所有引用这些路径的下游代码（运行时代码、测试、CI、DevGate 工具）。

**Tech Stack:** Node.js ESM、bash、YAML、vitest

**工作目录:** `/Users/administrator/worktrees/cecelia/skill-repo-decouple`

---

### Task 1: 修复 await-callback-retry.test.js（删除依赖文件系统的测试）

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/await-callback-retry.test.js:27-33`

这个测试读取 `harness-generator/SKILL.md` 真实文件。删除 skill 目录后会 ENOENT 崩溃。最干净的修复：删除此测试——skill 内容规则属于 zenithjoy-skills repo 的职责。

- [ ] **Step 1: 读当前文件确认上下文**

```bash
sed -n '1,15p' packages/brain/src/workflows/__tests__/await-callback-retry.test.js
sed -n '25,40p' packages/brain/src/workflows/__tests__/await-callback-retry.test.js
```

- [ ] **Step 2: 删除该测试块（第 27-33 行）**

找到并删除这段：

```javascript
  it('harness-generator/SKILL.md 含 GREEN 前真验 manual:bash 规则', () => {
    const skillSrc = readFileSync(
      resolve(__dirname, '../../../../../packages/workflows/skills/harness-generator/SKILL.md'),
      'utf8'
    );
    expect(skillSrc).toMatch(/all_behaviors_passed|GREEN.*真验.*manual:bash|GREEN.*前.*合同.*manual/i);
  });
```

同时检查文件顶部的 import，如果 `readFileSync` / `resolve` 只被这一个测试用，也一并删除对应 import 行。

- [ ] **Step 3: 运行该测试文件确认通过**

```bash
npx vitest run packages/brain/src/workflows/__tests__/await-callback-retry.test.js --reporter=verbose
```

期望：所有 `it(...)` PASS，无 ENOENT 错误。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/workflows/__tests__/await-callback-retry.test.js
git commit -m "test(harness): 删除依赖 packages/workflows/skills 文件路径的测试

skill 已迁移到 zenithjoy-skills repo，cross-repo 文件内容测试不应在 cecelia CI 中维护

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 更新 harness-shared.js — 删除 packages/workflows/skills fallback

**Files:**
- Modify: `packages/brain/src/harness-shared.js:29-39`

- [ ] **Step 1: 定位当前 SKILL_SEARCH_DIRS**

```bash
sed -n '28,42p' packages/brain/src/harness-shared.js
```

- [ ] **Step 2: 删除第 4 个搜索路径及其注释**

把这段：

```javascript
// ─── Skill 内联加载 ──────────────────────────────────────────────────────────
// Docker 容器里 Claude Code headless (-p) 模式不识别 `/skill-name` 语法，
// 必须把 SKILL.md 原文内联到 prompt 里，Claude 才能按 skill 指令工作。
//
// 搜索顺序:
// 1-3. host 上 ~/.claude*/skills 的 symlink（开发本机 + brain runtime）
// 4. monorepo 内 packages/workflows/skills（CI / 任何 git checkout 都有，无 home 依赖）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_SEARCH_DIRS = [
  path.join(os.homedir(), '.claude-account1', 'skills'),
  path.join(os.homedir(), '.claude-account2', 'skills'),
  path.join(os.homedir(), '.claude', 'skills'),
  // packages/brain/src/ → packages/workflows/skills/
  path.resolve(__dirname, '..', '..', 'workflows', 'skills'),
];
```

改为：

```javascript
// ─── Skill 内联加载 ──────────────────────────────────────────────────────────
// Docker 容器里 Claude Code headless (-p) 模式不识别 `/skill-name` 语法，
// 必须把 SKILL.md 原文内联到 prompt 里，Claude 才能按 skill 指令工作。
//
// 搜索顺序（~/.claude/skills 软链接指向 zenithjoy-skills repo）:
// 1-3. host 上 ~/.claude*/skills 的 symlink（开发本机 + brain runtime）
const SKILL_SEARCH_DIRS = [
  path.join(os.homedir(), '.claude-account1', 'skills'),
  path.join(os.homedir(), '.claude-account2', 'skills'),
  path.join(os.homedir(), '.claude', 'skills'),
];
```

同时删除不再使用的 import：`fileURLToPath` 和 `__filename`、`__dirname`（如果这是它们唯一的使用场合）。检查：

```bash
grep -n "__filename\|__dirname\|fileURLToPath" packages/brain/src/harness-shared.js
```

如果其他地方也用到则保留。

- [ ] **Step 3: 运行 harness-shared 单元测试**

```bash
npx vitest run packages/brain/src/__tests__/harness-shared.test.js --reporter=verbose
```

期望：`loadSkillContent 返回字符串（缺文件时返回空字符串而非抛错）` 等测试 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/harness-shared.js
git commit -m "refactor(brain): 删除 harness-shared.js 中 packages/workflows/skills fallback 路径

skill 已迁移到 zenithjoy-skills，~/.claude/skills 软链接覆盖本机和 brain runtime 场景

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: 更新 bump-version.sh — 6 文件降为 5 文件

**Files:**
- Modify: `packages/engine/scripts/bump-version.sh`

Engine version bump 目前联动 6 个文件，其中一个是 `packages/engine/skills/dev/SKILL.md`，删除 skill 目录后该文件消失，需从 bump 脚本中移除。

- [ ] **Step 1: 删除 SKILL_MD 变量定义（第 54 行）**

删除：

```bash
SKILL_MD="$ENGINE_DIR/skills/dev/SKILL.md"
```

- [ ] **Step 2: 从 for 循环中移除 SKILL_MD（第 119 行）**

把：

```bash
for f in "$VERSION_FILE" "$PACKAGE_JSON" "$HOOK_CORE_VERSION" "$HOOKS_VERSION" "$SKILL_MD" "$REGRESSION_YAML"; do
```

改为：

```bash
for f in "$VERSION_FILE" "$PACKAGE_JSON" "$HOOK_CORE_VERSION" "$HOOKS_VERSION" "$REGRESSION_YAML"; do
```

- [ ] **Step 3: 删除 update_skill_md 函数（约第 213-240 行）**

删除整个函数定义（从 `update_skill_md() {` 到对应的 `}`）。

- [ ] **Step 4: 删除 case 分支中的 SKILL_MD 处理（约第 279-281 行）**

删除：

```bash
      "$SKILL_MD")
        update_skill_md "$f"
        ;;
```

- [ ] **Step 5: 更新文件顶部注释（如有提及 6 文件或 SKILL_MD）**

```bash
grep -n "SKILL_MD\|skills/dev\|6.*文件\|6 file" packages/engine/scripts/bump-version.sh
```

找到并删除/修改相关注释行。

- [ ] **Step 6: 验证脚本 dry-run**

```bash
bash packages/engine/scripts/bump-version.sh patch --dry-run 2>&1 | head -30
```

期望：无 SKILL_MD 相关 WARN 或错误，列出 5 个文件。

- [ ] **Step 7: Commit**

```bash
git add packages/engine/scripts/bump-version.sh
git commit -m "chore(engine): bump-version.sh 删除 SKILL_MD 联动（6 文件→5 文件）

packages/engine/skills/dev/SKILL.md 随 skill 迁移到 zenithjoy-skills 而删除

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 更新 check-engine-hygiene.cjs — 删除 SKILL.md 版本同步目标

**Files:**
- Modify: `packages/engine/scripts/devgate/check-engine-hygiene.cjs`

- [ ] **Step 1: 定位版本同步文件列表**

```bash
sed -n '255,280p' packages/engine/scripts/devgate/check-engine-hygiene.cjs
```

- [ ] **Step 2: 删除 skills/dev/SKILL.md 条目**

找到并删除：

```javascript
    {
      name: 'skills/dev/SKILL.md',
      rel: 'packages/engine/skills/dev/SKILL.md',
      read: getVersionSkillFrontmatter,
    },
```

同时检查 `getVersionSkillFrontmatter` 函数是否还被其他地方用到，如果只在这里用，一并删除：

```bash
grep -n "getVersionSkillFrontmatter" packages/engine/scripts/devgate/check-engine-hygiene.cjs
```

- [ ] **Step 3: 更新注释中提到的文件数量（如有）**

```bash
grep -n "5.*文件\|6.*文件\|skills/dev/SKILL" packages/engine/scripts/devgate/check-engine-hygiene.cjs | head -10
```

更新相关注释。

- [ ] **Step 4: 运行 hygiene check 验证**

```bash
node packages/engine/scripts/devgate/check-engine-hygiene.cjs 2>&1 | tail -20
```

期望：Check 4 (版本同步) 通过，不报 skills/dev/SKILL.md 缺失错误。

- [ ] **Step 5: Commit**

```bash
git add packages/engine/scripts/devgate/check-engine-hygiene.cjs
git commit -m "chore(engine): check-engine-hygiene 删除 skills/dev/SKILL.md 版本同步目标

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: 更新 CI 文件

**Files:**
- Modify: `.github/workflows/ci.yml:318-331`
- Modify: `.github/workflows/harness-v5-checks.yml:8,9,18,19`

**ci.yml — 删除 feature-registry skill 目录 guard：**

- [ ] **Step 1: 定位并删除 Feature Registry 同步检查 step**

```bash
sed -n '315,335p' .github/workflows/ci.yml
```

删除整个 `- name: Feature Registry 同步检查` step（约 13 行），因为 `packages/engine/skills/` 目录已不存在，guard 永远不会触发。

- [ ] **Step 2: 更新 harness-v5-checks.yml paths filter**

```bash
sed -n '5,25p' .github/workflows/harness-v5-checks.yml
```

删除 paths 下的两行：

```yaml
      - 'packages/workflows/skills/harness-contract-*/SKILL.md'
      - 'packages/workflows/skills/harness-generator/SKILL.md'
```

以及对应的注释行（第 8、9 行）：

```yaml
#   - packages/workflows/skills/harness-contract-*/SKILL.md
#   - packages/workflows/skills/harness-generator/SKILL.md
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/harness-v5-checks.yml
git commit -m "ci: 删除 packages/engine/skills/ guard 和 workflows/skills paths filter

skill 目录已迁移到 zenithjoy-skills repo

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: 更新配置和合同文件

**Files:**
- Modify: `packages/engine/config/required-dev-paths.yml`
- Modify: `packages/engine/regression-contract.yaml`
- Modify: `packages/workflows/regression-contract.yaml`
- Modify: `packages/quality/contracts/cecelia-module-boundaries.yaml`

- [ ] **Step 1: required-dev-paths.yml — 删除 packages/engine/skills/dev/ 条目**

```bash
grep -n "engine/skills" packages/engine/config/required-dev-paths.yml
```

删除 `- packages/engine/skills/dev/` 及其注释行。

- [ ] **Step 2: engine/regression-contract.yaml — 删除 S4-001 断言**

```bash
sed -n '2975,2990p' packages/engine/regression-contract.yaml
```

找到并删除 `intent-expand/SKILL.md` 存在性断言条目（整个 feature 条目块）。

- [ ] **Step 3: workflows/regression-contract.yaml — 删除 weibo-publisher 测试路径**

```bash
sed -n '28,35p' packages/workflows/regression-contract.yaml
```

找到并删除 `node --test packages/workflows/skills/weibo-publisher/...` 那行的整个条目。

- [ ] **Step 4: cecelia-module-boundaries.yaml — 更新 provider 字段**

```bash
grep -n "workflows/skills" packages/quality/contracts/cecelia-module-boundaries.yaml
```

把 `provider: packages/workflows/skills/` 改为 `provider: github.com/perfectuser21/zenithjoy-skills`。

- [ ] **Step 5: Commit**

```bash
git add packages/engine/config/required-dev-paths.yml \
        packages/engine/regression-contract.yaml \
        packages/workflows/regression-contract.yaml \
        packages/quality/contracts/cecelia-module-boundaries.yaml
git commit -m "chore: 更新配置和合同文件，移除 packages/workflows/skills 路径引用

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: 更新 generate-skills-index.mjs 和删除 deploy-workflow-skills.sh

**Files:**
- Modify: `scripts/generate-skills-index.mjs`
- Delete: `packages/workflows/scripts/deploy-workflow-skills.sh`

- [ ] **Step 1: 更新 generate-skills-index.mjs 的 SKILLS_DIR**

```bash
sed -n '20,30p' scripts/generate-skills-index.mjs
```

把：

```javascript
const SKILLS_DIR = join(PROJECT_ROOT, 'packages/workflows/skills');
```

改为：

```javascript
const SKILLS_DIR = join(os.homedir(), 'perfect21/zenithjoy-skills');
```

同时在文件顶部加 `import os from 'os';`（如果还没有）。

- [ ] **Step 2: 验证脚本可运行**

```bash
node scripts/generate-skills-index.mjs --dry-run 2>&1 | head -20
# 或直接运行看效果
node scripts/generate-skills-index.mjs 2>&1 | head -30
```

期望：能扫描 `~/perfect21/zenithjoy-skills/` 下的 skill 目录。

- [ ] **Step 3: 删除 deploy-workflow-skills.sh**

```bash
git rm packages/workflows/scripts/deploy-workflow-skills.sh
```

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-skills-index.mjs
git commit -m "chore: generate-skills-index 指向 zenithjoy-skills，删除 deploy-workflow-skills.sh

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: git rm 删除所有 skill 目录

**Files:**
- Delete: `packages/workflows/skills/`（59 个目录）
- Delete: `packages/engine/skills/`（3 个目录：dev、engine-ship、engine-worktree）

- [ ] **Step 1: 确认删除前 CI 相关测试通过**

```bash
npx vitest run packages/brain/src/__tests__/harness-shared.test.js \
              packages/brain/src/workflows/__tests__/await-callback-retry.test.js \
              --reporter=verbose
```

期望：全部 PASS。

- [ ] **Step 2: git rm workflows/skills**

```bash
git rm -r packages/workflows/skills/
```

期望：59 个目录全部从 git 移除。

- [ ] **Step 3: git rm engine/skills**

```bash
git rm -r packages/engine/skills/
```

期望：dev、engine-ship、engine-worktree 3 个目录移除。

- [ ] **Step 4: 确认工作区干净**

```bash
git status | grep -E "workflows/skills|engine/skills" | head -5
ls packages/workflows/skills/ 2>&1  # 期望：No such file or directory
ls packages/engine/skills/ 2>&1     # 期望：No such file or directory
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 删除 packages/workflows/skills/ 和 packages/engine/skills/

skill 完全迁移到 github.com/perfectuser21/zenithjoy-skills
~/.claude/skills/ 103 个软链接已指向新 repo

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Engine 版本 bump + feature-registry 更新

**Files:**
- Modify: `packages/engine/package.json`（版本号）
- Modify: `packages/engine/package-lock.json`
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/regression-contract.yaml`（已在 Task 6 改过）
- Modify: `packages/engine/feature-registry.yml`

PR title 必须含 `[CONFIG]`（删除 skill 目录属于 Engine 配置变更）。

- [ ] **Step 1: 运行 bump-version.sh patch**

```bash
bash packages/engine/scripts/bump-version.sh patch
```

期望：5 个文件版本号同步更新（package.json、package-lock.json、VERSION、.hook-core-version、regression-contract.yaml）。

- [ ] **Step 2: 在 feature-registry.yml 新增 changelog 条目**

```bash
# 查当前最新条目格式
tail -20 packages/engine/feature-registry.yml
```

在 `changelog` 下新增（格式与现有条目一致）：

```yaml
  - version: "X.Y.Z"  # 替换为 bump 后的版本号
    date: "2026-05-28"
    description: "Skill 目录从 cecelia 完全剥离。packages/workflows/skills/ 和 packages/engine/skills/ 删除，skill 迁移到 zenithjoy-skills repo。harness-shared.js SKILL_SEARCH_DIRS 移除 monorepo fallback，bump-version.sh 由 6 文件降为 5 文件联动。"
```

- [ ] **Step 3: 运行 generate-path-views.sh**

```bash
bash packages/engine/scripts/generate-path-views.sh
```

- [ ] **Step 4: 运行 DevGate 验证**

```bash
node packages/engine/scripts/devgate/check-engine-hygiene.cjs 2>&1 | tail -20
node scripts/facts-check.mjs 2>&1 | tail -10
bash scripts/check-version-sync.sh 2>&1 | tail -10
```

期望：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/engine/package.json packages/engine/package-lock.json \
        packages/engine/VERSION packages/engine/.hook-core-version \
        packages/engine/regression-contract.yaml \
        packages/engine/feature-registry.yml
# 如果 generate-path-views.sh 有输出文件
git add -A
git commit -m "[CONFIG] chore(engine): vX.Y.Z — skill 目录完全剥离，SKILL_SEARCH_DIRS 清理

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 10: 全套测试 + Learning

**Files:**
- Create: `docs/learnings/cp-0528HHMM-skill-repo-decouple.md`

- [ ] **Step 1: 跑完整 brain-unit**

```bash
npx vitest run packages/brain/src/ --reporter=verbose 2>&1 | tail -30
```

期望：全绿，无 ENOENT 或 skill path 相关错误。

- [ ] **Step 2: 跑 DevGate 全套**

```bash
node packages/engine/scripts/devgate/check-engine-hygiene.cjs
node packages/engine/scripts/devgate/check-dod-mapping.cjs
bash scripts/check-version-sync.sh
```

期望：全部 PASS。

- [ ] **Step 3: 写 Learning 文件**

创建 `docs/learnings/cp-0528HHMM-skill-repo-decouple.md`（把 HHMM 替换为实际时间）：

```markdown
# Learning: Skill Repo 完全解耦

### 根本原因
skill 文件长期混在 cecelia monorepo 里（packages/workflows/skills/ + packages/engine/skills/），
导致：(1) AI agent 在 main 分支直接改 skill，stash 积累；(2) CI 和本机用两套 skill；
(3) bump-version.sh 联动 SKILL.md，每次 Engine 版本 bump 都要带上 skill 文件。

### 下次预防
- [ ] skill 改动统一在 zenithjoy-skills repo commit，不允许在 cecelia 里有 skill 目录
- [ ] Engine version bump 是 5 文件联动：package.json / package-lock.json / VERSION / .hook-core-version / regression-contract.yaml
- [ ] harness-shared.js SKILL_SEARCH_DIRS 只有 3 条（~/.claude-account*/skills + ~/.claude/skills）
```

- [ ] **Step 4: Commit Learning**

```bash
git add docs/learnings/cp-0528HHMM-skill-repo-decouple.md
git commit -m "docs(learning): skill repo 解耦根因与预防

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
