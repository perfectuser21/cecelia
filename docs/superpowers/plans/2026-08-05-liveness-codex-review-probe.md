# liveness codex-review 探测器修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** codex-review 任务的活性以 lock 文件为准（两层探活共用 SSOT），进程层不再 60 秒恒判死；paused-requeuer 补清 claim。

**Architecture:** 新建 `lib/codex-review-liveness.js`（SSOT：lock 目录常量 + probe 函数）；executor-contracts 注册新 kind `codex-review-local`；triggerCodexReview 打标；probeTaskLiveness 加 REVIEW 分支；paused-requeuer UPDATE 补两列。

**Tech Stack:** Node ESM、vitest（`cd packages/brain && npm test`）。

## Global Constraints

- 工作目录：`/Users/administrator/worktrees/cecelia/liveness-codex-review-probe`（基于 main c5a2e1eb0，已验无污染）
- TDD：commit-1 = 全部测试（红）；commit-2 = 实现 + brain 版本 bump（版本闸强制）+ DEFINITION.md 同步 + 两份 package-lock 同步
- 新 src 文件的测试必须放同目录 `__tests__/`（lint-test-pairing 闸）
- 不改 Monitor/thalamus/retry-policy/quarantine 本体；不动 HARNESS_LIVENESS_EXEMPT_TYPES 与 initiative 宽限名单既有逻辑
- 注释简体中文；commit message 结尾：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 守卫测试（红）

**Files:**
- Create: `packages/brain/src/lib/__tests__/codex-review-liveness.test.js`
- Create: `packages/brain/src/__tests__/liveness-codex-review-wiring.test.js`

**Interfaces:**
- Produces 对 Task 2 的约束：`lib/codex-review-liveness.js` 导出 `CODEX_REVIEW_LOCK_DIR`（='/tmp/codex-review-locks'）与 `probeCodexReviewLock(taskId, { maxAgeMinutes = 90, lockDir = CODEX_REVIEW_LOCK_DIR } = {})` → `'alive' | 'dead'`

- [ ] **Step 1: SSOT 行为测试**

创建 `packages/brain/src/lib/__tests__/codex-review-liveness.test.js`：

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { probeCodexReviewLock, CODEX_REVIEW_LOCK_DIR } from '../codex-review-liveness.js';

// codex-review 活性 SSOT（决策 9befa9c3，issue f1d6840f）：
// lock 由 triggerCodexReview spawn 前写入、error/exit handler 删除——存在即在跑。
describe('probeCodexReviewLock', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'codex-lock-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('lock 存在且新鲜 → alive', () => {
    writeFileSync(path.join(dir, 'task-1.lock'),
      JSON.stringify({ taskId: 'task-1', startedAt: new Date().toISOString() }));
    expect(probeCodexReviewLock('task-1', { lockDir: dir })).toBe('alive');
  });

  it('lock 超龄（>maxAgeMinutes）→ dead', () => {
    const old = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    writeFileSync(path.join(dir, 'task-2.lock'),
      JSON.stringify({ taskId: 'task-2', startedAt: old }));
    expect(probeCodexReviewLock('task-2', { lockDir: dir, maxAgeMinutes: 90 })).toBe('dead');
  });

  it('lock 缺失 → dead（exit handler 已收尸或容器重启，双确认流程给出回队出路）', () => {
    expect(probeCodexReviewLock('task-3', { lockDir: dir })).toBe('dead');
  });

  it('lock 存在但内容损坏 → alive（写入竞态，保守视为在跑）', () => {
    writeFileSync(path.join(dir, 'task-4.lock'), '{broken');
    expect(probeCodexReviewLock('task-4', { lockDir: dir })).toBe('alive');
  });

  it('默认 lockDir 为 /tmp/codex-review-locks（与 executor 写入点一致）', () => {
    expect(CODEX_REVIEW_LOCK_DIR).toBe('/tmp/codex-review-locks');
  });
});
```

- [ ] **Step 2: 接线静态断言测试**

创建 `packages/brain/src/__tests__/liveness-codex-review-wiring.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { VALID_EXECUTOR_KINDS, EXECUTOR_CONTRACTS } from '../executor-contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(path.join(__dirname, '..', 'executor.js'), 'utf8');
const requeuerSrc = readFileSync(path.join(__dirname, '..', 'paused-requeuer.js'), 'utf8');

// liveness 误判 codex-review 修复接线（决策 9befa9c3，issue f1d6840f）
describe('codex-review-local 合同注册', () => {
  it('VALID_EXECUTOR_KINDS 含 codex-review-local', () => {
    expect(VALID_EXECUTOR_KINDS).toContain('codex-review-local');
  });

  it('合同存在且 onStale=requeue、staleMinutes=90', () => {
    const c = EXECUTOR_CONTRACTS['codex-review-local'];
    expect(c).toBeDefined();
    expect(c.onStale).toBe('requeue');
    expect(c.staleMinutes).toBe(90);
    expect(typeof c.probe).toBe('function');
  });
});

describe('executor.js 接线', () => {
  it('triggerCodexReview 打标 codex-review-local', () => {
    expect(executorSrc).toMatch(/setExecutorKind\(task\.id, 'codex-review-local'\)/);
  });

  it('probeTaskLiveness 对 REVIEW 类任务用 lock 探测（不再 ps 扫描恒判死）', () => {
    expect(executorSrc).toMatch(/REVIEW_TASK_TYPES\.includes\(task\.task_type\)[\s\S]{0,300}probeCodexReviewLock/);
  });
});

describe('paused-requeuer 清 claim', () => {
  it('requeue UPDATE 同时清 claimed_by/claimed_at（防回队后无主卡死）', () => {
    expect(requeuerSrc).toMatch(/status = 'queued',[\s\S]{0,200}claimed_by = NULL,[\s\S]{0,80}claimed_at = NULL/);
  });
});
```

- [ ] **Step 3: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/codex-review-liveness.test.js src/__tests__/liveness-codex-review-wiring.test.js`
Expected: SSOT 测试因模块不存在加载失败；接线断言全 FAIL。亲见红记报告。

- [ ] **Step 4: Commit（commit-1，红）**

```bash
git add packages/brain/src/lib/__tests__/codex-review-liveness.test.js packages/brain/src/__tests__/liveness-codex-review-wiring.test.js
git commit -m "fix(brain): liveness codex-review 探测器守卫测试（红）"
```

---

### Task 2: 实现（绿）+ 版本 bump

**Files:**
- Create: `packages/brain/src/lib/codex-review-liveness.js`
- Modify: `packages/brain/src/executor-contracts.js`（VALID_EXECUTOR_KINDS + EXECUTOR_CONTRACTS + import）
- Modify: `packages/brain/src/executor.js`（三处：CODEX_REVIEW_LOCK_DIR 改引 SSOT、triggerCodexReview 打标、probeTaskLiveness REVIEW 分支）
- Modify: `packages/brain/src/paused-requeuer.js`（UPDATE 补两列）
- Modify: `packages/brain/package.json` + 两份 package-lock.json + `DEFINITION.md`（版本 1.267.224→1.267.225）

**Interfaces:**
- Consumes: Task 1 两个测试（转绿，不许改）

- [ ] **Step 1: 新建 SSOT 模块**

创建 `packages/brain/src/lib/codex-review-liveness.js`：

```js
/**
 * codex-review 活性 SSOT（决策 9befa9c3，issue f1d6840f）。
 *
 * REVIEW_TASK_TYPES 任务由 triggerCodexReview spawn detached codex，三条进程
 * 信号（activeProcesses / current_run_id / ps 扫描）全无——曾被进程层探针 60 秒
 * 宽限后恒判死，10~30 分钟的审查结构性跑不完（三轮真机复现）。
 * 活性以 lock 文件为准：spawn 前写入（含 startedAt）、spawn error 与 exit
 * handler 均删除——存在即在跑；缺失=已收尸或容器重启（双确认流程给回队出路）。
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const CODEX_REVIEW_LOCK_DIR = '/tmp/codex-review-locks';

export function probeCodexReviewLock(taskId, { maxAgeMinutes = 90, lockDir = CODEX_REVIEW_LOCK_DIR } = {}) {
  const lockFile = path.join(lockDir, `${taskId}.lock`);
  if (!existsSync(lockFile)) return 'dead';
  try {
    const meta = JSON.parse(readFileSync(lockFile, 'utf-8'));
    const startedAt = new Date(meta.startedAt).getTime();
    if (Number.isFinite(startedAt)) {
      const ageMin = (Date.now() - startedAt) / 60000;
      if (ageMin > maxAgeMinutes) return 'dead';
    }
    return 'alive';
  } catch {
    // lock 在但读不动（写入竞态/损坏）→ 保守视为在跑，下一轮再看
    return 'alive';
  }
}
```

- [ ] **Step 2: executor-contracts.js 注册新 kind**

a) 文件顶部按既有 import 风格加：`import { probeCodexReviewLock } from './lib/codex-review-liveness.js';`
b) `VALID_EXECUTOR_KINDS` 数组加 `'codex-review-local',`。
c) `EXECUTOR_CONTRACTS` 加条目（放 `brain-local` 条目之后）：

```js
  /**
   * codex-review-local: triggerCodexReview 直接 spawn 的 detached codex
   * （REVIEW_TASK_TYPES）。活性：/tmp/codex-review-locks/<taskId>.lock ——
   * spawn 前写、error/exit handler 删，存在即在跑（决策 9befa9c3）。
   */
  'codex-review-local': {
    probe: async (task, _ctx) => probeCodexReviewLock(task.id),
    staleMinutes: 90,
    onStale: 'requeue',
  },
```

- [ ] **Step 3: executor.js 三处**

a) 顶部 import：`import { probeCodexReviewLock, CODEX_REVIEW_LOCK_DIR as CODEX_REVIEW_LOCK_DIR_SSOT } from './lib/codex-review-liveness.js';`——**先读第 250 行附近既有 `const CODEX_REVIEW_LOCK_DIR = '/tmp/codex-review-locks'`**：将该 const 改为 `const CODEX_REVIEW_LOCK_DIR = CODEX_REVIEW_LOCK_DIR_SSOT;`（保持下游引用不动，值收敛到 SSOT）。
b) `triggerCodexReview` 内 lock 写入（`await writeFile(lockFile, ...)`，约 2443-2444 行）之后加：

```js
    // liveness 打标：合同层由 codex-review-local 合同以 lock 文件探活（决策 9befa9c3）
    try { await setExecutorKind(task.id, 'codex-review-local'); } catch { /* 打标失败不阻塞派发 */ }
```

（先确认 `setExecutorKind` 在本文件作用域可用——约 71 行定义；照 2946 行既有调用风格。）
c) `probeTaskLiveness` 内，在 `HARNESS_LIVENESS_EXEMPT_TYPES` 豁免块（约 3978-3986 行 `continue;` 之后）与 initiative 宽限逻辑之间插入：

```js
    // REVIEW 类任务由 triggerCodexReview spawn detached codex，三条进程信号全无
    //（issue f1d6840f：曾 60 秒宽限后恒判死，10~30 分钟审查结构性跑不完）。
    // 活性以 lock 文件为准，与合同层 codex-review-local 共用 SSOT；
    // lock 缺失/超龄 → 不 continue，落入下方既有 SUSPECT→DEAD 双确认流程（回队有出路）。
    if (REVIEW_TASK_TYPES.includes(task.task_type)) {
      if (probeCodexReviewLock(task.id) === 'alive') {
        suspectProcesses.delete(task.id);
        continue;
      }
    }
```

实现前必须核对（判断力步骤，报告里写核对结果）：
- `REVIEW_TASK_TYPES` 是否已在 executor.js import（约 255 行注释说从 lib/review-task-types.js 导入——确认 import 语句真实存在，缺则补）；
- `suspectProcesses` 在该循环作用域的真实标识符（liveness-probe.test.js 里有同名导出可对照）；
- 插入点之后的既有流程对"无跟踪信息"任务如何走到 SUSPECT——确认 lock-dead 的 REVIEW 任务落进那条路（60 秒宽限逻辑对它继续适用没关系：dead 后两轮双确认回队本来就是要的语义）。

- [ ] **Step 4: paused-requeuer.js 补清 claim**

Requeue UPDATE 的 SET 子句（约 38-41 行）改为：

```sql
    SET status = 'queued',
        claimed_by = NULL,
        claimed_at = NULL,
        retry_count = COALESCE(retry_count, 0) + 1,
        updated_at = NOW()
```

- [ ] **Step 5: 版本 bump 三件套**

```bash
cd packages/brain && npm version patch --no-git-tag-version   # 1.267.224 → 1.267.225
```
同步 `DEFINITION.md` 第 9 行版本号；核对根与 brain 两份 package-lock.json 均为 1.267.225（不一致则 `npm install --package-lock-only`）。

- [ ] **Step 6: 验证绿 + 回归**

```bash
cd packages/brain
npx vitest run src/lib/__tests__/codex-review-liveness.test.js src/__tests__/liveness-codex-review-wiring.test.js
npx vitest run src/__tests__/liveness-probe.test.js src/__tests__/executor-contracts.test.js src/__tests__/t2-liveness-four-blades-regression.test.js src/__tests__/recovery-loop.test.js src/__tests__/executor-codex-configerror.test.js
cd ../.. && node scripts/facts-check.mjs
npx eslint packages/brain/src/lib/codex-review-liveness.js packages/brain/src/executor-contracts.js packages/brain/src/paused-requeuer.js --max-warnings 0
```
Expected: 新测试全 PASS；五个既有 liveness/合同相关测试全 PASS（有失败必须查明是否本改动引入，不许跳过）；facts-check `All facts consistent.`；eslint 0。

- [ ] **Step 7: Commit（commit-2，绿）**

```bash
git add packages/brain/src/lib/codex-review-liveness.js packages/brain/src/executor-contracts.js packages/brain/src/executor.js packages/brain/src/paused-requeuer.js packages/brain/package.json packages/brain/package-lock.json package-lock.json DEFINITION.md
git commit -m "fix(brain): codex-review 活性以 lock 文件为准接入两层探活 + requeuer 清 claim（绿）"
```
