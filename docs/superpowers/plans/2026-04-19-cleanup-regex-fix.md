# Cleanup Regex Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `.github/workflows/cleanup-merged-artifacts.yml` 的正则失配（只匹配旧命名 `.prd-*/.task-*`，漏掉新命名 `DoD.cp-*/PRD.cp-*/TASK_CARD.cp-*`），并一次性清理根目录已积累的 40 个遗留文件。

**Architecture:** 改 1 行 YAML 的 grep 正则 + 单个 commit 批量 `git rm` 根目录垃圾。不引入新文件、不改 workflow 运行时机。

**Tech Stack:** GitHub Actions workflow YAML + bash grep + git。

---

## File Structure

- **Modify:** `.github/workflows/cleanup-merged-artifacts.yml:28` — 唯一一行代码改动
- **Delete:** 根目录下 ~40 个文件，具体为：
  - `DoD.cp-*.md` × 24
  - `PRD.cp-*.md` × 6
  - `TASK_CARD.cp-*.md` × 9
  - `DoD.md.bak` × 1
- **Not touched:**
  - `DoD.md`、`PRD.md`（活跃 PR 用）
  - `.dev-seal.*` / `.dev-gate-*`（stop hook 责任，另议）
  - `packages/engine/hooks/branch-protect.sh.bak`（engine 遗留，另议）
  - `docs/learnings/*`（归档策略另议）

---

### Task 1: 添加 workflow 正则单元测试

**Files:**
- Create: `tests/workflow-regex.test.js`

- [ ] **Step 1: Write the failing test**

创建 `tests/workflow-regex.test.js`：

```javascript
import { test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const WORKFLOW_PATH = '.github/workflows/cleanup-merged-artifacts.yml';

function extractRegex() {
  const content = readFileSync(WORKFLOW_PATH, 'utf8');
  // 提取 grep -E "..." 中的正则字面量
  const m = content.match(/grep\s+-E\s+["']([^"']+)["']/);
  if (!m) throw new Error('no grep -E regex found in workflow');
  return m[1];
}

function matches(regex, filename) {
  // 用 node 的 ERE-兼容检测（grep -E 用 POSIX ERE，JS RegExp 是 PCRE 子集，
  // 对本用例的字面量 + | + () 足够兼容）
  return new RegExp(regex).test(filename);
}

test('regex 匹配新命名 DoD.cp-*.md', () => {
  const re = extractRegex();
  expect(matches(re, 'DoD.cp-04050716-448791a8.md')).toBe(true);
});

test('regex 匹配新命名 PRD.cp-*.md', () => {
  const re = extractRegex();
  expect(matches(re, 'PRD.cp-04131520-langgraph-harness.md')).toBe(true);
});

test('regex 匹配新命名 TASK_CARD.cp-*.md', () => {
  const re = extractRegex();
  expect(matches(re, 'TASK_CARD.cp-04050413-88c13be1.md')).toBe(true);
});

test('regex 向后兼容旧命名 .prd-*', () => {
  const re = extractRegex();
  expect(matches(re, '.prd-old-task.md')).toBe(true);
});

test('regex 向后兼容旧命名 .task-*', () => {
  const re = extractRegex();
  expect(matches(re, '.task-old-task.md')).toBe(true);
});

test('regex 不误匹配活跃文件 DoD.md', () => {
  const re = extractRegex();
  expect(matches(re, 'DoD.md')).toBe(false);
});

test('regex 不误匹配活跃文件 PRD.md', () => {
  const re = extractRegex();
  expect(matches(re, 'PRD.md')).toBe(false);
});

test('regex 不误匹配 README.md', () => {
  const re = extractRegex();
  expect(matches(re, 'README.md')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
npx vitest run tests/workflow-regex.test.js
```

Expected: 3 个新命名测试 FAIL（`DoD.cp-*`、`PRD.cp-*`、`TASK_CARD.cp-*` 不被当前正则匹配），旧命名和不匹配用例可能 PASS。

- [ ] **Step 3: Commit failing test**

```bash
git add tests/workflow-regex.test.js
git commit -m "test: add regex coverage for cleanup workflow artifact names"
```

---

### Task 2: 修复 workflow 正则

**Files:**
- Modify: `.github/workflows/cleanup-merged-artifacts.yml:28`

- [ ] **Step 1: 替换第 28 行 grep 正则**

将：

```bash
          FILES=$(git ls-files | grep -E "^\.(prd|task)-" || true)
```

替换为：

```bash
          FILES=$(git ls-files | grep -E '^(\.prd-|\.task-|DoD\.cp-|PRD\.cp-|TASK_CARD\.cp-)' || true)
```

说明：
- 向后兼容：`\.prd-` / `\.task-`（旧命名，防止历史 PR 合并时漏清）
- 新命名：`DoD\.cp-` / `PRD\.cp-` / `TASK_CARD\.cp-`
- 不匹配：`DoD.md` / `PRD.md`（无 `.cp-`）

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
npx vitest run tests/workflow-regex.test.js
```

Expected: 全部 8 条 test PASS。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cleanup-merged-artifacts.yml
git commit -m "fix(ci): cleanup-merged-artifacts regex 兼容新命名 DoD/PRD/TASK_CARD.cp-*"
```

---

### Task 3: 批量清理根目录历史垃圾

**Files:**
- Delete: 根目录下约 40 个文件（cp- 系列 + 1 个 .bak）

- [ ] **Step 1: 枚举待删文件（先预览再删）**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
git ls-files | grep -E '^(DoD|PRD|TASK_CARD)\.cp-.*\.md$'
git ls-files | grep -E '^DoD\.md\.bak$'
```

Expected: 打印具体文件列表。核对不在列表中的应有：`DoD.md`、`PRD.md`、`README.md`、`DEFINITION.md`、`AGENTS.md`。

- [ ] **Step 2: 执行删除**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
git ls-files | grep -E '^(DoD|PRD|TASK_CARD)\.cp-.*\.md$' | xargs -I {} git rm {}
git ls-files | grep -E '^DoD\.md\.bak$' | xargs -I {} git rm {}
```

Expected: `rm 'DoD.cp-...'` 逐行输出。

- [ ] **Step 3: 验证删除完成**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
git ls-files | grep -cE '^(DoD|PRD|TASK_CARD)\.cp-'
```

Expected: `0`

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
git ls-files | grep -q '^DoD\.md\.bak$'; echo "exit=$?"
```

Expected: `exit=1`（grep 未匹配）

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
ls DoD.md PRD.md README.md DEFINITION.md 2>&1
```

Expected: 4 个文件都还在。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
git commit -m "chore(cleanup): 批量清理根目录 cp- 系列遗留 md 与 DoD.md.bak（40 个）"
```

---

### Task 4: 补齐 PRD / DoD（本 PR 自身要过 CI）

**Files:**
- Create: `PRD.md`
- Create: `DoD.md`
- Create: `docs/learnings/cp-0419210352-cleanup-regex-fix.md`

- [ ] **Step 1: 写 PRD.md（本分支）**

```markdown
# PRD: cleanup-merged-artifacts regex 修复 + 根目录垃圾清理

## 背景
`.github/workflows/cleanup-merged-artifacts.yml` 第 28 行 grep 正则只匹配旧命名 `.prd-*/.task-*`，但实际命名已改为 `DoD.cp-*.md / PRD.cp-*.md / TASK_CARD.cp-*.md`，导致根目录 30 天未被清理，积累约 40 个遗留 md。

## 成功标准
1. workflow 正则兼容新旧两种命名。
2. 根目录已积累的 40 个 cp- 系列 md + DoD.md.bak 一次性删除。
3. `DoD.md` / `PRD.md`（活跃 PR 使用）不动。
4. 新增的 workflow 正则单元测试全部通过。

## 非目标（YAGNI）
- 不处理 `.dev-seal.*` / `.dev-gate-*` 残留（stop hook 责任）
- 不处理 docs/learnings/ 归档
- 不改 workflow 触发时机
```

- [ ] **Step 2: 写 DoD.md（本分支）**

```markdown
# DoD: cleanup-regex-fix

contract_branch: cp-0419210352-cleanup-regex-fix
workstream_index: 1

- [x] [ARTIFACT] workflow 正则修复
  File: .github/workflows/cleanup-merged-artifacts.yml
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/cleanup-merged-artifacts.yml','utf8');if(!/DoD\\.cp-/.test(c)||!/PRD\\.cp-/.test(c)||!/TASK_CARD\\.cp-/.test(c))process.exit(1)"

- [x] [ARTIFACT] 根目录 cp- 系列 md 已清理
  Test: manual:node -e "const {execSync}=require('child_process');const out=execSync('git ls-files').toString();const n=(out.match(/^(DoD|PRD|TASK_CARD)\\.cp-.*\\.md$/gm)||[]).length;if(n!==0){console.error('残留',n,'个');process.exit(1)}"

- [x] [ARTIFACT] DoD.md.bak 已清理
  Test: manual:node -e "const {execSync}=require('child_process');const out=execSync('git ls-files').toString();if(/^DoD\\.md\\.bak$/m.test(out))process.exit(1)"

- [x] [ARTIFACT] 活跃文件未被误删
  Test: manual:node -e "const fs=require('fs');for(const f of ['DoD.md','PRD.md','README.md','DEFINITION.md']){if(!fs.existsSync(f)){console.error(f,'丢失');process.exit(1)}}"

- [x] [BEHAVIOR] 正则单元测试全部通过
  Test: tests/workflow-regex.test.js
```

- [ ] **Step 3: 写 Learning 文件**

```markdown
# cleanup-regex-fix（2026-04-19）

### 根本原因

`cleanup-merged-artifacts.yml` 的 grep 正则写在 2025/2026 年初的旧命名约定上（`.prd-*` / `.task-*`），后来 PR artifact 文件名统一改成大写 `DoD.cp-* / PRD.cp-* / TASK_CARD.cp-*`（无前导点），但 workflow 没有被同步更新。正则失配后，workflow 每次 push 都输出"✅ 无残留"跳过，实际根目录积累约 40 个遗留文件，30 天未清理。

### 下次预防

- [ ] 命名约定变更（文件前缀 / 后缀）时，必须全仓 grep 搜索旧命名的所有引用，特别是 `.github/workflows/` 下任何 bash `grep/find/ls` 命令
- [ ] workflow 里的文件名模式匹配应该有配对的单元测试（本 PR 引入 `tests/workflow-regex.test.js` 作模板）
- [ ] cleanup-merged-artifacts 输出"无残留，跳过"时，至少每月抽查一次根目录实际状态，不是看 workflow 绿就假设健康
```

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
git add PRD.md DoD.md docs/learnings/cp-0419210352-cleanup-regex-fix.md
git commit -m "docs: add PRD/DoD/Learning for cleanup-regex-fix"
```

---

### Task 5: 最终验证

- [ ] **Step 1: 本地跑所有测试**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
npx vitest run tests/workflow-regex.test.js
```

Expected: 8/8 PASS。

- [ ] **Step 2: 确认 git 状态干净**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
git status
```

Expected: `nothing to commit, working tree clean`（除 `.dev-lock.cp-*` 之类的忽略文件）

- [ ] **Step 3: 确认最终提交链**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cleanup-regex-fix
git log main..HEAD --oneline
```

Expected: 4 条 commit（design / test / fix / cleanup 或 docs 合并）

---

## Self-Review Notes

**Spec coverage check:**
- ✅ 设计"改动 1：正则修复" → Task 2
- ✅ 设计"改动 2：一次性清理 40 个文件" → Task 3
- ✅ 设计"不动 DoD.md/PRD.md" → Task 3 Step 3 验证
- ✅ 设计"ARTIFACT + BEHAVIOR 验证" → Task 4 DoD 文件覆盖

**Placeholder check:** 所有 step 均含具体代码/命令。无 TBD。

**Type consistency:** 只有 JS 正则和 bash 命令，无跨 task 类型依赖。
