# v2 P2 PR1 Spawn Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `packages/brain/src/spawn/` 目录、`spawn()` API 和 `SPAWN_V2_ENABLED` 回滚 flag，把 `harness-initiative-runner.js` 迁到新 API，零行为改动。

**Architecture:** `spawn.js` 只是 `executeInDocker` 的 1:1 wrapper。middleware 链留给 PR 2+ 逐步搬。README 从 scaffolds 位置 `git mv` 到位。

**Tech Stack:** Node.js ESM + vitest + Cecelia Brain 现有 docker-executor.js。

---

## File Structure

- **Create** `packages/brain/src/spawn/spawn.js` — wrapper 函数
- **Create** `packages/brain/src/spawn/index.js` — re-export
- **Create** `packages/brain/src/spawn/__tests__/spawn.test.js` — 基础 smoke test
- **Move** `docs/design/v2-scaffolds/spawn-readme.md` → `packages/brain/src/spawn/README.md`（`git mv`）
- **Modify** `packages/brain/src/harness-initiative-runner.js:29` — import 路径
- **Modify** `packages/brain/src/harness-initiative-runner.js:65` — `executor` 默认值
- **Modify** `packages/brain/src/harness-initiative-runner.js:118` — 注释里的文字更新（`executeInDocker middleware` → `spawn middleware`）

实际只有 3 处改动（import / 默认 executor / 注释），harness-initiative-runner 的业务逻辑不动。

---

### Task 1: 建 `spawn.js` wrapper + `index.js` 导出

**Files:**
- Create: `packages/brain/src/spawn/spawn.js`
- Create: `packages/brain/src/spawn/index.js`

- [ ] **Step 1: 建 `spawn.js` 内容**

写入 `packages/brain/src/spawn/spawn.js`：

```js
/**
 * spawn — Brain v2 三层架构 Layer 3（Executor）的唯一对外 API。
 *
 * 详见 docs/design/brain-orchestrator-v2.md §5 + ./README.md。
 *
 * v2 P2 PR 1（本 PR）：skeleton 阶段。当前实现只是 executeInDocker 的 1:1 wrapper，
 * 保证零行为改动。后续 PR 会在 SPAWN_V2_ENABLED=true 分支里接入 middleware 链
 * （外层 cost-cap / spawn-pre / logging / billing + 内层 attempt-loop 含
 * rotation × cascade × docker-run × cap-marking × retry）。
 *
 * @param {object} opts
 * @param {object} opts.task        { id, task_type, ... }
 * @param {string} opts.skill       skill slash-command（如 '/harness-planner'）
 * @param {string} opts.prompt      agent 初始 prompt
 * @param {object} [opts.env]       显式 env（现阶段全部透传给 executeInDocker）
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cascade]   模型降级链 override（PR 4 生效）
 * @param {object} [opts.worktree]  { path, branch }
 *
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, ... }>}
 *   现阶段直接透传 executeInDocker 的返回值结构；PR 2+ 会把
 *   account_used / model_used / cost_usd / attempts[] 字段落实到这里。
 */
import { executeInDocker } from '../docker-executor.js';

const SPAWN_V2_ENABLED = process.env.SPAWN_V2_ENABLED !== 'false';

export async function spawn(opts) {
  if (!SPAWN_V2_ENABLED) {
    return executeInDocker(opts);
  }
  return executeInDocker(opts);
}
```

**注意**：两条分支现在是一样的（纯 skeleton）。flag 存在只是为 PR 2+ 引入 middleware 时有回滚开关，Alex 明示"不做双跑兼容"——PR 11 会把 flag 和 else 分支一起删掉。

- [ ] **Step 2: 建 `index.js`**

写入 `packages/brain/src/spawn/index.js`：

```js
export { spawn } from './spawn.js';
```

- [ ] **Step 3: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node --check packages/brain/src/spawn/spawn.js && node --check packages/brain/src/spawn/index.js
```

Expected: 无输出（语法正确）。

- [ ] **Step 4: 运行时 smoke（不跑 docker，只验 import 链）**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node -e "import('./packages/brain/src/spawn/index.js').then(m => { if(typeof m.spawn !== 'function') process.exit(1); console.log('ok'); })"
```

Expected: 输出 `ok`。

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && git add packages/brain/src/spawn/spawn.js packages/brain/src/spawn/index.js && git commit -m "feat(brain): v2 P2 PR1 spawn() skeleton wrapper"
```

---

### Task 2: 建 smoke test

**Files:**
- Create: `packages/brain/src/spawn/__tests__/spawn.test.js`

- [ ] **Step 1: 写 test 文件**

写入 `packages/brain/src/spawn/__tests__/spawn.test.js`：

```js
/**
 * spawn() skeleton smoke test。
 * 验证 wrapper 存在、参数透传、SPAWN_V2_ENABLED 两条分支等价。
 * middleware 行为测试留给 PR 2+。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock docker-executor 避免真跑 docker
const mockExecuteInDocker = vi.fn();
vi.mock('../../docker-executor.js', () => ({
  executeInDocker: (...args) => mockExecuteInDocker(...args),
}));

describe('spawn() skeleton (P2 PR1)', () => {
  beforeEach(() => {
    mockExecuteInDocker.mockReset();
    mockExecuteInDocker.mockResolvedValue({ exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 100 });
  });

  afterEach(() => {
    delete process.env.SPAWN_V2_ENABLED;
  });

  it('exports spawn as async function', async () => {
    const { spawn } = await import('../spawn.js');
    expect(typeof spawn).toBe('function');
  });

  it('passes opts through to executeInDocker (v2 enabled, default)', async () => {
    const { spawn } = await import('../spawn.js');
    const opts = { task: { id: 't1' }, skill: '/test', prompt: 'hi' };
    await spawn(opts);
    expect(mockExecuteInDocker).toHaveBeenCalledWith(opts);
  });

  it('passes opts through to executeInDocker (v2 disabled)', async () => {
    process.env.SPAWN_V2_ENABLED = 'false';
    // 重新 import 以让模块读取新 env（Node ESM cache 会保留上次 import；
    // 这里用 vi.resetModules 保险）
    vi.resetModules();
    const { spawn } = await import('../spawn.js');
    const opts = { task: { id: 't2' }, skill: '/test', prompt: 'bye' };
    await spawn(opts);
    expect(mockExecuteInDocker).toHaveBeenCalledWith(opts);
  });

  it('returns executeInDocker result unchanged', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker.mockResolvedValue({ exit_code: 0, stdout: 'hello', stderr: '', duration_ms: 42 });
    const result = await spawn({ task: {}, skill: '/x', prompt: '' });
    expect(result).toEqual({ exit_code: 0, stdout: 'hello', stderr: '', duration_ms: 42 });
  });
});
```

- [ ] **Step 2: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node --check packages/brain/src/spawn/__tests__/spawn.test.js
```

Expected: 无输出。

- [ ] **Step 3: 试跑 vitest（本地可能缺 js-yaml 等依赖，跑不起来也不 block — CI 会跑）**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && npx vitest run packages/brain/src/spawn/__tests__/spawn.test.js 2>&1 | tail -20
```

Expected: 4 个 test 都 pass，或"command not found / module missing"（本地环境问题，CI 会通过）。记录实际输出。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && git add packages/brain/src/spawn/__tests__/spawn.test.js && git commit -m "test(brain): v2 P2 PR1 spawn smoke test (4 cases)"
```

---

### Task 3: git mv scaffold README 到正式位置

**Files:**
- Move: `docs/design/v2-scaffolds/spawn-readme.md` → `packages/brain/src/spawn/README.md`
- Modify: 新 README 顶部"状态"行（从"占位骨架（P1）— 待 P2 实现"改成"P2 PR1 skeleton 已落地；middleware 链待 PR 2+"）

- [ ] **Step 1: git mv**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && git mv docs/design/v2-scaffolds/spawn-readme.md packages/brain/src/spawn/README.md
```

Expected: git 记录为 rename 而非 delete+add。

- [ ] **Step 2: 更新 README 状态行 + 目标路径行**

用 Edit 工具把 `packages/brain/src/spawn/README.md` 头部：

```markdown
**状态**: 占位骨架（P1）— 待 P2 实现
**对应 Spec**: [`docs/design/brain-orchestrator-v2.md`](../brain-orchestrator-v2.md) §5
**目标路径**（P2 实现时 `git mv` 到）: `packages/brain/src/spawn/README.md`
**归属**: Brain 三层架构的 Layer 3 (Executor)
```

改成：

```markdown
**状态**: P2 PR 1 skeleton 已落地（spawn wrapper + SPAWN_V2_ENABLED flag）；middleware 链待 PR 2+
**对应 Spec**: [`docs/design/brain-orchestrator-v2.md`](../../../../docs/design/brain-orchestrator-v2.md) §5
**归属**: Brain 三层架构的 Layer 3 (Executor)
```

注意：
- 删掉"目标路径"这一行（已经到位了）
- 状态行改成已落地描述
- Spec 链接的相对路径从 `../brain-orchestrator-v2.md`（scaffolds 下）改到 `../../../../docs/design/brain-orchestrator-v2.md`（spawn/ 下回溯 4 级）

- [ ] **Step 3: 验证链接**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node -e "const p = require('path').resolve('packages/brain/src/spawn', '../../../../docs/design/brain-orchestrator-v2.md'); require('fs').accessSync(p); console.log('link ok:', p)"
```

Expected: 输出 `link ok: /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton/docs/design/brain-orchestrator-v2.md`。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && git add packages/brain/src/spawn/README.md docs/design/v2-scaffolds/spawn-readme.md && git commit -m "docs(brain): v2 P2 PR1 git mv scaffold README 到 packages/brain/src/spawn/"
```

---

### Task 4: 迁移 harness-initiative-runner.js 到 spawn()

**Files:**
- Modify: `packages/brain/src/harness-initiative-runner.js:29,65,118`

- [ ] **Step 1: 改 import 行（line 29）**

用 Edit 工具把：

```js
import { executeInDocker } from './docker-executor.js';
```

改成：

```js
import { spawn } from './spawn/index.js';
```

- [ ] **Step 2: 改默认 executor（line 65）**

原行：

```js
  const executor = opts.executor || opts.dockerExecutor || executeInDocker;
```

改成：

```js
  const executor = opts.executor || opts.dockerExecutor || spawn;
```

- [ ] **Step 3: 改注释文案（line 118 附近）**

原文：

```js
        // CECELIA_CREDENTIALS 不传 → executeInDocker middleware 走 selectBestAccount
```

改成：

```js
        // CECELIA_CREDENTIALS 不传 → spawn() middleware 走 selectBestAccount
```

- [ ] **Step 4: 验证没有残留 `executeInDocker` 引用**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && grep -n "executeInDocker" packages/brain/src/harness-initiative-runner.js
```

Expected: 无输出（空）。

- [ ] **Step 5: 验证 import 新路径**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && grep -n "from './spawn/" packages/brain/src/harness-initiative-runner.js
```

Expected: 看到 `import { spawn } from './spawn/index.js';`。

- [ ] **Step 6: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node --check packages/brain/src/harness-initiative-runner.js
```

Expected: 无输出。

- [ ] **Step 7: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && git add packages/brain/src/harness-initiative-runner.js && git commit -m "refactor(brain): v2 P2 PR1 迁 harness-initiative-runner 到 spawn()"
```

---

### Task 5: DoD 终验 + Learning 前置

**Files:** 无文件改动

- [ ] **Step 1: DoD [BEHAVIOR] 1 — spawn 函数导出**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node -e "import('./packages/brain/src/spawn/spawn.js').then(m => { if(typeof m.spawn !== 'function') process.exit(1); })" ; echo "exit=$?"
```

Expected: `exit=0`

- [ ] **Step 2: DoD [BEHAVIOR] 2 — README 到位**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node -e "require('fs').accessSync('packages/brain/src/spawn/README.md')" ; echo "exit=$?"
```

Expected: `exit=0`

- [ ] **Step 3: DoD [BEHAVIOR] 3 — scaffolds 位置已清**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node -e "if(require('fs').existsSync('docs/design/v2-scaffolds/spawn-readme.md')) process.exit(1)" ; echo "exit=$?"
```

Expected: `exit=0`

- [ ] **Step 4: DoD [BEHAVIOR] 4 — harness-initiative-runner 已迁**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-runner.js','utf8'); if(!c.includes(\"from './spawn/\") || c.match(/executeInDocker\s*\(/)) process.exit(1)" ; echo "exit=$?"
```

Expected: `exit=0`

- [ ] **Step 5: DoD [BEHAVIOR] 5 — spawn test 文件存在**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node -e "require('fs').accessSync('packages/brain/src/spawn/__tests__/spawn.test.js')" ; echo "exit=$?"
```

Expected: `exit=0`

- [ ] **Step 6: 跑 facts-check（确认没破坏 Brain 事实对齐）**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr1-spawn-skeleton && node scripts/facts-check.mjs 2>&1 | tail -5
```

Expected: `All facts consistent.` + exit 0。

- [ ] **Step 7: 不 commit — 只是验证。下一步交给 engine-ship 写 Learning + 推 + engine-ship 自动合。**

---

## Self-Review

### Spec Coverage

| Spec 要求 | Task |
|---|---|
| 建 `packages/brain/src/spawn/spawn.js` | Task 1 Step 1 |
| 建 `packages/brain/src/spawn/index.js` | Task 1 Step 2 |
| 加 `SPAWN_V2_ENABLED` env flag | Task 1 Step 1（代码内） |
| git mv scaffold README | Task 3 Step 1 |
| README 状态行更新 | Task 3 Step 2 |
| 迁移 harness-initiative-runner 到 spawn() | Task 4 Steps 1-3 |
| 建 smoke test 文件 | Task 2 Step 1 |
| DoD 5 条 [BEHAVIOR] | Task 5 Steps 1-5 |

### Placeholder Scan

无 TBD / TODO / "implement later"。代码块完整，命令完整。

### Type Consistency

- `spawn(opts)` 签名在 Task 1 和 Task 4 Step 2 一致
- `executor` 变量名保持原 `harness-initiative-runner.js:65` 风格
- import 路径 `./spawn/index.js` 在 Task 4 和 spec DoD 条件中一致

### Scope

严格按 spec：无 middleware 实现、无硬编码 account1 清理、无 executeInDocker 内部改动、不动其它 caller。
