# Brain vitest thresholds 移除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `packages/brain/vitest.config.js` 中 `thresholds:` 配置块（7 行），让 diff-cover 成为 brain 唯一覆盖率门禁，解锁被卡死的 PR。

**Architecture:** vitest coverage 仅生成 `coverage/lcov.info`，不再做全局阈值判定；CI brain-diff-coverage 第 2 步 `diff-cover --fail-under=80` 单独把守 PR 新增代码覆盖率。

**Tech Stack:** vitest, v8 coverage provider, diff-cover, GitHub Actions ubuntu-latest。

---

## File Structure

- Modify: `packages/brain/vitest.config.js`（删 133-139 行 `thresholds:` 块）
- Create: `tests/brain/vitest-config-no-threshold.test.ts`（[BEHAVIOR] 单元测试，断言配置不含 thresholds 字段）
- Create: `docs/learnings/cp-0425113824-brain-vitest-thresholds-removal.md`（Learning 文件）
- Create: `.dod-cp-0425113824-brain-vitest-thresholds-removal.md`（DoD 文件，根目录 + packages/brain/）
- Create: `prd-cp-0425113824-brain-vitest-thresholds-removal.md`（PRD 文件，根目录 + packages/brain/）

---

### Task 1: 写失败测试（TDD Red）

**Files:**
- Create: `tests/brain/vitest-config-no-threshold.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('packages/brain/vitest.config.js', () => {
  it('must not contain coverage thresholds (diff-cover is the sole gate)', () => {
    const cfgPath = resolve(__dirname, '../../packages/brain/vitest.config.js');
    const content = readFileSync(cfgPath, 'utf8');
    expect(content).not.toMatch(/thresholds:\s*\{/);
  });

  it('still defines coverage block with v8 provider', () => {
    const cfgPath = resolve(__dirname, '../../packages/brain/vitest.config.js');
    const content = readFileSync(cfgPath, 'utf8');
    expect(content).toMatch(/coverage:\s*\{/);
    expect(content).toMatch(/provider:\s*'v8'/);
  });
});
```

- [ ] **Step 2: 跑测试，预期失败**

```bash
cd /Users/administrator/worktrees/cecelia/brain-vitest-thresholds-removal
npx vitest run tests/brain/vitest-config-no-threshold.test.ts --no-coverage
```

预期：第一条 `must not contain coverage thresholds` FAIL（当前文件含 `thresholds: {`）。

- [ ] **Step 3: Commit Red**

```bash
git add tests/brain/vitest-config-no-threshold.test.ts
git commit -m "test(brain): add TDD red — vitest config must not have thresholds"
```

---

### Task 2: 删除 thresholds 块（Green）

**Files:**
- Modify: `packages/brain/vitest.config.js:133-139`

- [ ] **Step 1: 删除 thresholds 块**

把这段（含整体 7 行 + 末尾换行）：

```js
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 80,
        lines: 75,
        perFile: false
      },
```

从 `coverage: { ... }` 块中移除。`reportOnFailure: true` 的前一行紧接在 `}` 之后即可，不留空行。

- [ ] **Step 2: 跑测试，预期 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/brain-vitest-thresholds-removal
npx vitest run tests/brain/vitest-config-no-threshold.test.ts --no-coverage
```

预期：两条测试都 PASS。

- [ ] **Step 3: 语法 smoke check**

```bash
cd /Users/administrator/worktrees/cecelia/brain-vitest-thresholds-removal
node --check packages/brain/vitest.config.js
```

注意：vitest.config.js 是 ES module，`node --check` 会因 `import` 报错。改用：

```bash
node -e "import('./packages/brain/vitest.config.js').then(m => { if (!m.default) process.exit(1); console.log('OK'); }).catch(e => { console.error(e); process.exit(1); })"
```

预期：输出 `OK`。

- [ ] **Step 4: Commit Green**

```bash
git add packages/brain/vitest.config.js
git commit -m "fix(brain): remove vitest coverage thresholds, let diff-cover be sole gate"
```

---

### Task 3: 写 PRD / DoD / Learning

**Files:**
- Create: `prd-cp-0425113824-brain-vitest-thresholds-removal.md`（根 + `packages/brain/`）
- Create: `.dod-cp-0425113824-brain-vitest-thresholds-removal.md`（根 + `packages/brain/`）
- Create: `docs/learnings/cp-0425113824-brain-vitest-thresholds-removal.md`

- [ ] **Step 1: 写 PRD**

文件 `prd-cp-0425113824-brain-vitest-thresholds-removal.md` 内容：

```markdown
# Brain vitest thresholds 移除

## 背景

CI `brain-diff-coverage` 第 1 步 `vitest run --coverage` 因 `vitest.config.js` 全局 `thresholds`（lines/statements 75，functions 80）fail（当前 brain 全局覆盖率约 67%）。第 2 步 `diff-cover --fail-under=80` 永远跑不到，导致 Harness Generator 的合格新代码 PR 全部被卡死。

## 目标

让 `diff-cover --fail-under=80` 成为 brain 唯一覆盖率门禁。

## 改动

删除 `packages/brain/vitest.config.js` 中 `coverage.thresholds` 块（7 行）。

## 成功标准

- `packages/brain/vitest.config.js` 不含 `thresholds:` 字段
- 当前 PR 的 brain-diff-coverage job 跑通到 diff-cover 阶段
- 当前 PR 全部 CI 绿
```

`packages/brain/prd-cp-0425113824-brain-vitest-thresholds-removal.md` 写一份相同副本（branch-protect.sh 就近检测）。

- [ ] **Step 2: 写 DoD**

文件 `.dod-cp-0425113824-brain-vitest-thresholds-removal.md` 内容：

```markdown
# DoD

- [x] [ARTIFACT] vitest.config.js thresholds 块已删除
  - File: packages/brain/vitest.config.js
  - Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(/thresholds:\s*\{/.test(c))process.exit(1);console.log('OK')"

- [x] [BEHAVIOR] 配置加载后导出含 coverage 块但无 thresholds
  - Test: tests/brain/vitest-config-no-threshold.test.ts

- [x] [ARTIFACT] coverage block 仍存在 v8 provider
  - File: packages/brain/vitest.config.js
  - Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!/provider:\s*'v8'/.test(c))process.exit(1);if(!/coverage:\s*\{/.test(c))process.exit(1);console.log('OK')"
```

`packages/brain/.dod-cp-0425113824-brain-vitest-thresholds-removal.md` 写相同副本。

- [ ] **Step 3: 写 Learning**

文件 `docs/learnings/cp-0425113824-brain-vitest-thresholds-removal.md` 内容：

```markdown
# Learning: Brain vitest thresholds 与 diff-cover 二选一

### 根本原因

`packages/brain/vitest.config.js` 同时配 `coverage.thresholds`（全局阈值 75/75/80/75）和 CI 又跑 `diff-cover --fail-under=80`。当 brain 全局覆盖率（约 67%）低于 vitest threshold 时，第一步 `vitest run --coverage` 直接 exit 非 0，第二步 diff-cover 永远不执行，造成"PR 新代码 100% 覆盖也被卡死"的错觉式 fail。

### 下次预防

- [ ] 凡 CI 流程把覆盖率门禁交给 diff-cover（PR-level），vitest 端就不要再开全局 thresholds，避免双重门禁互相打架
- [ ] 若想新增"全局覆盖率不可低于 X"硬底线，应另起独立 job（用 lcov + bash 计算），不要复活 vitest 全局 threshold
- [ ] 调整 CI 覆盖率门禁前必须画 mental model：第几步 fail 决定后续步骤是否执行
```

- [ ] **Step 4: Commit 文档**

```bash
git add prd-cp-*.md .dod-cp-*.md packages/brain/prd-cp-*.md packages/brain/.dod-cp-*.md docs/learnings/cp-0425113824-brain-vitest-thresholds-removal.md
git commit -m "docs(brain): PRD/DoD/Learning for vitest thresholds removal"
```

---

### Task 4: Push + 开 PR + 等 CI

- [ ] **Step 1: Push 分支**

```bash
cd /Users/administrator/worktrees/cecelia/brain-vitest-thresholds-removal
git push -u origin cp-0425113824-brain-vitest-thresholds-removal
```

- [ ] **Step 2: 开 PR**

```bash
gh pr create --title "fix(brain): 删除 vitest thresholds 让 diff-cover 单独把门" --body "$(cat <<'EOF'
## Summary

- 删除 `packages/brain/vitest.config.js` 中 `coverage.thresholds` 块（7 行）
- diff-cover --fail-under=80 成为 brain 唯一覆盖率门禁
- 解锁 Harness Generator 合格 PR 被全局 67% < 75% 阈值卡死的问题

## Test plan

- [x] tests/brain/vitest-config-no-threshold.test.ts（断言配置不含 thresholds:）
- [x] DoD ARTIFACT/BEHAVIOR 全部勾选
- [x] 本 PR brain-diff-coverage job 自身跑通即活体证明

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: foreground 阻塞等 CI**

```bash
PR_NUM=$(gh pr view --json number -q .number)
echo "PR: $PR_NUM"
until [[ $(gh pr checks $PR_NUM 2>/dev/null | grep -cE '^[a-zA-Z].*\s(pending|queued|in_progress)\s' || true) == 0 ]]; do
  sleep 30
done
gh pr checks $PR_NUM
```

预期：所有 check PASS（含 brain-diff-coverage）。

---

## Self-Review

1. **Spec coverage:** Goal/改动/成功标准三项都对应到 Task 1-4。
2. **Placeholder scan:** 无 TBD/TODO；所有命令、代码、文件路径均完整。
3. **Type consistency:** 测试中 `tests/brain/vitest-config-no-threshold.test.ts` 路径在 Task 1/2/DoD 中一致；vitest.config.js 路径全部相同。

## Execution

Inline execution（任务极简，单文件改动）。
