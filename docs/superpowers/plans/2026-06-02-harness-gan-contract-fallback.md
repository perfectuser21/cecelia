# harness-gan contract.md fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `defaultReadContractFile` candidates 数组中加入 `contract.md`，防止 proposer 写错文件名时 GAN 无限重试 OOM。

**Architecture:** 纯防御性兜底，只改候选文件名列表。优先级保持 `contract-draft.md` > `sprint-contract.md` > `contract.md`。

**Tech Stack:** Node.js, vitest

---

### Task 1: 写 failing test（contract.md 兜底）

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-gan-contract-fallback.test.js`

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/workflows/__tests__/harness-gan-contract-fallback.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const { defaultReadContractFile } = await import('../harness-gan.graph.js');

describe('defaultReadContractFile — contract.md fallback', () => {
  beforeEach(() => vi.resetAllMocks());

  it('contract-draft.md 存在时优先用它', async () => {
    readFile.mockImplementation(async (p) => {
      if (p.endsWith('contract-draft.md')) return 'draft content';
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    readdir.mockResolvedValue([]);
    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('draft content');
  });

  it('没有 contract-draft.md 时用 sprint-contract.md', async () => {
    readFile.mockImplementation(async (p) => {
      if (p.endsWith('sprint-contract.md')) return 'sprint content';
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    readdir.mockResolvedValue([]);
    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('sprint content');
  });

  it('只有 contract.md 时兜底用它', async () => {
    readFile.mockImplementation(async (p) => {
      if (p.endsWith('contract.md') && !p.endsWith('contract-draft.md')) return 'plain content';
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    readdir.mockResolvedValue([]);
    execFile.mockRejectedValue(new Error('no commits'));
    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('plain content');
  });

  it('三个都没有时抛 contract file not found', async () => {
    readFile.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));
    readdir.mockResolvedValue([]);
    execFile.mockRejectedValue(new Error('no commits'));
    await expect(defaultReadContractFile('/repo', 'sprints')).rejects.toThrow('contract file not found');
  });
});
```

- [ ] **Step 2: 跑测试确认 fail（第 3 条 contract.md 用例 fail）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-contract-fallback
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-contract-fallback.test.js 2>&1 | tail -20
```

期望：第 3 条用例 FAIL（candidates 里没有 contract.md）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/workflows/__tests__/harness-gan-contract-fallback.test.js
git commit -m "test(harness-gan): 加 contract.md fallback 失败测试"
```

---

### Task 2: 实现 contract.md 兜底

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js:240-243`

- [ ] **Step 1: 修改 candidates 数组**

将第 240-243 行从：
```js
  const candidates = [
    path.join(worktreePath, sprintDir, 'contract-draft.md'),
    path.join(worktreePath, sprintDir, 'sprint-contract.md'),
  ];
```
改为：
```js
  const candidates = [
    path.join(worktreePath, sprintDir, 'contract-draft.md'),
    path.join(worktreePath, sprintDir, 'sprint-contract.md'),
    path.join(worktreePath, sprintDir, 'contract.md'),
  ];
```

- [ ] **Step 2: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-contract-fallback
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-contract-fallback.test.js 2>&1 | tail -10
```

期望：4/4 PASS

- [ ] **Step 3: 跑 Brain 全量测试确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-contract-fallback
npx vitest run packages/brain/src/ 2>&1 | tail -10
```

期望：全绿（或只有与本次无关的既有失败）

- [ ] **Step 4: commit 实现**

```bash
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "fix(harness-gan): defaultReadContractFile 加 contract.md 兜底防 GAN 无限重试"
```

---

### Task 3: Brain 版本 bump + PR

- [ ] **Step 1: 确认 Brain 版本文件**

```bash
cat packages/brain/package.json | grep '"version"'
```

- [ ] **Step 2: bump patch 版本（Brain 代码改动必须 bump）**

打开 `packages/brain/package.json`，将 version 末位 +1（如 1.2.3 → 1.2.4）。

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-contract-fallback
node -e "
const fs = require('fs');
const p = 'packages/brain/package.json';
const pkg = JSON.parse(fs.readFileSync(p,'utf8'));
const parts = pkg.version.split('.');
parts[2] = String(Number(parts[2]) + 1);
pkg.version = parts.join('.');
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('bumped to', pkg.version);
"
```

- [ ] **Step 3: commit version bump**

```bash
git add packages/brain/package.json
git commit -m "chore(brain): bump patch 版本（harness-gan contract.md 兜底）"
```

- [ ] **Step 4: push 并开 PR**

```bash
git push -u origin cp-0602103534-harness-gan-contract-fallback
gh pr create --title "fix(harness-gan): defaultReadContractFile 加 contract.md 兜底防 GAN 无限重试 OOM" \
  --body "$(cat <<'PREOF'
## 问题

Proposer agent 有时写 \`contract.md\` 而非 \`contract-draft.md\`，
导致 GAN 循环永远找不到合同文件 → 无限重试 → 容器 OOM。

## 变更

\`defaultReadContractFile\` candidates 加第三项 \`contract.md\` 兜底。
优先级：\`contract-draft.md\` > \`sprint-contract.md\` > \`contract.md\`。

## 测试

新增 4 个单测覆盖全部候选路径。
PREOF
)"
```

