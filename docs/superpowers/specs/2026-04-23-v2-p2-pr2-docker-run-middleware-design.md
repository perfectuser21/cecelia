# P2 PR 2：docker-run Middleware 抽出

## 背景

Brain v2 P2 第二 PR。PR 1（#2543）已建好 `spawn()` 骨架。现在抽 executeInDocker 的核心 — 纯 docker spawn 那一块（L437-503） — 到独立 middleware。

完整 spec: `docs/design/brain-orchestrator-v2.md` §5.2。PR 1 scaffold README 已就位 `packages/brain/src/spawn/README.md`。

## 目标

把 `docker-executor.js` 里"实际 child_process.spawn('docker', ...) + 捕获输出 + 返回结果"的 Promise 块搬到 `packages/brain/src/spawn/middleware/docker-run.js`。`executeInDocker` 其它部分不动（validation / writePromptFile / resolveAccountForOpts / buildDockerArgs 保留）。

**零行为改动 + 零性能退化 + 零新功能**。纯物理搬家。

## 交付物

### 1. 新建 `packages/brain/src/spawn/middleware/docker-run.js`

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
 * 后续 PR 会把外层调用链改成直接调用 runDocker()。
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

**导出 `readContainerIdFromCidfile`**：原本 `docker-executor.js:165` 的 `readContainerIdFromCidfile` 是本地函数没 export。本 PR 把它改为 `export`，让 `docker-run.js` 能用。零行为改动。

### 2. 改 `docker-executor.js:396-506` `executeInDocker`

把 L437-503 的 Promise 块删掉，替换成：

```js
  const result = await runDocker(args, {
    taskId,
    taskType,
    timeoutMs,
    name,
    cidfile,
    command,
  });

  console.log(
    `[docker-executor] exit task=${taskId} code=${result.exit_code} duration=${result.duration_ms}ms timed_out=${result.timed_out}`
  );

  return result;
```

加 import：`import { runDocker } from './spawn/middleware/docker-run.js';`

### 3. 改 `docker-executor.js:165` 让 `readContainerIdFromCidfile` export

```js
// 改前
function readContainerIdFromCidfile(cidPath) { ... }

// 改后
export function readContainerIdFromCidfile(cidPath) { ... }
```

### 4. 新测试 `packages/brain/src/spawn/middleware/__tests__/docker-run.test.js`

```js
/**
 * docker-run middleware 单测。
 * 验证 runDocker 的"快乐路径 / 超时 / spawn error"三种情况。
 * 用 vi.mock('child_process') 避免真跑 docker。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const mockSpawnFn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...args) => mockSpawnFn(...args) }));
vi.mock('../../../docker-executor.js', () => ({
  readContainerIdFromCidfile: () => null,
}));

// 仿造一个 child_process 进程
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
    mockSpawnFn.mockReturnValueOnce(proc).mockReturnValueOnce(makeProc()); // 第二次 spawn 是 docker kill
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

## 不做

- **不**改 `spawn()` 的调用方式（`spawn.js` 继续调 `executeInDocker`，后续 PR 再改）
- **不**改 `resolveAccountForOpts`（PR 3 账号轮换 middleware 的事）
- **不**改 `buildDockerArgs`（继续用原函数）
- **不**动 `writePromptFile`（PR 8 spawn-pre middleware 的事）
- **不**改其它 caller
- **不**删硬编码 account1

## DoD

- [BEHAVIOR] `docker-run.js` 存在且 export `runDocker` 函数
  Test: `manual:node -e "import('./packages/brain/src/spawn/middleware/docker-run.js').then(m => { if(typeof m.runDocker !== 'function') process.exit(1) })"`
- [BEHAVIOR] `executeInDocker` 内不再含 `new Promise((resolve) => { const proc = spawn('docker'` 的 inline 块
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(c.match(/const proc = spawn\\('docker'/)) process.exit(1)"`
- [BEHAVIOR] `executeInDocker` 改调 `runDocker`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!c.includes('await runDocker(args,')) process.exit(1)"`
- [BEHAVIOR] `readContainerIdFromCidfile` 已 export
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!c.includes('export function readContainerIdFromCidfile')) process.exit(1)"`
- [BEHAVIOR] docker-run 测试文件存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/spawn/middleware/__tests__/docker-run.test.js')"`
