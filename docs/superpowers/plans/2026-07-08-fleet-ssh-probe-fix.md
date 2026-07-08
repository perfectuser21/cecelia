# fleet ssh 探针修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Brain 容器内 fleet ssh 探针无身份问题,使西安 M4 产能恢复,并配 CI 单测 + selfcheck 环境守卫。

**Architecture:** infra-status.js 抽纯函数 buildSshCommand(恒加 UserKnownHostsFile=/dev/null,identity 存在才加 -i),sshExec 消费;selfcheck.js 加 compute_ssh_reachability 自检项(warn 不阻塞)。

**Tech Stack:** Node ESM + vitest(packages/brain 现有测试栈)。

## Global Constraints
- TDD 铁律:NO PRODUCTION CODE WITHOUT FAILING TEST FIRST;每 task commit-1 failing test / commit-2 impl
- 语言:代码注释与输出简体中文;PR title Conventional Commits
- Brain 版本 bump patch(package.json 等,push 前跑 bash scripts/check-version-sync.sh + node scripts/facts-check.mjs)
- identity 默认路径 `${process.env.HOME}/.ssh/air2`,env `CECELIA_SSH_IDENTITY` 可覆写

---

### Task 1: buildSshCommand 纯函数(TDD)

**Files:**
- Modify: `packages/brain/src/routes/infra-status.js`(sshExec 处,约 :88)
- Test: `packages/brain/src/routes/__tests__/infra-status-ssh.test.js`(新建)

**Interfaces:**
- Produces: `export function buildSshCommand(server, cmd, opts = {})` → string;opts.identityPath 覆写;server 需 {sshUser, tailscaleIp}

- [ ] **Step 1: 写 failing test**

```js
import { describe, it, expect } from 'vitest';
import { buildSshCommand } from '../infra-status.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SRV = { sshUser: 'u', tailscaleIp: '100.0.0.1' };

describe('buildSshCommand', () => {
  it('恒带 UserKnownHostsFile=/dev/null(容器只读 FS 兼容)', () => {
    const c = buildSshCommand(SRV, 'hostname');
    expect(c).toContain('-o UserKnownHostsFile=/dev/null');
    expect(c).toContain('-o ConnectTimeout=5');
    expect(c).toContain('-o BatchMode=yes');
    expect(c).toContain('"u@100.0.0.1"');
  });
  it('identity 文件存在时带 -i <path>', () => {
    const tmp = path.join(os.tmpdir(), `key-${process.pid}`);
    fs.writeFileSync(tmp, 'x');
    try {
      const c = buildSshCommand(SRV, 'hostname', { identityPath: tmp });
      expect(c).toContain(`-i ${tmp}`);
    } finally { fs.unlinkSync(tmp); }
  });
  it('identity 文件不存在时不带 -i', () => {
    const c = buildSshCommand(SRV, 'hostname', { identityPath: '/nonexistent/key' });
    expect(c).not.toContain('-i ');
  });
});
```

- [ ] **Step 2: 跑测确认 FAIL**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/infra-status-ssh.test.js`
Expected: FAIL(buildSshCommand is not exported / not a function)

- [ ] **Step 3: commit-1(failing test)**

```bash
git add packages/brain/src/routes/__tests__/infra-status-ssh.test.js
git commit -m "test: buildSshCommand failing test(容器内 ssh 无身份修复,TDD commit-1)"
```

- [ ] **Step 4: 最小实现**

在 infra-status.js 的 sshExec 上方加(并让 sshExec 消费):

```js
const DEFAULT_SSH_IDENTITY = () =>
  process.env.CECELIA_SSH_IDENTITY || path.join(process.env.HOME || '', '.ssh', 'air2');

/**
 * 构造探针 ssh 命令(纯函数,可单测)。
 * 约束:容器内 OpenSSH 按 /etc/passwd 找 root 家目录(/root/.ssh 只读且无 key),
 * 不看 $HOME —— 所以 identity 必须显式 -i,known_hosts 必须指向 /dev/null。
 */
export function buildSshCommand(server, cmd, opts = {}) {
  const identityPath = opts.identityPath ?? DEFAULT_SSH_IDENTITY();
  const identityArg = (identityPath && fs.existsSync(identityPath)) ? `-i ${identityPath} ` : '';
  return `ssh ${identityArg}-o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes "${server.sshUser}@${server.tailscaleIp}" ${JSON.stringify(cmd)}`;
}

export async function sshExec(server, cmd) {
  const { stdout } = await execAsync(buildSshCommand(server, cmd), { timeout: 8000 });
  return stdout.trim();
}
```

注意:文件头部确认已 import fs/path(没有则补 `import fs from 'fs'; import path from 'path';`)。

- [ ] **Step 5: 跑测确认 PASS**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/infra-status-ssh.test.js`
Expected: 3 passed

- [ ] **Step 6: commit-2(实现)**

```bash
git add packages/brain/src/routes/infra-status.js
git commit -m "fix(brain): fleet ssh 探针显式 identity + /dev/null known_hosts,修容器内 Permission denied(Issue 92d23693)"
```

### Task 2: selfcheck 环境守卫 compute_ssh_reachability(TDD)

**Files:**
- Modify: `packages/brain/src/selfcheck.js`
- Test: `packages/brain/src/__tests__/selfcheck-ssh-reachability.test.js`(新建)

**Interfaces:**
- Consumes: Task 1 的 `buildSshCommand`、infra-status.js 的 `SERVERS/COMPUTE_SERVERS`
- Produces: `export async function checkComputeSshReachability({ execFn } = {})` → `{ ok: boolean, unreachable: [{id, error}] }`;selfcheck 主流程将其结果并入 warnings(不阻塞启动)

- [ ] **Step 1: 写 failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { checkComputeSshReachability } from '../selfcheck.js';

describe('checkComputeSshReachability', () => {
  it('全部可达 → ok:true, unreachable 空', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'ok\n' });
    const r = await checkComputeSshReachability({ execFn });
    expect(r.ok).toBe(true);
    expect(r.unreachable).toEqual([]);
    expect(execFn).toHaveBeenCalled(); // 对每台 COMPUTE_SERVER 各一次
  });
  it('某台失败 → ok:false 且 unreachable 含该机器 id 与错误(降级可见,不 throw)', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const r = await checkComputeSshReachability({ execFn });
    expect(r.ok).toBe(false);
    expect(r.unreachable.length).toBeGreaterThan(0);
    expect(r.unreachable[0]).toHaveProperty('id');
    expect(r.unreachable[0].error).toContain('Permission denied');
  });
});
```

- [ ] **Step 2: 跑测确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/selfcheck-ssh-reachability.test.js`
Expected: FAIL(checkComputeSshReachability not exported)

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/selfcheck-ssh-reachability.test.js
git commit -m "test: selfcheck compute ssh 可达性守卫 failing test(TDD commit-1)"
```

- [ ] **Step 4: 最小实现**

selfcheck.js 增加(import 处补 `import { promisify } from 'util'; import { exec } from 'child_process';` 若已有沿用;从 './routes/infra-status.js' import `{ SERVERS, COMPUTE_SERVERS, buildSshCommand }`):

```js
const _execAsync = promisify(exec);

/**
 * 环境守卫:COMPUTE_SERVERS 容器内 ssh 可达性自检。
 * 失败不阻塞启动,只降级可见(红日志 + 结果并入 /health warnings)。
 * 为什么在真环境跑:这是环境接缝(容器→外部机器),CI 干净环境测不到。
 */
export async function checkComputeSshReachability({ execFn = _execAsync } = {}) {
  const targets = SERVERS.filter(s => COMPUTE_SERVERS.includes(s.id) && !s.isLocal);
  const unreachable = [];
  for (const server of targets) {
    try {
      await execFn(buildSshCommand(server, 'echo ok'), { timeout: 8000 });
    } catch (err) {
      unreachable.push({ id: server.id, error: String(err.message || err) });
    }
  }
  const ok = unreachable.length === 0;
  if (!ok) console.error(`[selfcheck] ❌ compute ssh 不可达: ${unreachable.map(u => u.id).join(', ')}`);
  return { ok, unreachable };
}
```

并在 selfcheck 主流程(runSelfcheck/startup 检查聚合处,读文件后按现有模式并入)追加调用,把 `unreachable` 非空时写进 warnings 数组(照文件内既有 warning 项写法,键名 `compute_ssh_reachability`)。

- [ ] **Step 5: 跑测确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/selfcheck-ssh-reachability.test.js`
Expected: 2 passed

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/selfcheck.js
git commit -m "feat(brain): selfcheck 加 compute_ssh_reachability 环境守卫(warn 不阻塞)"
```

### Task 3: 版本 bump + DevGate + 全量测试

**Files:**
- Modify: `packages/brain/package.json`(version patch +1;若有其他版本同步点由 check-version-sync.sh 指出)

**Interfaces:**
- Consumes: Task 1/2 全部产物

- [ ] **Step 1: bump 版本**

```bash
cd packages/brain && npm version patch --no-git-tag-version && cd ../..
```

- [ ] **Step 2: DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全绿;check-version-sync 若报其他文件需同步,按提示改齐后重跑。

- [ ] **Step 3: brain 全量单测 + 语法冒烟**

```bash
cd packages/brain && npx vitest run 2>&1 | tail -5 && node --check src/server.js && cd ../..
```
Expected: 无新增失败;server.js 语法 OK。

- [ ] **Step 4: commit**

```bash
git add -A
git commit -m "chore(brain): version bump(fleet ssh 探针修复)"
```
