# v2 P2 PR2 docker-run Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽 `docker-executor.js:437-503` 的 child_process.spawn Promise 块到 `packages/brain/src/spawn/middleware/docker-run.js`，零行为改动。

**Architecture:** 纯代码搬家。`docker-run.js` 只负责"跑 docker + 捕获输出 + 超时 kill"。`executeInDocker` 继续承担前置逻辑（validation / writePromptFile / resolveAccountForOpts / buildDockerArgs），最后调 `runDocker()`。

**Tech Stack:** Node.js ESM + child_process + vitest。

---

## File Structure

- **Create** `packages/brain/src/spawn/middleware/docker-run.js` — runDocker() 函数
- **Create** `packages/brain/src/spawn/middleware/__tests__/docker-run.test.js` — 4 个单测
- **Modify** `packages/brain/src/docker-executor.js:165` — `function` → `export function readContainerIdFromCidfile`
- **Modify** `packages/brain/src/docker-executor.js:396-506` — 删 L437-503 Promise 块，替换为 `await runDocker(args, {...})`；加 import 行

---

### Task 1: 建 docker-run.js middleware

**Files:**
- Create: `packages/brain/src/spawn/middleware/docker-run.js`

- [ ] **Step 1: 写文件**

写入 `packages/brain/src/spawn/middleware/docker-run.js`：

```js
/**
 * docker-run middleware — Brain v2 Layer 3（Executor）attempt-loop 内循环的终点。
 * 见 docs/design/brain-orchestrator-v2.md §5.2（内层 attempt-loop 第 d 步）。
 *
 * 职责：接收已经 build 好的 docker args + opts，执行 child_process.spawn('docker', args, ...)，
 * 捕获 stdout/stderr，超时 kill，返回统一 result shape。不做账号选择、不做 cascade、不做 429 判定 —
 * 那些都在外层 middleware。
 *
 * v2 P2 PR 2（本 PR）：纯代码搬家，从 docker-executor.js:437-503 抽出。
 *
 * @param {string[]} args       完整 docker CLI 参数（来自 buildDockerArgs）
 * @param {object}  opts        { taskId, taskType, timeoutMs, name, cidfile, command }
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, container, container_id, command, timed_out, started_at, ended_at }>}
 */
import { spawn as nodeSpawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { readContainerIdFromCidfile } from '../../docker-executor.js';

export async function runDocker(args, opts) {
  const { taskId, taskType, timeoutMs, name, cidfile, command } = opts;

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  return new Promise((resolve) => {
    const proc = nodeSpawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const killTimer = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[docker-run] timeout task=${taskId} after ${timeoutMs}ms — docker kill ${name}`
      );
      nodeSpawn('docker', ['kill', name], { stdio: 'ignore' });
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      console.error(`[docker-run] spawn error task=${taskId}: ${err.message}`);
      const endedAt = new Date().toISOString();
      resolve({
        exit_code: -1,
        stdout,
        stderr: stderr + `\n[docker-run] spawn error: ${err.message}`,
        duration_ms: Date.now() - startedAtMs,
        container: name,
        container_id: null,
        command,
        timed_out: false,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      const duration = Date.now() - startedAtMs;
      const endedAt = new Date().toISOString();
      console.log(
        `[docker-run] exit task=${taskId} code=${code} signal=${signal} duration=${duration}ms timed_out=${timedOut}`
      );
      if (String(taskType).startsWith('harness_') && code !== 0) {
        console.log('[docker-run] HARNESS_STDOUT_TAIL:', (stdout || '').slice(-2000));
        console.log('[docker-run] HARNESS_STDERR_TAIL:', (stderr || '').slice(-2000));
      }
      const containerId = readContainerIdFromCidfile(cidfile);
      if (cidfile && existsSync(cidfile)) {
        try { unlinkSync(cidfile); } catch { /* ignore */ }
      }
      resolve({
        exit_code: code == null ? -1 : code,
        stdout,
        stderr,
        duration_ms: duration,
        container: name,
        container_id: containerId,
        command,
        timed_out: timedOut,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });
  });
}
```

- [ ] **Step 2: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node --check packages/brain/src/spawn/middleware/docker-run.js
```

Expected: 无输出。

- [ ] **Step 3: Commit**（readContainerIdFromCidfile 还没 export，先不要 import 运行测，留给 Task 2 完成后跑 import）

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && git add packages/brain/src/spawn/middleware/docker-run.js && git commit -m "feat(brain): v2 P2 PR2 新增 spawn/middleware/docker-run.js"
```

---

### Task 2: 把 readContainerIdFromCidfile 改成 export function

**Files:**
- Modify: `packages/brain/src/docker-executor.js:165`

- [ ] **Step 1: 用 Edit 改声明行**

原文（L165）：
```js
function readContainerIdFromCidfile(cidPath) {
```

改成：
```js
export function readContainerIdFromCidfile(cidPath) {
```

其它一字不改。

- [ ] **Step 2: 语法检查 + import smoke**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node --check packages/brain/src/docker-executor.js && node -e "import('./packages/brain/src/docker-executor.js').then(m => { if(typeof m.readContainerIdFromCidfile !== 'function') process.exit(1); console.log('ok'); })"
```

Expected: `ok`。

- [ ] **Step 3: 验证 docker-run import 链能通**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node -e "import('./packages/brain/src/spawn/middleware/docker-run.js').then(m => { if(typeof m.runDocker !== 'function') process.exit(1); console.log('ok'); })"
```

Expected: `ok`。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && git add packages/brain/src/docker-executor.js && git commit -m "refactor(brain): v2 P2 PR2 export readContainerIdFromCidfile 供 spawn middleware 使用"
```

---

### Task 3: 改 executeInDocker 调用 runDocker

**Files:**
- Modify: `packages/brain/src/docker-executor.js:396-506` (executeInDocker body)
- Modify: `packages/brain/src/docker-executor.js` 顶部 import 区

- [ ] **Step 1: 加 import 行**

用 Edit 在 `docker-executor.js` 的 import 区（L1-30 附近）找到其它 `import { ... } from './...';` 行，**在最后一行 import 后面**加入：

```js
import { runDocker } from './spawn/middleware/docker-run.js';
```

- [ ] **Step 2: 替换 executeInDocker 的 Promise 块**

用 Edit 把 `docker-executor.js:437-503` 的整段 Promise 块：

```js
  const result = await new Promise((resolve) => {
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const killTimer = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[docker-executor] timeout task=${taskId} after ${timeoutMs}ms — docker kill ${name}`
      );
      // --rm 模式下 kill 后容器自动销毁，不必手动 rm
      spawn('docker', ['kill', name], { stdio: 'ignore' });
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      console.error(`[docker-executor] spawn error task=${taskId}: ${err.message}`);
      const endedAt = new Date().toISOString();
      resolve({
        exit_code: -1,
        stdout,
        stderr: stderr + `\n[docker-executor] spawn error: ${err.message}`,
        duration_ms: Date.now() - startedAtMs,
        container: name,
        container_id: null,
        command,
        timed_out: false,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      const duration = Date.now() - startedAtMs;
      const endedAt = new Date().toISOString();
      console.log(
        `[docker-executor] exit task=${taskId} code=${code} signal=${signal} duration=${duration}ms timed_out=${timedOut}`
      );
      // DEBUG: harness_* 任务 exit != 0 时 dump stdout + stderr 最后 2KB
      if (String(taskType).startsWith('harness_') && code !== 0) {
        console.log('[docker-executor] HARNESS_STDOUT_TAIL:', (stdout || '').slice(-2000));
        console.log('[docker-executor] HARNESS_STDERR_TAIL:', (stderr || '').slice(-2000));
      }
      const containerId = readContainerIdFromCidfile(cidfile);
      // cidfile 读完即可清理，保持 prompt_dir 整洁
      if (cidfile && existsSync(cidfile)) {
        try { unlinkSync(cidfile); } catch { /* ignore */ }
      }
      resolve({
        exit_code: code == null ? -1 : code,
        stdout,
        stderr,
        duration_ms: duration,
        container: name,
        container_id: containerId,
        command,
        timed_out: timedOut,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });
  });

  return result;
```

替换为：

```js
  const result = await runDocker(args, {
    taskId,
    taskType,
    timeoutMs,
    name,
    cidfile,
    command,
  });

  return result;
```

**注意**：原代码里 `startedAtMs` + `startedAt` 两个变量在 Promise 块外（L426-427）定义，Promise 块外的 `console.log(... spawn task=${taskId})` 预览日志（L429-435）**保留**。删除范围只是 L437-503 那个 `const result = await new Promise(...)` 块。

- [ ] **Step 3: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node --check packages/brain/src/docker-executor.js
```

Expected: 无输出。

- [ ] **Step 4: import smoke（验证迁移后 executeInDocker 还能导入）**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node -e "import('./packages/brain/src/docker-executor.js').then(m => { if(typeof m.executeInDocker !== 'function') process.exit(1); console.log('ok'); })"
```

Expected: `ok`。

- [ ] **Step 5: 验证 Promise 块已消失**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && grep -c "const proc = spawn('docker'" packages/brain/src/docker-executor.js
```

Expected: `0`（搬到 docker-run.js 了）。

- [ ] **Step 6: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && git add packages/brain/src/docker-executor.js && git commit -m "refactor(brain): v2 P2 PR2 executeInDocker 调用 runDocker middleware"
```

---

### Task 4: 建 docker-run 单测

**Files:**
- Create: `packages/brain/src/spawn/middleware/__tests__/docker-run.test.js`

- [ ] **Step 1: 写测试文件**

写入 `packages/brain/src/spawn/middleware/__tests__/docker-run.test.js`：

```js
/**
 * docker-run middleware 单测。
 * 验证 runDocker 的"快乐路径 / 超时 / spawn error / stdout+stderr 分别捕获"四种情况。
 * 用 vi.mock('child_process') 避免真跑 docker。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const mockSpawnFn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...args) => mockSpawnFn(...args) }));
vi.mock('../../../docker-executor.js', () => ({
  readContainerIdFromCidfile: () => null,
}));

function makeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('runDocker() docker-run middleware', () => {
  let runDocker;
  beforeEach(async () => {
    mockSpawnFn.mockReset();
    vi.resetModules();
    ({ runDocker } = await import('../docker-run.js'));
  });

  it('resolves with exit_code 0 on happy path', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run', '--rm', 'img'], { taskId: 't1', taskType: 'dev', timeoutMs: 5000, name: 'c1', cidfile: null, command: 'docker run' });
    proc.stdout.emit('data', 'ok');
    proc.emit('exit', 0, null);
    const r = await p;
    expect(r.exit_code).toBe(0);
    expect(r.stdout).toBe('ok');
    expect(r.timed_out).toBe(false);
  });

  it('marks timed_out when kill timer fires', async () => {
    vi.useFakeTimers();
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc).mockReturnValueOnce(makeProc());
    const p = runDocker(['run', '--rm', 'img'], { taskId: 't2', taskType: 'dev', timeoutMs: 100, name: 'c2', cidfile: null, command: 'docker run' });
    vi.advanceTimersByTime(200);
    proc.emit('exit', 137, null);
    const r = await p;
    expect(r.timed_out).toBe(true);
    vi.useRealTimers();
  });

  it('resolves with exit_code -1 on spawn error', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run', '--rm', 'img'], { taskId: 't3', taskType: 'dev', timeoutMs: 5000, name: 'c3', cidfile: null, command: 'docker run' });
    proc.emit('error', new Error('boom'));
    const r = await p;
    expect(r.exit_code).toBe(-1);
    expect(r.stderr).toContain('spawn error: boom');
  });

  it('captures stdout and stderr separately', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run'], { taskId: 't4', taskType: 'dev', timeoutMs: 5000, name: 'c4', cidfile: null, command: '' });
    proc.stdout.emit('data', 'out-');
    proc.stdout.emit('data', 'tail');
    proc.stderr.emit('data', 'err-');
    proc.stderr.emit('data', 'tail');
    proc.emit('exit', 0, null);
    const r = await p;
    expect(r.stdout).toBe('out-tail');
    expect(r.stderr).toBe('err-tail');
  });
});
```

- [ ] **Step 2: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node --check packages/brain/src/spawn/middleware/__tests__/docker-run.test.js
```

Expected: 无输出。

- [ ] **Step 3: 跑 vitest（本地试）**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && npx vitest run packages/brain/src/spawn/middleware/__tests__/docker-run.test.js 2>&1 | tail -15
```

Expected: 4 tests pass。若本地 vitest 跑不起来，CI 会跑。记录实际输出。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && git add packages/brain/src/spawn/middleware/__tests__/docker-run.test.js && git commit -m "test(brain): v2 P2 PR2 docker-run middleware 单测 (4 cases)"
```

---

### Task 5: DoD 终验

**Files:** 无改动，只跑验证命令。

- [ ] **Step 1: DoD 1 — docker-run.js 存在 + export**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node -e "import('./packages/brain/src/spawn/middleware/docker-run.js').then(m => { if(typeof m.runDocker !== 'function') process.exit(1) })" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **Step 2: DoD 2 — Promise 块已搬离 executeInDocker**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(c.match(/const proc = spawn\('docker'/)) process.exit(1)" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **Step 3: DoD 3 — executeInDocker 调 runDocker**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!c.includes('await runDocker(args,')) process.exit(1)" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **Step 4: DoD 4 — readContainerIdFromCidfile 已 export**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!c.includes('export function readContainerIdFromCidfile')) process.exit(1)" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **Step 5: DoD 5 — 测试文件存在**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node -e "require('fs').accessSync('packages/brain/src/spawn/middleware/__tests__/docker-run.test.js')" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **Step 6: facts-check 通过**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr2-docker-run-middleware && node scripts/facts-check.mjs 2>&1 | tail -3
```
Expected: `All facts consistent.`

- [ ] **Step 7: 不 commit — 验证完交给 engine-ship。**

---

## Self-Review

### Spec Coverage

| Spec 要求 | Task |
|---|---|
| 建 `docker-run.js` | Task 1 |
| `readContainerIdFromCidfile` 改 export | Task 2 |
| `executeInDocker` 改调 `runDocker` | Task 3 |
| 建 docker-run 单测（4 case） | Task 4 |
| DoD 5 条 [BEHAVIOR] | Task 5 |

### Placeholder Scan

无 TBD / TODO / "implement later" 等。所有代码块完整。

### Type Consistency

- `runDocker(args, opts)` 签名在 Task 1 和 Task 3 Step 2 一致
- `opts` 字段 `{ taskId, taskType, timeoutMs, name, cidfile, command }` 两处一致
- 返回值字段 `{ exit_code, stdout, stderr, duration_ms, container, container_id, command, timed_out, started_at, ended_at }` 10 字段一致

### Scope

严格按 spec：不动 `resolveAccountForOpts` / `buildDockerArgs` / `writePromptFile` / 其它 caller / 硬编码 account1。
