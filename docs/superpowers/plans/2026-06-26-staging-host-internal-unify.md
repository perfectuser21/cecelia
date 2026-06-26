# staging 验证链统一 host.docker.internal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 逐 task 实现。

**Goal:** staging-verify.sh + staging-e2e-runner.js 访问 staging 用 host.docker.internal:5222（env STAGING_HOST 可覆盖），修生产 brain 容器内 localhost:5222 不通。

**Architecture:** 统一 STAGING_HOST=host.docker.internal（跟随 auto-staging-smoke.sh pattern）；改两处 + 各加守卫。

**Tech Stack:** bash, JS(ESM), vitest。

---

## File Structure
- `packages/brain/src/staging-e2e-runner.js` — runStagingCommand 重写目标 host（line 85-87）
- `scripts/staging-verify.sh` — STAGING_URL host（line 14）
- `packages/brain/src/__tests__/staging-e2e-runner-host.test.js` — runStagingCommand 重写守卫
- `packages/brain/src/__tests__/staging-verify-host.test.js` — staging-verify 守卫

---

### Task 1: staging-e2e-runner runStagingCommand 重写用 host.docker.internal

**Files:**
- Create: `packages/brain/src/__tests__/staging-e2e-runner-host.test.js`
- Modify: `packages/brain/src/staging-e2e-runner.js:85-87`

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/staging-e2e-runner-host.test.js`：
```javascript
/**
 * runStagingCommand 在生产 brain 容器内跑，必须把合同命令的 :5221 重写成
 * host.docker.internal:5222（不是 localhost:5222，容器内 localhost 不通 staging）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn() }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn() }));
vi.mock('../harness-final-e2e.js', () => ({ normalizeAcceptance: vi.fn() }));
vi.mock('../staging-promote.js', () => ({
  decidePromote: vi.fn(), runInternalPromote: vi.fn(), defaultPromoteExec: vi.fn(),
  getRepoRoot: () => '/repo', PROMOTE_STATUS: {}, spawnHarnessReport: vi.fn(),
  readProductionInfo: vi.fn(), REPORT_KIND: {},
}));

import { runStagingCommand } from '../staging-e2e-runner.js';

describe('runStagingCommand 重写目标 host', () => {
  let origEnv;
  beforeEach(() => { origEnv = process.env.STAGING_HOST; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.STAGING_HOST;
    else process.env.STAGING_HOST = origEnv;
  });

  it(':5221 重写成 host.docker.internal:5222（默认，不是 localhost:5222）', () => {
    delete process.env.STAGING_HOST;
    const exec = vi.fn(() => '');
    runStagingCommand({ cmd: 'curl -sf http://localhost:5221/api/brain/tick/status' }, { exec });
    const cmd = exec.mock.calls[0][0];
    expect(cmd).toContain('host.docker.internal:5222');
    expect(cmd).not.toContain('localhost:5222');
  });

  it('STAGING_HOST env 可覆盖', () => {
    process.env.STAGING_HOST = '127.0.0.1';
    const exec = vi.fn(() => '');
    runStagingCommand({ cmd: 'curl http://localhost:5221/api/brain/tick/status' }, { exec });
    expect(exec.mock.calls[0][0]).toContain('127.0.0.1:5222');
  });
});
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd /Users/administrator/worktrees/cecelia/staging-host-internal-unify/packages/brain && npx vitest run src/__tests__/staging-e2e-runner-host.test.js`
Expected: FAIL — 当前重写成 localhost:5222。

- [ ] **Step 3: 改 staging-e2e-runner.js（line 85-87）**

```javascript
  const host = opts.host || process.env.STAGING_HOST || 'host.docker.internal';
  const cmd = command.cmd
    .replace(/localhost:5221/g, `${host}:${port}`)
    .replace(/127\.0\.0\.1:5221/g, `${host}:${port}`);
```

- [ ] **Step 4: 运行确认 GREEN**

Run: `cd /Users/administrator/worktrees/cecelia/staging-host-internal-unify/packages/brain && npx vitest run src/__tests__/staging-e2e-runner-host.test.js`
Expected: PASS（2 passed）

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/staging-host-internal-unify
git add packages/brain/src/__tests__/staging-e2e-runner-host.test.js
git commit -m "test(brain): runStagingCommand 重写 host.docker.internal 守卫(RED)"
git add packages/brain/src/staging-e2e-runner.js
git commit -m "fix(brain): runStagingCommand 把 :5221 重写成 host.docker.internal（修容器内 localhost 不通）"
```

---

### Task 2: staging-verify.sh STAGING_URL 用 host.docker.internal

**Files:**
- Create: `packages/brain/src/__tests__/staging-verify-host.test.js`
- Modify: `scripts/staging-verify.sh:14`

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/staging-verify-host.test.js`：
```javascript
/**
 * staging-verify.sh 在生产 brain 容器内跑，STAGING_URL 必须用 host.docker.internal（env 可覆盖），
 * 不能用纯 localhost（容器内 localhost 不通 staging 容器）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../../scripts/staging-verify.sh');

describe('staging-verify.sh STAGING_URL', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  it('STAGING_URL 默认用 host.docker.internal（env STAGING_HOST 可覆盖）', () => {
    const line = (src.match(/STAGING_URL=.*/) || [''])[0];
    expect(line).toContain('STAGING_HOST');
    expect(line).toContain('host.docker.internal');
  });
});
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd /Users/administrator/worktrees/cecelia/staging-host-internal-unify/packages/brain && npx vitest run src/__tests__/staging-verify-host.test.js`
Expected: FAIL — 当前 STAGING_URL=http://localhost:${STAGING_PORT}。

- [ ] **Step 3: 改 staging-verify.sh:14**

```bash
STAGING_URL="http://${STAGING_HOST:-host.docker.internal}:${STAGING_PORT}"
```

- [ ] **Step 4: 运行确认 GREEN + bash 冒烟**

Run: `cd /Users/administrator/worktrees/cecelia/staging-host-internal-unify/packages/brain && npx vitest run src/__tests__/staging-verify-host.test.js`
Expected: PASS（1 passed）
Run: `bash -n /Users/administrator/worktrees/cecelia/staging-host-internal-unify/scripts/staging-verify.sh && echo SYNTAX_OK`
Expected: SYNTAX_OK

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/staging-host-internal-unify
git add packages/brain/src/__tests__/staging-verify-host.test.js
git commit -m "test(brain): staging-verify STAGING_URL host.docker.internal 守卫(RED)"
git add scripts/staging-verify.sh
git commit -m "fix(deploy): staging-verify STAGING_URL 用 host.docker.internal（修容器内 localhost 不通）"
```

---

### Task 3: DoD + DevGate

- [ ] **Step 1: 写 .dod.md**

`.dod.md`（worktree 根，覆盖）：
```markdown
# DoD: staging 验证链统一 host.docker.internal

- [x] [ARTIFACT] staging-verify.sh STAGING_URL 用 host.docker.internal
  Test: manual:node -e "const s=require('fs').readFileSync('scripts/staging-verify.sh','utf8'); if(!s.includes('host.docker.internal')||!s.includes('STAGING_HOST'))process.exit(1)"
- [x] [BEHAVIOR] runStagingCommand 重写 :5221→host.docker.internal:5222（brain-ci vitest 真跑）
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/staging-e2e-runner-host.test.js')"
```

- [ ] **Step 2: DevGate**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/staging-host-internal-unify
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
cd packages/brain && npx vitest run src/__tests__/staging-e2e-runner-host.test.js src/__tests__/staging-verify-host.test.js
```
Expected: 全过

- [ ] **Step 3: commit .dod.md**

```bash
cd /Users/administrator/worktrees/cecelia/staging-host-internal-unify
git add .dod.md && git commit -m "docs: DoD 验收映射（staging host.docker.internal）"
```
