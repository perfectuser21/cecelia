# staging-e2e-runner 部署脚本路径修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 逐 task 实现。步骤用 checkbox 跟踪。

**Goal:** deployStaging 用绝对路径（`process.env.REPO_ROOT` || `getRepoRoot()` 兜底）调 staging-deploy.sh，并把 cwd 设为 repo 根，容器内不再 "No such file"。

**Architecture:** 仅改 `staging-e2e-runner.js` 的 deployStaging：新增 `import path`，在函数内解析 repoRoot 并拼绝对 deployScript + cwd。优先级 opts.cwd > REPO_ROOT env（容器=bind-mount repo 根）> getRepoRoot()（本地直跑兜底，容器内返回 / 不可靠）。

**Tech Stack:** Node.js (ESM), vitest。

---

## File Structure
- `packages/brain/src/staging-e2e-runner.js` — 改 deployStaging（line 19 加 import path；line 44-65 解析 repoRoot）
- `packages/brain/src/__tests__/staging-e2e-runner-deploy-path.test.js` — 新建单测

---

### Task 1: deployStaging 绝对路径 + cwd

**Files:**
- Create: `packages/brain/src/__tests__/staging-e2e-runner-deploy-path.test.js`
- Modify: `packages/brain/src/staging-e2e-runner.js`（line 19 import；line 44-53 deployStaging）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/staging-e2e-runner-deploy-path.test.js`：
```javascript
/**
 * deployStaging 必须用绝对路径调 staging-deploy.sh（容器 cwd=/app，相对路径找不到）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// staging-e2e-runner 的副作用 import 全 mock
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn() }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn() }));
vi.mock('../harness-final-e2e.js', () => ({ normalizeAcceptance: vi.fn() }));
vi.mock('../staging-promote.js', () => ({
  decidePromote: vi.fn(), runInternalPromote: vi.fn(), defaultPromoteExec: vi.fn(),
  getRepoRoot: () => '/fallback/repo', PROMOTE_STATUS: {}, spawnHarnessReport: vi.fn(),
  readProductionInfo: vi.fn(), REPORT_KIND: {},
}));

import { deployStaging } from '../staging-e2e-runner.js';

describe('deployStaging 绝对路径', () => {
  let origEnv;
  beforeEach(() => { origEnv = process.env.REPO_ROOT; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = origEnv;
  });

  it('用 REPO_ROOT env 拼绝对路径 + cwd', () => {
    process.env.REPO_ROOT = '/fake/repo';
    const exec = vi.fn(() => '');
    deployStaging({ exec });
    const [cmd, optsArg] = exec.mock.calls[0];
    expect(cmd).toBe('bash /fake/repo/scripts/staging-deploy.sh');
    expect(optsArg.cwd).toBe('/fake/repo');
  });

  it('REPO_ROOT 缺失 → fallback getRepoRoot()', () => {
    delete process.env.REPO_ROOT;
    const exec = vi.fn(() => '');
    deployStaging({ exec });
    expect(exec.mock.calls[0][0]).toBe('bash /fallback/repo/scripts/staging-deploy.sh');
    expect(exec.mock.calls[0][1].cwd).toBe('/fallback/repo');
  });

  it('opts.cwd 优先级最高', () => {
    process.env.REPO_ROOT = '/fake/repo';
    const exec = vi.fn(() => '');
    deployStaging({ exec, cwd: '/override' });
    expect(exec.mock.calls[0][0]).toBe('bash /override/scripts/staging-deploy.sh');
    expect(exec.mock.calls[0][1].cwd).toBe('/override');
  });

  it('STAGING_SKIP_REASON → skipped（不回归降级行为）', () => {
    process.env.REPO_ROOT = '/fake/repo';
    const exec = vi.fn(() => 'STAGING_SKIP_REASON=no_docker');
    expect(deployStaging({ exec }).status).toBe('skipped');
  });
});
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd /Users/administrator/worktrees/cecelia/staging-deploy-path-fix/packages/brain && npx vitest run src/__tests__/staging-e2e-runner-deploy-path.test.js`
Expected: FAIL — 前 3 个用例失败，当前 cmd='bash scripts/staging-deploy.sh'（相对）、cwd=undefined。

- [ ] **Step 3: 实现**

`staging-e2e-runner.js` line 19 区，`import { execSync } from 'child_process';` 后新增：
```javascript
import path from 'path';
```

`staging-e2e-runner.js` deployStaging（line 44-53）改为：
```javascript
export function deployStaging(opts = {}) {
  const exec = opts.exec || execSync;
  const repoRoot = opts.cwd || process.env.REPO_ROOT || getRepoRoot();
  const script = opts.deployScript || path.join(repoRoot, 'scripts/staging-deploy.sh');
  try {
    const raw = exec(`bash ${script}`, {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: DEPLOY_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    });
```
（其余 try/catch 主体不变。可保留或删除 line 27 的 `const DEFAULT_DEPLOY_SCRIPT`——已不再引用，删除以免死代码。）

- [ ] **Step 4: 运行确认 GREEN**

Run: `cd /Users/administrator/worktrees/cecelia/staging-deploy-path-fix/packages/brain && npx vitest run src/__tests__/staging-e2e-runner-deploy-path.test.js`
Expected: PASS（4 passed）

- [ ] **Step 5: commit（test 先 impl 后）**

```bash
cd /Users/administrator/worktrees/cecelia/staging-deploy-path-fix
git add packages/brain/src/__tests__/staging-e2e-runner-deploy-path.test.js
git commit -m "test(brain): deployStaging 绝对路径单测(RED)"
git add packages/brain/src/staging-e2e-runner.js
git commit -m "fix(brain): staging-e2e-runner 用 REPO_ROOT 绝对路径调 staging-deploy.sh"
```

---

### Task 2: DevGate + DoD + 回归

- [ ] **Step 1: 写 .dod.md**

`.dod.md`（worktree 根）：
```markdown
# DoD: staging-e2e-runner 部署脚本绝对路径修复

- [x] [ARTIFACT] deployStaging 用 path.join + repoRoot 拼绝对路径
  Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/src/staging-e2e-runner.js','utf8'); if(!s.includes('process.env.REPO_ROOT')||!s.includes(\"path.join(repoRoot\"))process.exit(1)"
- [x] [BEHAVIOR] REPO_ROOT/fallback/opts.cwd 三级绝对路径 + cwd（brain-ci vitest 真跑）
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/staging-e2e-runner-deploy-path.test.js')"
```

- [ ] **Step 2: DevGate 三件套**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/staging-deploy-path-fix
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全过

- [ ] **Step 3: 相邻测试无回归**

Run: `cd /Users/administrator/worktrees/cecelia/staging-deploy-path-fix/packages/brain && npx vitest run src/__tests__/ -t staging 2>&1 | tail -8`
Expected: 全 PASS（确认未破坏其他 staging 相关测试）

- [ ] **Step 4: commit .dod.md**

```bash
cd /Users/administrator/worktrees/cecelia/staging-deploy-path-fix
git add .dod.md && git commit -m "docs: DoD 验收映射"
```
