# H9 harness-planner push noise 静默 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: `packages/workflows/skills/harness-planner/SKILL.md:151` 改 `git push origin HEAD` → `git push origin HEAD 2>/dev/null || echo "[harness-planner] push skipped (no creds), commit retained on local branch"`，让 push 失败时整体 exit 0 不 abort SKILL。

**Architecture**: 单行 SKILL.md 改动。SKILL.md 是 LLM 跟着读的 prompt，没有运行时执行入口；测试通过 vitest 提取 SKILL.md Step 3 bash 块、抽 push 单行、临时目录 mock `git` 二进制让 `git push` 退 1，验证 fallback 整体 exit 0 + stdout 含 `push skipped`。

**Tech Stack**: bash / vitest / node child_process

**Spec**: `docs/superpowers/specs/2026-05-09-h9-planner-push-noise-design.md`

**Brain task**: 5fae603d-6f14-4f84-8838-5121a1b1dd97

---

## File Structure

- **Create**: `cp-0509143630-h9-planner-push-noise.prd.md`
- **Create**: `cp-0509143630-h9-planner-push-noise.dod.md`
- **Create**: `tests/skills/harness-planner-push-noise.test.js`
- **Modify**: `packages/workflows/skills/harness-planner/SKILL.md` 第 151 行（单行）
- **Create**: `docs/learnings/cp-0509143630-h9-planner-push-noise.md`

---

### Task 1: PRD + DoD docs（commit 1）

**Files**:
- Create: `cp-0509143630-h9-planner-push-noise.prd.md`
- Create: `cp-0509143630-h9-planner-push-noise.dod.md`

- [ ] **Step 1.1**：写 PRD（worktree 根目录）

```markdown
# PRD: H9 harness-planner SKILL push noise 静默

**Brain task**: 5fae603d-6f14-4f84-8838-5121a1b1dd97
**Spec**: docs/superpowers/specs/2026-05-09-h9-planner-push-noise-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1

## 背景

planner 容器无 push creds。SKILL.md:151 `git push origin HEAD` 失败被 set -e 中断，Brain 把 planner 节点判为 fail，但 sprint-prd.md 已 commit 到共享 worktree，proposer 直接读文件即可。14h 5 次跑全被这条假错误误导。

## 修法

SKILL.md:151：`git push origin HEAD` → `git push origin HEAD 2>/dev/null || echo "[harness-planner] push skipped (no creds), commit retained on local branch"`。

push 失败 → echo fallback → 整体退出码 0 → SKILL 继续走完。

## 成功标准

- planner 容器 stdout 不再恒含 `fatal: could not read Username`
- planner 节点 status=success（不被 push 失败打挂）
- 有 creds 时 push 成功路径不变（fallback echo 不打）

## 不做

- 不引入 push creds
- 不改其他 SKILL push 行为
- 不重设计 sprint-prd.md 传递机制
```

- [ ] **Step 1.2**：写 DoD

```markdown
# DoD: H9 harness-planner SKILL push noise 静默

## 验收清单

- [ ] [BEHAVIOR] SKILL Step 3 git push 失败时整体 exit=0 且 stdout 含 fallback
  Test: tests/skills/harness-planner-push-noise.test.js

- [ ] [BEHAVIOR] SKILL Step 3 git push 成功时不打 fallback echo（无噪音）
  Test: tests/skills/harness-planner-push-noise.test.js

- [ ] [ARTIFACT] SKILL.md:151 含 2>/dev/null + || echo + push skipped
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!/git push origin HEAD 2>\/dev\/null \|\| echo.*push skipped/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/skills/harness-planner-push-noise.test.js')"

## Learning

文件: docs/learnings/cp-0509143630-h9-planner-push-noise.md

## 测试命令

​```bash
npx vitest run tests/skills/harness-planner-push-noise.test.js
​```
```

- [ ] **Step 1.3**：commit

```bash
cd /Users/administrator/worktrees/cecelia/h9-planner-push-noise
git add cp-0509143630-h9-planner-push-noise.prd.md cp-0509143630-h9-planner-push-noise.dod.md
git commit -m "docs: H9 planner push noise PRD + DoD"
```

---

### Task 2: Failing vitest unit test（commit 2）

**Files**:
- Create: `tests/skills/harness-planner-push-noise.test.js`

- [ ] **Step 2.1**：写测试

```javascript
// SPDX-License-Identifier: MIT
// Test for harness-planner SKILL.md Step 3 git push fallback.
// 目的：保证 planner 容器无 push creds 时 SKILL 不被 set -e 整体打挂。

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKILL_PATH = path.join(REPO_ROOT, 'packages/workflows/skills/harness-planner/SKILL.md');

function extractPushLine() {
  const src = readFileSync(SKILL_PATH, 'utf8');
  // Step 3 bash 块里的 git push 单行
  const m = src.match(/^git push origin HEAD.*$/m);
  if (!m) throw new Error('git push origin HEAD line not found in SKILL.md');
  return m[0];
}

function runWithMockGit({ pushExitCode }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'h9-push-'));

  // mock git 二进制：对 push 子命令返回 pushExitCode，其他子命令 exit 0
  const mockGit = path.join(dir, 'git');
  writeFileSync(
    mockGit,
    `#!/usr/bin/env bash
if [[ "$1" == "push" ]]; then
  echo "fatal: could not read Username for 'https://github.com'" >&2
  exit ${pushExitCode}
fi
exit 0
`,
    'utf8',
  );
  chmodSync(mockGit, 0o755);

  const pushLine = extractPushLine();
  // bash 块开 set -e 模拟 SKILL 实际运行环境（push 失败需要 fallback 兜住）
  const wrapper = `set -e\n${pushLine}\necho "AFTER_PUSH"\n`;

  const result = spawnSync('bash', ['-c', wrapper], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
  });

  return { dir, result };
}

describe('harness-planner SKILL Step 3 push fallback', () => {
  const dirsToCleanup = [];
  afterEach(() => {
    while (dirsToCleanup.length) {
      try { rmSync(dirsToCleanup.pop(), { recursive: true, force: true }); } catch {}
    }
  });

  test('push fail (no creds) → fallback echo 打，整体 exit 0，set -e 不 abort', () => {
    const { dir, result } = runWithMockGit({ pushExitCode: 1 });
    dirsToCleanup.push(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('push skipped');
    expect(result.stdout).toContain('AFTER_PUSH'); // set -e 没 abort
  });

  test('push 成功 → fallback echo 不打（||短路）', () => {
    const { dir, result } = runWithMockGit({ pushExitCode: 0 });
    dirsToCleanup.push(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('push skipped');
    expect(result.stdout).toContain('AFTER_PUSH');
  });

  test('stderr 被 2>/dev/null 吞（不污染容器日志）', () => {
    const { dir, result } = runWithMockGit({ pushExitCode: 1 });
    dirsToCleanup.push(dir);
    expect(result.stderr).not.toContain('fatal: could not read');
  });
});
```

- [ ] **Step 2.2**：跑测试，期待 FAIL（SKILL.md 还没改）

```bash
cd /Users/administrator/worktrees/cecelia/h9-planner-push-noise
mkdir -p tests/skills
npx vitest run tests/skills/harness-planner-push-noise.test.js 2>&1 | tail -15
```

期望：`push fail (no creds)` 测试 FAIL（提取的行不含 fallback → set -e 直接 abort）。

- [ ] **Step 2.3**：commit (commit 1 of TDD pair)

```bash
git add tests/skills/harness-planner-push-noise.test.js
git commit -m "test(skills): add failing test for harness-planner push fallback"
```

---

### Task 3: Modify SKILL.md（commit 3, TDD impl commit）

**Files**:
- Modify: `packages/workflows/skills/harness-planner/SKILL.md` 第 151 行

- [ ] **Step 3.1**：用 Edit tool 改第 151 行

old_string（精确匹配）：
```
git push origin HEAD
```
new_string：
```
git push origin HEAD 2>/dev/null || echo "[harness-planner] push skipped (no creds), commit retained on local branch"
```

- [ ] **Step 3.2**：跑测试，期待全 PASS

```bash
cd /Users/administrator/worktrees/cecelia/h9-planner-push-noise
npx vitest run tests/skills/harness-planner-push-noise.test.js 2>&1 | tail -10
```

期望：3/3 PASS

- [ ] **Step 3.3**：跑 ARTIFACT 检查

```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!/git push origin HEAD 2>\/dev\/null \|\| echo.*push skipped/.test(c))process.exit(1);console.log('ARTIFACT_OK')"
```

期望：`ARTIFACT_OK`

- [ ] **Step 3.4**：commit (commit 2 of TDD pair)

```bash
git add packages/workflows/skills/harness-planner/SKILL.md
git commit -m "fix(workflows): harness-planner SKILL push noise 静默 — push 失败时 fallback 不 abort SKILL"
```

---

### Task 4: DoD checked + Learning（commit 4）

**Files**:
- Modify: `cp-0509143630-h9-planner-push-noise.dod.md`
- Create: `docs/learnings/cp-0509143630-h9-planner-push-noise.md`

- [ ] **Step 4.1**：DoD 4 项 `[ ]` → `[x]`

```bash
sed -i '' 's/- \[ \]/- [x]/g' cp-0509143630-h9-planner-push-noise.dod.md
grep -c '\- \[x\]' cp-0509143630-h9-planner-push-noise.dod.md
```

期望：`4`

- [ ] **Step 4.2**：写 Learning

```markdown
# Learning: H9 — harness-planner SKILL push noise 静默

**PR**: cp-0509143630-h9-planner-push-noise
**Sprint**: langgraph-contract-enforcement / Stage 1

## 现象

W8 acceptance 5 次连跑（v6 → v10），planner 节点 5 次都报 `fatal: could not read Username for 'https://github.com'` 然后整个容器 exit 128。Brain 误判 planner 节点失败，14 小时诊断方向被这条假错误带跑偏。

## 根本原因

planner 容器是 detached docker spawn 的 cecelia-runner，没挂 GitHub OAuth creds。SKILL.md:151 `git push origin HEAD` 失败 → `set -e` 整脚本 abort → 容器 exit 非 0 → Brain 视为节点 fail。但实际上 sprint-prd.md 已 commit 到**共享 worktree**，proposer 节点起来后能直接读文件，**远端 branch 不是必需**。

哲学层根因：SKILL（LLM prompt）当作可执行 spec 时，每条 shell 命令的失败都会被 `set -e` 放大成节点级失败。无副作用必要的命令必须显式带 fallback；否则 SKILL 编辑者隐含赋予 brain "把这条 shell 命令的成功/失败等同于节点的成功/失败"，这往往不是真意图。

## 下次预防

- [ ] 任何 harness SKILL 里的 `git push` / `npm publish` / 远端写操作命令，必须带 `|| echo fallback` 或 `|| true` 兜底，让 SKILL 退到本地副本继续走（除非 push 是节点定义的核心副作用）
- [ ] PR review 时 grep `git push` / `gh pr create` / `npm publish` 在 SKILL.md 里的出现，问"无 creds 该怎样"
- [ ] 长期：harness 节点契约应明确"必须 push 才算节点完成"还是"commit 到共享 worktree 即可"，避免隐式假设
```

- [ ] **Step 4.3**：commit

```bash
git add cp-0509143630-h9-planner-push-noise.dod.md docs/learnings/cp-0509143630-h9-planner-push-noise.md
git commit -m "docs: H9 DoD checked + Learning"
```

---

### Task 5: Push + PR + foreground CI wait（controller 做）

略 — controller (我) 在 finishing 阶段做 push、`gh pr create`、`gh pr checks`、ship。

---

## Self-Review

**Spec coverage**：spec §2 修法 → Task 3；§3 不动什么 → Task 3.1 单行 Edit；§4 测试策略两层 → Task 2 (BEHAVIOR) + Task 3.3 (ARTIFACT)；§5 DoD 4 项 → Task 1.2 + Task 4.1；§6 合并后真实证 → 不在本 plan 范围（PR description 提）；§7 不做 → Task 3.1 单行 Edit 严守 ✓

**Placeholder scan**：无 TBD/TODO，每 step 给具体代码/命令/期望输出 ✓

**Type consistency**：`SKILL.md:151` / `tests/skills/harness-planner-push-noise.test.js` / `cp-0509143630-h9-planner-push-noise` 在 spec/plan/PRD/DoD 全部一致 ✓

**TDD iron law**：Task 2 commit-1 = fail test，Task 3 commit-2 = impl，顺序对 ✓
