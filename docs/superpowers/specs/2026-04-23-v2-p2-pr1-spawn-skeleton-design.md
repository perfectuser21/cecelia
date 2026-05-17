# P2 PR 1：Spawn Skeleton + README 到位 + 第一个 Caller 迁移

## 背景

Brain Orchestrator v2 架构 P2（Spawn Policy Layer）的第一个 PR。完整 spec：`docs/design/brain-orchestrator-v2.md` §5 + `docs/design/v2-scaffolds/spawn-readme.md`。

P1 骨架已合入 main（#2538），现在开始真正动代码。本 PR 零行为改动，纯结构铺垫。

## 目标

1. 建立 `packages/brain/src/spawn/` 目录和 `spawn.js` 文件（暂时是 `executeInDocker` 的 1:1 wrapper）
2. `git mv docs/design/v2-scaffolds/spawn-readme.md packages/brain/src/spawn/README.md`
3. 迁移 1 个 caller（`harness-initiative-runner.js`）从 `executeInDocker` 调到 `spawn()`，作为 migration pattern 样例
4. 加 `SPAWN_V2_ENABLED` env flag（默认 true，false 时 wrap 不做任何附加逻辑，等同旧行为）

## 不做

- **不**抽 middleware（docker-run / rotation / cascade 等留给后续 PR）
- **不**删硬编码 account1（留给 PR 10）
- **不**动 executeInDocker 的任何内部逻辑
- **不**改其它 caller（content-pipeline-graph-runner / executor / 其它 harness-*）

## 交付物

### 1. `packages/brain/src/spawn/spawn.js`

```js
/**
 * 唯一 spawn 原语 — 见 docs/design/brain-orchestrator-v2.md §5。
 * 
 * v2 P2 PR 1：skeleton。当前只 wrap executeInDocker 1:1，不引入 middleware。
 * 后续 PR 逐步把 middleware 搬进来。
 * 
 * @param {object} opts  { task, skill, prompt, env, timeoutMs, cascade, worktree }
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, account_used?, model_used?, cost_usd? }>}
 */
import { executeInDocker } from '../docker-executor.js';

const SPAWN_V2_ENABLED = process.env.SPAWN_V2_ENABLED !== 'false'; // 默认 true

export async function spawn(opts) {
  if (!SPAWN_V2_ENABLED) {
    // 回滚路径：直接走旧 executeInDocker，零改动
    return executeInDocker(opts);
  }

  // v2 路径：当前只是 pass-through，后续 PR 会在这里接 middleware 链
  const result = await executeInDocker(opts);
  return result;
}
```

### 2. `packages/brain/src/spawn/index.js`

```js
export { spawn } from './spawn.js';
```

### 3. git mv `docs/design/v2-scaffolds/spawn-readme.md` → `packages/brain/src/spawn/README.md`

README 里的"状态"行更新：P1 完成 → P2 PR 1 落地。

### 4. 迁移 `packages/brain/src/harness-initiative-runner.js`

把所有 `executeInDocker(...)` 调用点改成 `spawn(...)`：

```js
// 改前
import { executeInDocker } from './docker-executor.js';
// ...
const result = await executeInDocker({ task, skill: '/harness-planner', prompt, env, ... });

// 改后
import { spawn } from './spawn/index.js';
// ...
const result = await spawn({ task, skill: '/harness-planner', prompt, env, ... });
```

只替换 import 和调用名，其它一字不改。

### 5. 测试

新建 `packages/brain/src/spawn/__tests__/spawn.test.js`：

```js
import { describe, it, expect, vi } from 'vitest';
import { spawn } from '../spawn.js';

describe('spawn() skeleton', () => {
  it('exports spawn function', () => {
    expect(typeof spawn).toBe('function');
  });

  it('passes through to executeInDocker (v2 enabled)', async () => {
    // Mock executeInDocker 验证 opts 原样传入
    // 由于 spawn.js 内部 import，这里用 vi.mock
    // 实际测试逻辑略，只需证明 wrapper 不丢参数
  });

  it('passes through to executeInDocker (v2 disabled)', async () => {
    process.env.SPAWN_V2_ENABLED = 'false';
    // ... 同上验证
  });
});
```

简单测试，证明 wrapper 存在且可调用。middleware 集成测试留给后续 PR。

## DoD

- [BEHAVIOR] `packages/brain/src/spawn/spawn.js` 导出 `spawn` 函数
  Test: `manual:node -e "import('./packages/brain/src/spawn/spawn.js').then(m => { if(typeof m.spawn !== 'function') process.exit(1); })"`
- [BEHAVIOR] README 已在目标位置
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/spawn/README.md')"`
- [BEHAVIOR] scaffolds 位置已清空
  Test: `manual:node -e "if(require('fs').existsSync('docs/design/v2-scaffolds/spawn-readme.md')) process.exit(1)"`
- [BEHAVIOR] harness-initiative-runner.js 已改用 spawn
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-runner.js','utf8'); if(!c.includes(\"from './spawn/\") || c.match(/executeInDocker\\s*\\(/)) process.exit(1)"`
- [BEHAVIOR] spawn test 文件存在（CI vitest 会跑它）
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/spawn/__tests__/spawn.test.js')"`

## 分支命名

`cp-MMDDHHNN-v2-p2-pr1-spawn-skeleton`
