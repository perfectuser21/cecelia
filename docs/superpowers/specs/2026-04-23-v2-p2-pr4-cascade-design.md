# P2 PR 4：cascade Middleware

## 背景

v2 P2 第 4 PR。按 spec §5.2（内层 attempt-loop 第 b 步）+ §5.3（遍历顺序），建立 **cascade middleware** — 负责把 `opts.cascade`（模型降级链）填充到位。

当前现状：
- `model-profile.js:355` 已有 `getCascadeForTask(task)` 返回 `string[]`（例如 `['claude-sonnet-4-6','claude-opus-4-7','claude-haiku-4-5-20251001']`）
- `executor.js:3070` 调 `getCascadeForTask(task)` + 传给 `selectBestAccount({ cascade })`
- PR3 的 `account-rotation` middleware 用 `opts.cascade` — 但 spawn 路径下没人给 opts.cascade 赋值
- 所以 spawn 路径目前 selectBestAccount 拿不到 cascade，掉回内部默认

本 PR 修这个 gap：新增 `resolveCascade(opts)` middleware，`executeInDocker` 在 `resolveAccount` **之前**调它，填充 `opts.cascade`。

## 目标

1. 新建 `packages/brain/src/spawn/middleware/cascade.js` export `resolveCascade`
2. `executeInDocker` 在 `resolveAccount` 前调用 `resolveCascade(opts)`
3. 新测试 5 cases

## 交付物

### 1. `packages/brain/src/spawn/middleware/cascade.js`

```js
/**
 * cascade middleware — Brain v2 Layer 3 attempt-loop 内循环第 b 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2 + §5.3。
 *
 * 职责：若 opts.cascade 未设（caller 没显式传），用 getCascadeForTask(opts.task) 填充。
 * 显式传入的 opts.cascade **尊重不覆盖**（遵循 §5.3 "CLAUDE_MODEL_OVERRIDE" 同风格优先级）。
 *
 * v2 P2 PR 4（本 PR）：新建 middleware，下游 account-rotation 已经读 opts.cascade，
 * 填充后 selectBestAccount 能用到正确的降级链。
 *
 * @param {object} opts  { task, cascade? }
 * @param {object} ctx   { deps? } — 测试注入（可选）
 * @returns {void} — 原地修改 opts.cascade
 */
export function resolveCascade(opts, ctx = {}) {
  if (opts.cascade) return; // 尊重显式传入
  if (!opts.task) return;   // 没 task 也没得查
  try {
    const deps = ctx.deps || null;
    let getCascade;
    if (deps?.getCascadeForTask) {
      getCascade = deps.getCascadeForTask;
    } else {
      // 动态 import 避免循环依赖 + 保持测试可注入
      const mod = require('../../model-profile.js');
      getCascade = mod.getCascadeForTask;
    }
    const cascade = getCascade(opts.task);
    if (Array.isArray(cascade) && cascade.length > 0) {
      opts.cascade = cascade;
    }
  } catch (err) {
    console.warn(`[cascade] middleware failed (keeping opts.cascade undefined): ${err.message}`);
  }
}
```

**注意**：这里用 `require` 而不是 top-level `import`，是因为 `model-profile.js` 会触发 DB pool 初始化；在纯单测环境下 top-level import 可能引入副作用。require 是 lazy 的。如果工具链不支持，回退到 `import` 并接受 top-level load。

### 2. 改 `docker-executor.js` — 在 resolveAccount 前调 resolveCascade

加 import：
```js
import { resolveCascade } from './spawn/middleware/cascade.js';
```

改 `executeInDocker` 里 L412-414 附近：

改前：
```js
  opts.env = opts.env || {};
  await resolveAccount(opts, { taskId });
```

改后：
```js
  opts.env = opts.env || {};
  resolveCascade(opts);
  await resolveAccount(opts, { taskId });
```

### 3. 新测试 `packages/brain/src/spawn/middleware/__tests__/cascade.test.js`

```js
import { describe, it, expect } from 'vitest';
import { resolveCascade } from '../cascade.js';

const mockCascade = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'];

function deps(cascade = mockCascade) {
  return { getCascadeForTask: (_task) => cascade };
}

describe('resolveCascade() cascade middleware', () => {
  it('respects explicit opts.cascade (no override)', () => {
    const opts = { task: { task_type: 'dev' }, cascade: ['explicit-model'] };
    resolveCascade(opts, { deps: deps() });
    expect(opts.cascade).toEqual(['explicit-model']);
  });

  it('fills opts.cascade from task when unset', () => {
    const opts = { task: { task_type: 'dev' } };
    resolveCascade(opts, { deps: deps() });
    expect(opts.cascade).toEqual(mockCascade);
  });

  it('no-op when no task', () => {
    const opts = {};
    resolveCascade(opts, { deps: deps() });
    expect(opts.cascade).toBeUndefined();
  });

  it('no-op when getCascadeForTask returns empty array', () => {
    const opts = { task: { task_type: 'dev' } };
    resolveCascade(opts, { deps: deps([]) });
    expect(opts.cascade).toBeUndefined();
  });

  it('keeps opts.cascade undefined when deps throw', () => {
    const opts = { task: { task_type: 'dev' } };
    const d = { getCascadeForTask: () => { throw new Error('boom'); } };
    resolveCascade(opts, { deps: d });
    expect(opts.cascade).toBeUndefined();
  });
});
```

## 不做

- **不**改 `getCascadeForTask` 内部逻辑
- **不**改 `executor.js:3070` 原 dispatchTask 路径（它走 dispatchTask 自己的 selectBestAccount，不经过 spawn）
- **不**动 `account-rotation`（已在 PR3 建立，继续读 opts.cascade）
- **不**动 `selectBestAccount`

## DoD

- [BEHAVIOR] cascade.js export resolveCascade
  Test: `manual:node -e "import('./packages/brain/src/spawn/middleware/cascade.js').then(m => { if(typeof m.resolveCascade !== 'function') process.exit(1) })"`
- [BEHAVIOR] docker-executor.js 调 resolveCascade(opts) 在 resolveAccount 之前
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); const ci=c.indexOf('resolveCascade(opts)'); const ai=c.indexOf('await resolveAccount(opts'); if(ci<0||ai<0||ci>ai) process.exit(1)"`
- [BEHAVIOR] cascade test 文件存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/spawn/middleware/__tests__/cascade.test.js')"`
