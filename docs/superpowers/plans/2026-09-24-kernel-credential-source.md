# kernel-v1 凭据来源修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 每个 Task 两次提交：commit-1 失败测试、commit-2 实现。commit 末尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

**Goal:** MMV 上以 `_cecelia` 运行的 kernel run 能读到 administrator 的 codex 凭据，凭据错误码透明可查。

**Architecture:** 见 `docs/superpowers/specs/2026-09-24-kernel-credential-source-design.md`。

**Tech Stack:** Node 20 ESM（brain）/ CJS（fleet-worker），vitest 1.6。

工作树 `/Users/administrator/worktrees/cecelia/0924-kernel-credential-source`，分支 `cp-0924092322-0924-kernel-credential-source`（基于 origin/main 667e3bc3c7）。测试命令均在 `packages/brain` 下：`npx vitest run <file>`（fleet-worker 的 `.test.cjs` 也由该 vitest 配置收录）。

---

### Task 1: credential-broker —— 错误透传 + trustedUids + 权限规则

**Files:**
- Modify: `packages/brain/src/orchestrator/credential-broker.js`
- Modify: `packages/brain/src/orchestrator/credential-broker.test.js`

- [ ] **Step 1: 失败测试**（追加/修改 credential-broker.test.js）

在「central Codex Credential Broker」describe 内追加：
```js
  it.each([
    ['credential_source_unavailable'],
    ['credential_source_permissions'],
  ])('passes the loader failure %s through instead of masking it as payload_invalid', async (code) => {
    const loadCredential = vi.fn(async () => { throw new Error(code); });
    await expect(broker({ loadCredential }).issue({
      attemptId: ATTEMPT_ID, accountId: 'team4', machineId: 'xian-mac-m4', deadlineAt: DEADLINE,
    })).rejects.toThrow(code);
  });

  it('still masks non-credential loader failures as credential_payload_invalid', async () => {
    const loadCredential = vi.fn(async () => { throw new Error(`ENOENT ${SECRET}`); });
    let error;
    try {
      await broker({ loadCredential }).issue({
        attemptId: ATTEMPT_ID, accountId: 'team4', machineId: 'xian-mac-m4', deadlineAt: DEADLINE,
      });
    } catch (caught) { error = caught; }
    expect(error?.message).toBe('credential_payload_invalid');
    expect(error?.message).not.toContain(SECRET);
  });
```

在「protected US M4 credential source」describe：把 `it.each` 的 `['group-readable file', 0o640, false]` 改为 `['group-writable file', 0o660, false]`，并追加：
```js
  it('accepts a world-readable (0644) file owned by the process user', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-loader-'));
    const team4 = path.join(root, '.codex-team4');
    fs.mkdirSync(team4, { mode: 0o755 });
    fs.writeFileSync(path.join(team4, 'auth.json'), authJson(), { mode: 0o644 });
    const load = createFileCredentialLoader({
      accountHomeResolver: (accountId) => path.join(root, `.codex-${accountId}`),
    });
    try {
      await expect(load('team4')).resolves.toBe(authJson());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function foreignOwnerDeps(uid, { trustedUids, dirMode = 0o40755, fileMode = 0o100644 } = {}) {
    const body = authJson();
    return {
      accountHomeResolver: () => '/srv/foreign/.codex-team4',
      trustedUids,
      openFile: vi.fn(() => 7),
      fstat: vi.fn(() => ({ isFile: () => true, mode: fileMode, uid, size: Buffer.byteLength(body) })),
      readFile: vi.fn(() => body),
      closeFile: vi.fn(),
      statDirectory: vi.fn(() => ({ isDirectory: () => true, isSymbolicLink: () => false, mode: dirMode, uid })),
    };
  }

  it('rejects a file owned by another uid that is not trusted', async () => {
    const load = createFileCredentialLoader(foreignOwnerDeps(9999, { trustedUids: [] }));
    await expect(load('team4')).rejects.toThrow('credential_source_permissions');
  });

  it('accepts a file owned by a trusted uid even when the process uid differs', async () => {
    const load = createFileCredentialLoader(foreignOwnerDeps(9999, { trustedUids: [9999] }));
    await expect(load('team4')).resolves.toBe(authJson());
  });

  it('rejects a trusted-owner file whose parent directory is group- or world-writable', async () => {
    const load = createFileCredentialLoader(foreignOwnerDeps(9999, { trustedUids: [9999], dirMode: 0o40777 }));
    await expect(load('team4')).rejects.toThrow('credential_source_permissions');
  });

  it('rejects a trusted-owner file whose parent directory is a symlink', async () => {
    const deps = foreignOwnerDeps(9999, { trustedUids: [9999] });
    deps.statDirectory = vi.fn(() => ({ isDirectory: () => true, isSymbolicLink: () => true, mode: 0o40755, uid: 9999 }));
    await expect(createFileCredentialLoader(deps)('team4')).rejects.toThrow('credential_source_permissions');
  });

  it.each([[['x']], [[-1]], [[1.5]], ['501']])('rejects invalid trustedUids %j at construction', (trustedUids) => {
    expect(() => createFileCredentialLoader({ accountHomeResolver: () => '/tmp/x', trustedUids }))
      .toThrow('credential_trusted_uids_invalid');
  });
```

- [ ] **Step 2**：`npx vitest run src/orchestrator/credential-broker.test.js` → 新增用例红（透传 2 条、0644 通过、trusted 通过、trustedUids 校验、父目录）。
- [ ] **Step 3**：提交 `test(brain): 凭据 loader 可信属主/权限规则与 broker 错误透传 failing test`。

- [ ] **Step 4: 实现**

`createFileCredentialLoader` 新签名与规则：
```js
export function createFileCredentialLoader({
  accountHomeResolver,
  trustedUids = [],
  openFile = openSync,
  fstat = fstatSync,
  readFile = readFileSync,
  closeFile = closeSync,
  statDirectory = lstatSync,
  maximumBytes = MAX_AUTH_JSON_BYTES,
} = {}) {
  if (typeof accountHomeResolver !== 'function') fail('credential_account_home_resolver_required');
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) fail('credential_source_limit_invalid');
  if (
    !Array.isArray(trustedUids)
    || trustedUids.some((uid) => !Number.isInteger(uid) || uid < 0)
  ) fail('credential_trusted_uids_invalid');
  const trusted = new Set(trustedUids);
  const ownerTrusted = (uid) => !Number.isInteger(uid)
    || typeof process.getuid !== 'function'
    || uid === process.getuid()
    || trusted.has(uid);
  // 凭据由宿主 administrator 的 codex CLI/刷新脚本产出（权限不受本仓库控制，现实为 0644）；
  // loader 只拒绝「可被他人篡改/伪造」的来源：属主须可信，文件与父目录不得被组/他人写，
  // 不得是符号链接，不得带执行位。保密性（0600）由源侧脚本负责。
  const fileModeAcceptable = (mode) => (mode & 0o400) !== 0 && (mode & 0o022) === 0 && (mode & 0o111) === 0;
  ...
      const accountHome = accountHomeResolver(accountId);
      （原路径校验不变）
      const parent = statDirectory(accountHome);
      if (
        !parent.isDirectory() || parent.isSymbolicLink()
        || !ownerTrusted(parent.uid) || (parent.mode & 0o022) !== 0
      ) fail('credential_source_permissions');
      authFile = path.join(accountHome, 'auth.json');
      descriptor = openFile(authFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const stat = fstat(descriptor);
      if (!stat.isFile() || !fileModeAcceptable(stat.mode & 0o777) || !ownerTrusted(stat.uid)) {
        fail('credential_source_permissions');
      }
      （size 校验与 readFile 不变；catch 里 statDirectory 的 ENOENT 也走 credential_source_unavailable）
```
`lstatSync` 从 `node:fs` 补 import。注意 catch 分支：`error.code` 为 `ENOENT` → `credential_source_unavailable`（现状已如此）。

`createCredentialBroker.issue` 的 catch 改为：
```js
      } catch (error) {
        if (typeof error?.message === 'string' && error.message.startsWith('credential_')) throw error;
        fail('credential_payload_invalid');
      }
```

- [ ] **Step 5**：`npx vitest run src/orchestrator/credential-broker.test.js src/orchestrator/github-credential-broker.test.js` 全绿。
- [ ] **Step 6**：提交 `fix(brain): 凭据 loader 支持可信属主并透传 credential_* 错误码`。

---

### Task 2: provider-account-home 模块 + run.js/watchdog 接线

**Files:**
- Create: `packages/brain/src/orchestrator/provider-account-home.js`
- Create: `packages/brain/src/orchestrator/provider-account-home.test.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js:317-336`（改为 re-export）
- Modify: `packages/brain/src/orchestrator/run.js:350-357`
- Modify: `packages/brain/src/harness-relay-watchdog.js:604-611`

- [ ] **Step 1: 失败测试** `provider-account-home.test.js`
```js
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseTrustedUids,
  providerAccountDirName,
  resolveCredentialAccountHome,
  resolveProviderAccountHome,
} from './provider-account-home.js';

describe('providerAccountDirName', () => {
  it.each([
    ['codex', 'team3', '.codex-team3'], ['codex', 'codex-team1', '.codex-team1'], ['codex', '2', '.codex-team2'],
    ['claude', 'account2', '.claude-account2'], ['claude', '1', '.claude-account1'],
    ['grok', 'grok', '.grok'], ['grok', 'default', '.grok'],
  ])('%s/%s → %s', (provider, account, expected) => {
    expect(providerAccountDirName(provider, account)).toBe(expected);
  });
  it('rejects unknown accounts', () => {
    expect(() => providerAccountDirName('codex', 'admin')).toThrow('invalid codex account: admin');
    expect(() => providerAccountDirName('gemini', '1')).toThrow('invalid gemini account: 1');
  });
});

describe('resolveProviderAccountHome（执行目录，始终 homedir）', () => {
  it('ignores CECELIA_CREDENTIAL_HOME_ROOT', () => {
    expect(resolveProviderAccountHome('codex', 'team1', { env: { CECELIA_CREDENTIAL_HOME_ROOT: '/srv/x' } }))
      .toBe(path.join(os.homedir(), '.codex-team1'));
    expect(resolveProviderAccountHome('codex', null)).toBeNull();
  });
});

describe('resolveCredentialAccountHome（凭据目录）', () => {
  it.each([[undefined], [''], ['relative/dir']])('falls back to homedir when root is %j', (root) => {
    expect(resolveCredentialAccountHome('codex', 'team2', { env: { CECELIA_CREDENTIAL_HOME_ROOT: root } }))
      .toBe(path.join(os.homedir(), '.codex-team2'));
  });
  it('uses an absolute CECELIA_CREDENTIAL_HOME_ROOT for every provider', () => {
    const env = { CECELIA_CREDENTIAL_HOME_ROOT: '/Users/administrator' };
    expect(resolveCredentialAccountHome('codex', 'team5', { env })).toBe('/Users/administrator/.codex-team5');
    expect(resolveCredentialAccountHome('claude', 'account1', { env })).toBe('/Users/administrator/.claude-account1');
    expect(resolveCredentialAccountHome('grok', 'default', { env })).toBe('/Users/administrator/.grok');
  });
});

describe('parseTrustedUids', () => {
  it('returns [] when unset or blank', () => {
    expect(parseTrustedUids({})).toEqual([]);
    expect(parseTrustedUids({ CECELIA_CREDENTIAL_TRUSTED_UIDS: ' ' })).toEqual([]);
  });
  it('parses a comma list of non-negative integers', () => {
    expect(parseTrustedUids({ CECELIA_CREDENTIAL_TRUSTED_UIDS: '501, 502' })).toEqual([501, 502]);
  });
  it.each([['abc'], ['-1'], ['1.5'], ['501,,502']])('fails loud on %j', (value) => {
    expect(() => parseTrustedUids({ CECELIA_CREDENTIAL_TRUSTED_UIDS: value })).toThrow('credential_trusted_uids_invalid');
  });
});
```
并在 `run.js` 的现有测试基础上补一条（若 `run.test.js`/`__tests__` 里已有 credentialBroker 注入点难以触达则放到 provider-account-home.test.js 末尾用源码文本断言）：run.js 与 harness-relay-watchdog.js 的 `createFileCredentialLoader({` 调用含 `resolveCredentialAccountHome(` 与 `trustedUids: parseTrustedUids(`：
```js
describe('kernel/watchdog loader 接线（源码哨兵）', () => {
  it.each([['run.js'], ['../harness-relay-watchdog.js']])('%s 用凭据目录解析与 trustedUids', async (file) => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    expect(source).toMatch(/createFileCredentialLoader\(\{[\s\S]*?resolveCredentialAccountHome\(/);
    expect(source).toMatch(/trustedUids:\s*parseTrustedUids\(/);
  });
});
```

- [ ] **Step 2**：`npx vitest run src/orchestrator/provider-account-home.test.js` → FAIL（模块不存在）。
- [ ] **Step 3**：提交 `test(brain): 凭据目录解析与 trustedUids failing test`。

- [ ] **Step 4: 实现** `provider-account-home.js`
```js
import os from 'node:os';
import path from 'node:path';

// 账号 → 宿主目录名的单一真身。resolveProviderAccountHome 给执行体挂载用（宿主 administrator 的 home）；
// resolveCredentialAccountHome 给凭据 loader 用：fleet-worker 以 _cecelia（HOME=/var/empty）起 run.js 时，
// 凭据仍在 administrator 目录，经 CECELIA_CREDENTIAL_HOME_ROOT 指过去（决策 fbe2146c）。
export function providerAccountDirName(provider, account) {
  const value = String(account);
  if (provider === 'codex') {
    const number = value.match(/^(?:codex-)?team([1-9]\d*)$/)?.[1] ?? value.match(/^([1-9]\d*)$/)?.[1];
    if (!number) throw new Error(`invalid codex account: ${value}`);
    return `.codex-team${number}`;
  }
  if (provider === 'claude') {
    const number = value.match(/^(?:claude-)?account([1-9]\d*)$/)?.[1] ?? value.match(/^([1-9]\d*)$/)?.[1];
    if (!number) throw new Error(`invalid claude account: ${value}`);
    return `.claude-account${number}`;
  }
  if (provider === 'grok' && ['grok', 'default'].includes(value)) return '.grok';
  throw new Error(`invalid ${provider} account: ${value}`);
}

export function resolveProviderAccountHome(provider, account) {
  if (!account) return null;
  return path.join(os.homedir(), providerAccountDirName(provider, account));
}

export function resolveCredentialHomeRoot(env = process.env) {
  const root = env?.CECELIA_CREDENTIAL_HOME_ROOT;
  return typeof root === 'string' && root.length > 0 && path.isAbsolute(root) ? root : os.homedir();
}

export function resolveCredentialAccountHome(provider, account, { env = process.env } = {}) {
  if (!account) return null;
  return path.join(resolveCredentialHomeRoot(env), providerAccountDirName(provider, account));
}

export function parseTrustedUids(env = process.env) {
  const raw = env?.CECELIA_CREDENTIAL_TRUSTED_UIDS;
  if (typeof raw !== 'string' || raw.trim().length === 0) return [];
  return raw.split(',').map((part) => {
    const text = part.trim();
    if (!/^\d+$/.test(text)) throw new Error('credential_trusted_uids_invalid');
    return Number(text);
  });
}
```
`dispatcher.js`：删除原 `resolveProviderAccountHome` 函数体，改为 `export { resolveProviderAccountHome } from './provider-account-home.js';`（保留 `os` import 仅当别处仍用；否则一并删除未用 import）。

`run.js` 350-357：
```js
      const credentialBroker = overrides.credentialBroker
        ?? createCredentialBroker({
          controllerMachineId: machineId,
          loadCredential: overrides.loadCredential
            ?? createFileCredentialLoader({
              accountHomeResolver: (accountId) => (
                resolveCredentialAccountHome('codex', accountId, { env })
              ),
              trustedUids: parseTrustedUids(env),
            }),
        });
```
并 import `{ parseTrustedUids, resolveCredentialAccountHome } from './provider-account-home.js'`。`harness-relay-watchdog.js` 604-611 同样改法（该文件已有 `env` 变量）。

- [ ] **Step 5**：`npx vitest run src/orchestrator/provider-account-home.test.js src/orchestrator/ src/__tests__/harness-relay-watchdog*.test.js src/__tests__/harness-kernel-resume-secret.test.js` 全绿。
- [ ] **Step 6**：提交 `fix(brain): 凭据目录解析独立于执行目录，run.js/watchdog 接 trustedUids`。

---

### Task 3: orchestrator-runner —— 凭据根探测 + env 注入 + 回填热修

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/orchestrator-runner.cjs`
- Modify: `packages/brain/scripts/fleet-worker/orchestrator-runner.test.cjs`

- [ ] **Step 1: 失败测试**

`build()` 的 `createOrchestratorRunner` 默认参数加：
```js
    env: { DB_HOST: '100.79.41.61', CECELIA_ORBSTACK_HOME: '/Users/host-admin' },
    probeCredentialHome: vi.fn(() => ({ root: '/Users/host-admin', uid: 501 })),
```
并新增用例：
```js
  it('start 注入凭据根与可信属主 uid，runner/skills 走 CECELIA_ORCHESTRATOR_RUNNER_ROOT（回填 09-20 热修）', async () => {
    const { runner, spawned } = build({
      env: { DB_HOST: 'x', CECELIA_ORBSTACK_HOME: '/Users/host-admin', CECELIA_ORCHESTRATOR_RUNNER_ROOT: '/srv/runner-checkout' },
    });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 });
    const { args, opts } = spawned[0];
    expect(args[0]).toBe('/srv/runner-checkout/packages/brain/src/orchestrator/run.js');
    expect(opts.env).toMatchObject({
      CECELIA_CREDENTIAL_HOME_ROOT: '/Users/host-admin',
      CECELIA_CREDENTIAL_TRUSTED_UIDS: '501',
      CECELIA_SKILLS_ROOT: '/srv/runner-checkout/packages/workflows/skills',
      REPO_ROOT: `/ws/${RUN_ID}`,
    });
  });

  it('runner root 缺省为 /private/var/lib/cecelia/runner-checkout（不再指向任务 worktree）', async () => {
    const { runner, spawned } = build();
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 });
    expect(spawned[0].args[0]).toBe('/private/var/lib/cecelia/runner-checkout/packages/brain/src/orchestrator/run.js');
  });

  it('凭据根探测失败 → start 500 orchestrator_credential_home_unavailable，不 spawn，槽位释放', async () => {
    const { runner, spawned } = build({
      probeCredentialHome: vi.fn(() => { throw new Error('nope'); }),
      maxConcurrent: 1,
    });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await expect(runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 }))
      .rejects.toMatchObject({ message: 'orchestrator_credential_home_unavailable', statusCode: 500 });
    expect(spawned).toHaveLength(0);
    await expect(runner.prepare({ run_id: RUN_ID_2, task_id: RUN_ID_2, repo: 'perfectuser21/cecelia' }))
      .resolves.toMatchObject({ status: 'prepared' });
  });

  it('默认 probeCredentialHome：根下无任何 .codex-team{1..5}/auth.json 可读 → 抛错；有则返回根属主 uid', () => {
    const { probeCredentialHome } = require('./orchestrator-runner.cjs');
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-root-'));
    try {
      expect(() => probeCredentialHome(root)).toThrow('credential_home_no_accounts');
      fs.mkdirSync(path.join(root, '.codex-team2'));
      fs.writeFileSync(path.join(root, '.codex-team2', 'auth.json'), '{}');
      expect(probeCredentialHome(root)).toEqual({ root, uid: process.getuid() });
      expect(() => probeCredentialHome('')).toThrow('credential_home_root_invalid');
      expect(() => probeCredentialHome(path.join(root, 'missing'))).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2**：`npx vitest run scripts/fleet-worker/orchestrator-runner.test.cjs` → 新用例 FAIL。
- [ ] **Step 3**：提交 `test(fleet): orchestrator start 注入凭据根/可信 uid 并探测凭据目录 failing test`。

- [ ] **Step 4: 实现**

模块顶层新增并导出：
```js
const CODEX_ACCOUNT_DIRS = ['.codex-team1', '.codex-team2', '.codex-team3', '.codex-team4', '.codex-team5'];
const DEFAULT_RUNNER_ROOT = '/private/var/lib/cecelia/runner-checkout';

// 凭据根 = OrbStack 属主 home（installer 渲染进 plist 的 CECELIA_ORBSTACK_HOME）。fleet-worker 以 _cecelia
// 运行，run.js 里的 loader 需要知道去哪读、以及该目录属主是谁（作为可信 uid）。零账号可读时 fail-loud，
// 否则 run 起来数秒就死在 credential_source_unavailable，槽位白占（2026-09-23 实证）。
function probeCredentialHome(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('credential_home_root_invalid');
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error('credential_home_root_invalid');
  const readable = CODEX_ACCOUNT_DIRS.some((dir) => {
    try { fs.accessSync(path.join(root, dir, 'auth.json'), fs.constants.R_OK); return true; } catch { return false; }
  });
  if (!readable) throw new Error('credential_home_no_accounts');
  return { root, uid: stat.uid };
}
```
`createOrchestratorRunner` 参数增加 `probeCredentialHome: probeCredentialHomeFn = probeCredentialHome`。`start` 内在 `controller_lease_identity_missing` 校验之后、spawn 之前：
```js
      let credentialHome;
      try {
        credentialHome = probeCredentialHomeFn(env.CECELIA_ORBSTACK_HOME);
      } catch (err) {
        jobs.delete(runId);
        const error = httpError('orchestrator_credential_home_unavailable', 500);
        error.cause = err;
        throw error;
      }
      const runnerRoot = env.CECELIA_ORCHESTRATOR_RUNNER_ROOT || DEFAULT_RUNNER_ROOT;
      // 2026-09-20 热修回填 v2：run.js 必须从 runner-checkout 的真实路径（/private/var，非 /var 符号链接）
      // 启动，否则 run.js 底部 import.meta.url === pathToFileURL(process.argv[1]).href 自检恒 false，main() 不执行。
      const runner = path.join(runnerRoot, 'packages/brain/src/orchestrator/run.js');
```
spawn env 追加：
```js
          // 2026-09-20 热修回填 v3：REPO_ROOT 指向任务 worktree 时 loadSkillBundle 找不到 SKILL.md。
          CECELIA_SKILLS_ROOT: path.join(runnerRoot, 'packages/workflows/skills'),
          CECELIA_CREDENTIAL_HOME_ROOT: credentialHome.root,
          CECELIA_CREDENTIAL_TRUSTED_UIDS: String(credentialHome.uid),
```
`module.exports = { createOrchestratorRunner, probeCredentialHome }`（保持原有导出）。注意：`jobs.delete(runId)` 释放槽位后，同一 run 的 start 重放会得到 404 `orchestrator_not_prepared`，符合「探测失败 = 本次 run 作废」语义。

- [ ] **Step 5**：`npx vitest run scripts/fleet-worker/` 全绿。
- [ ] **Step 6**：提交 `fix(fleet): orchestrator start 探测凭据根并注入 CECELIA_CREDENTIAL_HOME_ROOT/TRUSTED_UIDS，回填 09-20 热修`。

---

### Task 4: GP 步骤断言（lint-gp-anchor-artifact）

**Files:**
- Create: `tests/gp/f1/step3-kernel-credential-source.test.js`

- [ ] **Step 1: 写测试**（真 import，不 mock 被改模块）
```js
// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：kernel run 在跑场机上取凭据
//
// 2026-09-23 实证：MMV fleet-worker 以 _cecelia（HOME=/var/empty）起 run.js，凭据在 administrator
// 目录（0644）。loader 按 os.homedir() 找不到 → credential_source_unavailable；broker 又把它改写成
// credential_payload_invalid，71 次远程 run 全死且原因不可查。修法：凭据目录经 CECELIA_CREDENTIAL_HOME_ROOT
// 指向宿主属主 home，loader 接受可信属主的 0644 文件，broker 透传 credential_* 码。
// 真 import credential-broker.js / provider-account-home.js（守卫在边上），不 mock。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCredentialBroker,
  createFileCredentialLoader,
} from '../../../packages/brain/src/orchestrator/credential-broker.js';
import {
  parseTrustedUids,
  resolveCredentialAccountHome,
} from '../../../packages/brain/src/orchestrator/provider-account-home.js';
import { resolvePrimaryWorkerId } from '../../../packages/brain/src/machine-registry.js';

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const roots = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

function hostHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-home-'));
  roots.push(root);
  const team = path.join(root, '.codex-team1');
  fs.mkdirSync(team, { mode: 0o755 });
  const exp = Math.floor((Date.now() + 3 * 3600e3) / 1000);
  const token = `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
  fs.writeFileSync(path.join(team, 'auth.json'), JSON.stringify({ tokens: { access_token: token } }), { mode: 0o644 });
  return root;
}

function brokerFor(env) {
  return createCredentialBroker({
    controllerMachineId: resolvePrimaryWorkerId(),
    loadCredential: createFileCredentialLoader({
      accountHomeResolver: (a) => resolveCredentialAccountHome('codex', a, { env }),
      trustedUids: parseTrustedUids(env),
    }),
  });
}

describe('F1 step3 · kernel run 在跑场机取凭据', () => {
  it('经 CECELIA_CREDENTIAL_HOME_ROOT 指向宿主 home，0644 的 auth.json 能签出信封', async () => {
    const root = hostHome();
    const env = { CECELIA_CREDENTIAL_HOME_ROOT: root, CECELIA_CREDENTIAL_TRUSTED_UIDS: String(process.getuid()) };
    const envelope = await brokerFor(env).issue({
      attemptId: ATTEMPT_ID, accountId: 'team1', machineId: 'us-mac-m4',
      deadlineAt: new Date(Date.now() + 3600e3).toISOString(),
    });
    expect(envelope).toMatchObject({ contract_version: 'credential-envelope/v1', account_id: 'team1' });
  });

  it('凭据根未设时错误码是 credential_source_unavailable（不再被抹成 payload_invalid）', async () => {
    const env = { CECELIA_CREDENTIAL_HOME_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'empty-home-')) };
    roots.push(env.CECELIA_CREDENTIAL_HOME_ROOT);
    await expect(brokerFor(env).issue({
      attemptId: ATTEMPT_ID, accountId: 'team1', machineId: 'us-mac-m4',
      deadlineAt: new Date(Date.now() + 3600e3).toISOString(),
    })).rejects.toThrow('credential_source_unavailable');
  });
});
```
- [ ] **Step 2**：`cd packages/brain && npx vitest run ../../tests/gp/f1/step3-kernel-credential-source.test.js` 全绿（Task 1/2 已实现，本 Task 为守卫补强，无红灯阶段；提交信息用 test:）。
- [ ] **Step 3**：仓库根 `bash .github/workflows/scripts/lint-gp-anchor-artifact.sh origin/main` ✅。
- [ ] **Step 4**：提交 `test(gp): F1 step3 守卫——kernel run 经宿主凭据根签发信封`。

---

### Task 5: 全量验证 + 版本碎片 + push

- [ ] `cd packages/brain && EXECUTOR_BRIDGE_URL=http://127.0.0.1:9 DATABASE_URL=postgresql://cecelia@127.0.0.1:5432/cecelia_test VITEST_MAX_THREADS=2 VITEST_MAX_FORKS=2 npx vitest run src/orchestrator/ scripts/fleet-worker/ src/__tests__/harness-relay-watchdog*.test.js src/__tests__/harness-kernel-resume-secret.test.js`
- [ ] 仓库根 DevGate：`node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`；`node packages/brain/scripts/generate-manifest.mjs`（若有变更则提交）。
- [ ] `changes/cp-0924092322-0924-kernel-credential-source.md`：`## Brain {VERSION} — kernel-v1 远程 run 凭据来源修复`。
- [ ] `bash .github/workflows/scripts/lint-gp-anchor-artifact.sh origin/main && bash scripts/ci/check-brain-version-bump.sh`。
- [ ] push：`EXECUTOR_BRIDGE_URL=http://127.0.0.1:9 DATABASE_URL=postgresql://cecelia@127.0.0.1:5432/cecelia_test VITEST_MAX_THREADS=2 VITEST_MAX_FORKS=2 git push -u origin cp-0924092322-0924-kernel-credential-source`。

---

## 自检
- Spec 覆盖：M1→Task1；M2+M3→Task2；M4→Task3；GP 守卫→Task4。
- 类型一致：`createFileCredentialLoader({ trustedUids, statDirectory })` Task1 定义、Task2/4 使用；`resolveCredentialAccountHome(provider, account, { env })`、`parseTrustedUids(env)` Task2 定义、Task2 接线/Task4 使用；`probeCredentialHome(root) → {root, uid}` Task3。
