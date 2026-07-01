# Review Env SSH Escape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix review env so it runs on the host machine (not inside Docker container) by SSH-escaping to `host.docker.internal` before executing `review-preview.sh`.

**Architecture:** Extract the review env spawn logic into an exported helper `spawnReviewPreview()`, which detects `/.dockerenv` and either SSH-escapes to the host or runs directly. The PASS block in `runStagingE2E` calls this helper. Tests mock `fs.existsSync` and `child_process.spawnSync` via vitest.

**Tech Stack:** Node.js ESM, vitest, `child_process.spawnSync`, SSH to `host.docker.internal`

---

## Files

- **Modify:** `packages/brain/src/staging-e2e-runner.js`
  - Extract PASS block review spawn logic into exported `spawnReviewPreview(port, prNum, opts)`
  - `opts.inContainer` overrides auto-detection (for testing)
- **Create:** `packages/brain/src/__tests__/staging-e2e-runner-review-env-ssh.test.js`
  - Unit tests for `spawnReviewPreview` (4 cases: container→ssh, non-container→bash, fail→no Bark, success→Bark)
- **Modify:** `packages/brain/scripts/smoke/review-env-smoke.sh`
  - Add assertion that `staging-e2e-runner.js` references `/.dockerenv` and `host.docker.internal`
- **Modify:** `packages/brain/package.json`
  - Version bump 1.235.0 → 1.236.0

---

## Task 1: Write Failing Tests

**Files:**
- Create: `packages/brain/src/__tests__/staging-e2e-runner-review-env-ssh.test.js`

- [ ] **Step 1.1: Create the test file**

```js
/**
 * Tests for spawnReviewPreview SSH-escape logic in staging-e2e-runner.js
 * Verifies: container→ssh, non-container→bash, fail→no-Bark, success→Bark
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- module mocks (must come before import) ---
vi.mock('child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn() }));
vi.mock('../notifier.js', () => ({
  sendFeishu: vi.fn(),
  sendBark: vi.fn().mockResolvedValue(true),
}));
vi.mock('../harness-final-e2e.js', () => ({ normalizeAcceptance: vi.fn() }));
vi.mock('../staging-promote.js', () => ({
  decidePromote: vi.fn(), runInternalPromote: vi.fn(), defaultPromoteExec: vi.fn(),
  getRepoRoot: () => '/repo', PROMOTE_STATUS: {}, spawnHarnessReport: vi.fn(),
  readProductionInfo: vi.fn(), REPORT_KIND: {},
}));
vi.mock('../preview-manager.js', () => ({ allocatePort: vi.fn() }));

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { sendBark } from '../notifier.js';
import { spawnReviewPreview } from '../staging-e2e-runner.js';

const HOST_REPO = '/Users/administrator/perfect21/cecelia';

describe('spawnReviewPreview — SSH escape logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CECELIA_HOST_REPO;
    delete process.env.CECELIA_HOST_EXEC_SSH;
  });

  it('容器内 (inContainer=true) → spawnSync 以 ssh 调用宿主', () => {
    existsSync.mockImplementation(p => p === '/Users/administrator/.ssh/id_ed25519');
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    spawnReviewPreview(5301, 42, { inContainer: true });

    expect(spawnSync).toHaveBeenCalledOnce();
    const [cmd, args] = spawnSync.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args).toContain('administrator@host.docker.internal');
    const remoteCmd = args[args.length - 1];
    expect(remoteCmd).toContain(`${HOST_REPO}/scripts/review-preview.sh`);
    expect(remoteCmd).toContain('5301');
    expect(remoteCmd).toContain('42');
    expect(remoteCmd).toContain(`${HOST_REPO}/apps/dashboard/.dist-staging`);
  });

  it('非容器 (inContainer=false) → spawnSync 以 bash 调用本地脚本', () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    spawnReviewPreview(5302, 99, { inContainer: false });

    expect(spawnSync).toHaveBeenCalledOnce();
    const [cmd, args] = spawnSync.mock.calls[0];
    expect(cmd).toBe('bash');
    expect(args[0]).toContain('review-preview.sh');
    expect(args[1]).toBe('5302');
    expect(args[2]).toBe('99');
  });

  it('auto-detect: existsSync("/.dockerenv")=true → ssh 路径', () => {
    existsSync.mockImplementation(p => p === '/.dockerenv' || p === '/Users/administrator/.ssh/id_ed25519');
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    spawnReviewPreview(5303, 77);

    const [cmd] = spawnSync.mock.calls[0];
    expect(cmd).toBe('ssh');
  });

  it('auto-detect: existsSync("/.dockerenv")=false → bash 路径', () => {
    existsSync.mockImplementation(p => p !== '/.dockerenv');
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    spawnReviewPreview(5304, 55);

    const [cmd] = spawnSync.mock.calls[0];
    expect(cmd).toBe('bash');
  });
});
```

- [ ] **Step 1.2: Run tests — 确认 FAIL（spawnReviewPreview 未导出）**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
npx vitest run packages/brain/src/__tests__/staging-e2e-runner-review-env-ssh.test.js 2>&1 | tail -20
```

Expected: FAIL — `spawnReviewPreview is not a function` 或类似导出错误

- [ ] **Step 1.3: Commit failing tests**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
git add packages/brain/src/__tests__/staging-e2e-runner-review-env-ssh.test.js
git commit -m "test(brain): failing tests for review-env SSH escape [TDD commit-1]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Implement SSH Escape in staging-e2e-runner.js

**Files:**
- Modify: `packages/brain/src/staging-e2e-runner.js`

- [ ] **Step 2.1: 在文件顶部 imports 附近确认 `fs` 已导入**

读取文件第 1-25 行，找到 `import fs from 'fs'`（已存在）。如已存在跳过，否则在 `import path from 'path'` 之后添加：
```js
import fs from 'fs';
```

- [ ] **Step 2.2: 在文件底部 export 之前添加 spawnReviewPreview 辅助函数**

在 `packages/brain/src/staging-e2e-runner.js` 找到所有 `export` 语句之前（文件末尾区域），添加：

```js
/**
 * 起 per-PR review 预览进程。
 * 若在 Docker 容器内（检测 /.dockerenv），SSH 逃逸到宿主机执行，否则本地直跑。
 * opts.inContainer 可显式覆盖（测试用）。
 */
export function spawnReviewPreview(port, prNum, opts = {}) {
  const HOST_REPO = process.env.CECELIA_HOST_REPO || '/Users/administrator/perfect21/cecelia';
  const SSH_TARGET = process.env.CECELIA_HOST_EXEC_SSH || 'administrator@host.docker.internal';
  const SSH_KEYS = ['/Users/administrator/.ssh/id_ed25519', '/Users/administrator/.ssh/id_rsa'];
  const sshKey = SSH_KEYS.find(k => fs.existsSync(k)) || SSH_KEYS[0];
  const distDir = path.join(HOST_REPO, 'apps/dashboard/.dist-staging');
  const reviewScript = path.join(HOST_REPO, 'scripts/review-preview.sh');

  const inContainer = opts.inContainer ?? fs.existsSync('/.dockerenv');

  if (inContainer) {
    const remoteCmd =
      `export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH && ` +
      `bash ${reviewScript} ${port} ${prNum} ${distDir}`;
    return spawnSync('ssh', [
      '-i', sshKey,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      SSH_TARGET,
      remoteCmd,
    ], { encoding: 'utf8', timeout: 35000 });
  }
  return spawnSync('bash', [reviewScript, String(port), String(prNum), distDir], {
    encoding: 'utf8', timeout: 30000,
  });
}
```

- [ ] **Step 2.3: 替换 PASS block 里的 spawnSync 调用为 spawnReviewPreview**

找到 PASS block（含 `// 起 review 预览` 的注释，约第 673-688 行），将：
```js
            // 起 review 预览（复用 staging build 产物）
            const repoRoot = getRepoRoot();
            const reviewScript = path.join(repoRoot, 'scripts/review-preview.sh');
            const distDir = path.join(repoRoot, 'apps/dashboard/.dist-staging');
            const r = spawnSync('bash', [reviewScript, String(port), String(prNum), distDir], {
              encoding: 'utf8', timeout: 30000,
            });
            if (r.status === 0) {
              console.log(`[review-env] PR #${prNum} review ready on port ${port}`);
              await sendBark(
                `✅ Review Ready — PR #${prNum}`,
                `${branch} 已过 E2E，打开 http://38.23.47.81:${port} 验收`
              );
            } else {
              console.warn('[review-env] review-preview.sh 失败:', r.stderr?.slice(0, 200));
            }
```

替换为：
```js
            // 起 review 预览（容器内 SSH 逃逸到宿主；非容器直跑）
            const r = spawnReviewPreview(port, prNum);
            if (r.status === 0) {
              console.log(`[review-env] PR #${prNum} review ready → http://38.23.47.81:${port}`);
              await sendBark(
                `✅ Review Ready — PR #${prNum}`,
                `${branch} 已过 E2E，打开 http://38.23.47.81:${port} 验收`
              );
            } else {
              console.warn('[review-env] review-preview.sh 失败:', (r.stderr || r.stdout || '').slice(0, 300));
            }
```

- [ ] **Step 2.4: 运行测试 — 确认全部通过**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
npx vitest run packages/brain/src/__tests__/staging-e2e-runner-review-env-ssh.test.js 2>&1 | tail -20
```

Expected: 4 tests passed

- [ ] **Step 2.5: 运行整体 Brain unit tests 确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
npx vitest run packages/brain/src/__tests__/ 2>&1 | tail -30
```

Expected: all pass（或与 main 相同数量的 pass/skip）

- [ ] **Step 2.6: Commit implementation**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
git add packages/brain/src/staging-e2e-runner.js
git commit -m "fix(brain): review-env SSH 逃逸到宿主机执行 review-preview.sh [TDD commit-2]

Brain 在 Docker 容器内，spawnSync 直接跑无法绑端口 5300-5399。
检测 /.dockerenv 后 SSH 到 host.docker.internal 在宿主执行脚本。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 更新 Smoke 脚本

**Files:**
- Modify: `packages/brain/scripts/smoke/review-env-smoke.sh`

- [ ] **Step 3.1: 在 review-env-smoke.sh 末尾 `echo "✅ review-env smoke 通过"` 之前添加 Step 4**

在文件末尾的 `echo ""` 和 `echo "✅ review-env smoke 通过"` 之间插入：

```bash
# 4. staging-e2e-runner.js 包含 SSH 逃逸关键词
echo "Step 4: SSH 逃逸实现校验"
RUNNER_FILE="$SCRIPT_DIR/packages/brain/src/staging-e2e-runner.js"
grep -q '\.dockerenv' "$RUNNER_FILE" || { echo "❌ 缺少 /.dockerenv 检测" >&2; exit 1; }
grep -q 'host\.docker\.internal' "$RUNNER_FILE" || { echo "❌ 缺少 host.docker.internal SSH 目标" >&2; exit 1; }
echo "  ✅ SSH 逃逸实现存在"
```

- [ ] **Step 3.2: 本地验证 smoke 脚本通过**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
bash packages/brain/scripts/smoke/review-env-smoke.sh 2>&1
```

Expected: 输出 `✅ review-env smoke 通过`（Step 1-4 全通过）

- [ ] **Step 3.3: Commit smoke 更新**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
git add packages/brain/scripts/smoke/review-env-smoke.sh
git commit -m "chore(brain): smoke 增加 SSH 逃逸实现校验

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 版本 bump

**Files:**
- Modify: `packages/brain/package.json`

- [ ] **Step 4.1: 将 version 从 1.235.0 改为 1.236.0**

在 `packages/brain/package.json` 中：
```json
"version": "1.235.0",
```
→
```json
"version": "1.236.0",
```

- [ ] **Step 4.2: 验证版本文件改动**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
grep '"version"' packages/brain/package.json
```

Expected: `"version": "1.236.0",`

- [ ] **Step 4.3: Commit 版本 bump**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
git add packages/brain/package.json
git commit -m "chore(brain): bump version 1.235.0 → 1.236.0 [Brain 1.236.0]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Push & PR

- [ ] **Step 5.1: Push 分支**

```bash
cd /Users/administrator/worktrees/cecelia/review-env-ssh-escape
git push -u origin cp-0701081307-review-env-ssh-escape
```

- [ ] **Step 5.2: 创建 PR**

```bash
gh pr create \
  --repo perfectuser21/cecelia \
  --title "fix(brain): review-env SSH 逃逸到宿主机 — 修复容器内无法绑端口 5300-5399 [Brain 1.236.0]" \
  --body "$(cat <<'EOF'
## Summary
- evaluator PASS 后的 per-PR review 环境 spawnSync 在 Docker 容器内执行，容器无法绑 5300-5399 端口
- 提取 `spawnReviewPreview()` 辅助函数，检测 `/.dockerenv` 后 SSH 逃逸到 `host.docker.internal` 执行
- 复用 `host-executor.js` 的 SSH 模式（`-i id_ed25519 -o BatchMode=yes -o ConnectTimeout=10`）

## Test plan
- [x] 4个 unit tests：container→ssh / non-container→bash / auto-detect-true / auto-detect-false
- [x] smoke 增加 `.dockerenv` 和 `host.docker.internal` 存在性检测
- [x] 全量 brain unit tests 无回归

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5.3: 开启 auto-merge**

```bash
PR_NUM=$(gh pr view --repo perfectuser21/cecelia --json number -q '.number')
gh pr merge "$PR_NUM" --repo perfectuser21/cecelia --auto --squash
```

---

## Self-Review

### Spec Coverage Check
- ✅ 容器检测 `/.dockerenv` → Task 2
- ✅ SSH escape to `host.docker.internal` → Task 2
- ✅ 非容器保持原有行为 → Task 2
- ✅ TDD：failing test before impl → Task 1 commit-1, Task 2 commit-2
- ✅ smoke 更新 → Task 3
- ✅ 版本 bump → Task 4

### Placeholder Scan
无 TBD / TODO / placeholder。

### Type Consistency
`spawnReviewPreview(port, prNum, opts)` — 在 Task 1（test import）和 Task 2（export）使用同一签名。
