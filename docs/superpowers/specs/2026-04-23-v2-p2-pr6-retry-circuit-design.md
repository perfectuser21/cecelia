# P2 PR 6：retry-circuit Middleware（模块 + 测试，暂不接线）

## 背景

v2 P2 第 6 PR。spec §5.2 内层 attempt-loop 第 f 步 — 对 transient 失败（网络错误、非 cap 的 500 系列）做有限次重试；permanent 失败（syntax error、docker image not found 等）不重试直接报错。当前 Brain 熔断逻辑散落在 `routes/execution.js`，本 PR 建立独立 middleware 函数，暂不接线。

## 目标

1. 新建 `packages/brain/src/spawn/middleware/retry-circuit.js` export `classifyFailure(result)` + `shouldRetry(classification, attemptIndex, maxAttempts)`
2. 新建单测 7 cases
3. **不**改 executeInDocker / 其它文件

## 交付物

### 1. `packages/brain/src/spawn/middleware/retry-circuit.js`

```js
/**
 * retry-circuit middleware — Brain v2 Layer 3 attempt-loop 内循环第 f 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：根据 runDocker result 判断失败类型（transient 可重试 vs permanent 不可重试），
 * 并给出本次 attempt 是否该进入下一次 attempt-loop 迭代。
 *
 * v2 P2 PR 6（本 PR）：建立模块 + 单测，暂不接线。attempt-loop 整合 PR 里接入。
 *
 * 失败分类（简单启发式）：
 *   - exit_code === 0                                                → success（不重试）
 *   - timed_out === true                                              → transient（重试）
 *   - stderr 含 'ECONNREFUSED' / 'ETIMEDOUT' / 'ENETUNREACH' / 'ECONNRESET' → transient
 *   - stderr 含 'Unable to find image' / 'manifest unknown'           → permanent（不重试，docker image 问题）
 *   - stderr 含 'No such container' / 'container not found'           → permanent
 *   - exit_code === 124（通常 timeout 标志）                           → transient
 *   - exit_code === 137（SIGKILL，OOM 常见）                           → permanent（资源问题不重试）
 *   - 其它 exit_code !== 0                                            → transient（默认可重试）
 *
 * @param {object} result  runDocker 返回 { exit_code, stdout, stderr, timed_out, ... }
 * @returns {{ class: 'success'|'transient'|'permanent', reason: string|null }}
 */
const PERMANENT_PATTERNS = [
  /Unable to find image/i,
  /manifest unknown/i,
  /No such container/i,
  /container not found/i,
  /invalid reference format/i,
];

const TRANSIENT_PATTERNS = [
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ENETUNREACH/,
  /ECONNRESET/,
  /socket hang up/i,
];

export function classifyFailure(result) {
  if (!result || typeof result !== 'object') {
    return { class: 'transient', reason: 'no-result' };
  }
  if (result.exit_code === 0) {
    return { class: 'success', reason: null };
  }
  if (result.timed_out === true || result.exit_code === 124) {
    return { class: 'transient', reason: 'timeout' };
  }
  if (result.exit_code === 137) {
    return { class: 'permanent', reason: 'oom-or-killed' };
  }
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  for (const p of PERMANENT_PATTERNS) {
    if (p.test(combined)) {
      return { class: 'permanent', reason: `pattern:${p.source}` };
    }
  }
  for (const p of TRANSIENT_PATTERNS) {
    if (p.test(combined)) {
      return { class: 'transient', reason: `pattern:${p.source}` };
    }
  }
  return { class: 'transient', reason: `exit_code:${result.exit_code}` };
}

/**
 * 根据 classification + 当前 attempt 数判断是否继续下一次 attempt。
 *
 * @param {{ class: string }} classification  classifyFailure 返回值
 * @param {number} attemptIndex  当前是第几次 attempt（0-based）
 * @param {number} maxAttempts   最大 attempt 次数（默认 3）
 * @returns {boolean}
 */
export function shouldRetry(classification, attemptIndex, maxAttempts = 3) {
  if (!classification) return false;
  if (classification.class !== 'transient') return false;
  if (attemptIndex + 1 >= maxAttempts) return false;
  return true;
}
```

### 2. `packages/brain/src/spawn/middleware/__tests__/retry-circuit.test.js`

```js
import { describe, it, expect } from 'vitest';
import { classifyFailure, shouldRetry } from '../retry-circuit.js';

describe('classifyFailure()', () => {
  it('exit_code 0 → success', () => {
    expect(classifyFailure({ exit_code: 0, stdout: '', stderr: '' }).class).toBe('success');
  });
  it('timed_out true → transient', () => {
    expect(classifyFailure({ exit_code: 137, timed_out: true, stderr: '' }).class).toBe('transient');
  });
  it('exit_code 124 → transient timeout', () => {
    expect(classifyFailure({ exit_code: 124, stderr: '' }).class).toBe('transient');
  });
  it('exit_code 137 without timed_out → permanent OOM', () => {
    expect(classifyFailure({ exit_code: 137, stderr: '' }).class).toBe('permanent');
  });
  it('Unable to find image → permanent', () => {
    expect(classifyFailure({ exit_code: 125, stderr: 'Unable to find image myimg' }).class).toBe('permanent');
  });
  it('ECONNREFUSED → transient', () => {
    expect(classifyFailure({ exit_code: 1, stderr: 'connect ECONNREFUSED 127.0.0.1:8080' }).class).toBe('transient');
  });
  it('unknown exit_code → transient default', () => {
    expect(classifyFailure({ exit_code: 42, stderr: 'weird error' }).class).toBe('transient');
  });
  it('null result → transient', () => {
    expect(classifyFailure(null).class).toBe('transient');
  });
});

describe('shouldRetry()', () => {
  it('permanent never retries', () => {
    expect(shouldRetry({ class: 'permanent' }, 0, 3)).toBe(false);
  });
  it('success never retries', () => {
    expect(shouldRetry({ class: 'success' }, 0, 3)).toBe(false);
  });
  it('transient retries when attempts < max', () => {
    expect(shouldRetry({ class: 'transient' }, 0, 3)).toBe(true);
    expect(shouldRetry({ class: 'transient' }, 1, 3)).toBe(true);
  });
  it('transient stops at max attempts', () => {
    expect(shouldRetry({ class: 'transient' }, 2, 3)).toBe(false);
  });
  it('null classification → no retry', () => {
    expect(shouldRetry(null, 0, 3)).toBe(false);
  });
});
```

## DoD

- [BEHAVIOR] retry-circuit.js export classifyFailure + shouldRetry
  Test: `manual:node -e "import('./packages/brain/src/spawn/middleware/retry-circuit.js').then(m => { if(typeof m.classifyFailure !== 'function' || typeof m.shouldRetry !== 'function') process.exit(1) })"`
- [BEHAVIOR] retry-circuit test 存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/spawn/middleware/__tests__/retry-circuit.test.js')"`
- [BEHAVIOR] executeInDocker 未改
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(c.includes('classifyFailure(') || c.includes('shouldRetry(') || c.includes('retry-circuit')) process.exit(1)"`
