# Phase B2 — shepherd 活跃信号判定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 shepherd `shouldQuarantineOnFailure` 决策点加"活跃信号"预检，当 task 有活跃 interactive claude（`.dev-mode.*` mtime < 90s）时跳过 quarantine。

**Architecture:** 新建独立模块 `quarantine-active-signal.js`（只读 `.dev-mode.*` mtime），在 `quarantine.js` 的 `shouldQuarantineOnFailure` 入口调用；async 传染链修 3 个函数（shouldQuarantineOnFailure / checkShouldQuarantine / handleTaskFailure 的 caller），现有 21 处测试调用点全部加 `await`。

**Tech Stack:** Node.js ESM + vitest + 现有 quarantine.js 模式（pool 导入、console.log 日志风格）。

---

## File Structure

| 文件 | 变化 | 责任 |
|---|---|---|
| `packages/brain/src/quarantine-active-signal.js` | **新建** ~60 行 | 扫 `.dev-mode.*` 判活跃 |
| `packages/brain/src/__tests__/quarantine-active-signal.test.js` | **新建** ~180 行 | 5 cases 单元测试 |
| `packages/brain/src/quarantine.js` | **改** ~20 行 | async 传染 3 函数 + hasActiveSignal 预检 |
| `packages/brain/src/__tests__/quarantine.test.js` | **改** ~14 行 | 8 处 shouldQuarantineOnFailure + 3 处 checkShouldQuarantine 调用加 await |
| `packages/brain/src/__tests__/quota-exhausted.test.js` | **改** ~3 行 | 3 处 shouldQuarantineOnFailure 调用加 await |
| `packages/brain/src/__tests__/quota-exhausted-no-quarantine.test.js` | **改** ~3 行 | 同上 3 处加 await |

---

## Task 1: 新建 quarantine-active-signal 模块 + 测试（TDD Red→Green 独立单元）

**Files:**
- Create: `packages/brain/src/quarantine-active-signal.js`
- Create: `packages/brain/src/__tests__/quarantine-active-signal.test.js`

- [ ] **Step 1.1: 写测试文件（5 cases）**

文件内容：

```javascript
/**
 * quarantine-active-signal 单元测试。
 * 5 cases：fresh match / stale match / no match / invalid input / 多文件混合。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
vi.mock('fs', () => ({
  readdirSync: (...args) => mockReaddirSync(...args),
  statSync: (...args) => mockStatSync(...args),
}));

const TASK_ID = '76530023-19bd-4879-a5f0-77161fe1162e';
const TASK_PREFIX = '76530023';
const WORKTREE_ROOT = '/Users/administrator/worktrees/cecelia';
const MAIN_REPO = '/Users/administrator/perfect21/cecelia';

function setupFs(layout) {
  // layout: { [dirPath]: [filenames], files: { [fullPath]: { mtimeMs } } }
  mockReaddirSync.mockImplementation((dir) => layout.dirs?.[dir] ?? []);
  mockStatSync.mockImplementation((fullPath) => {
    const f = layout.files?.[fullPath];
    if (!f) throw new Error(`ENOENT: ${fullPath}`);
    return { mtimeMs: f.mtimeMs };
  });
}

describe('hasActiveSignal', () => {
  beforeEach(() => {
    mockReaddirSync.mockReset();
    mockStatSync.mockReset();
  });

  it('case 1: fresh match → active', async () => {
    const now = Date.now();
    const filename = `.dev-mode.cp-0423201624-${TASK_PREFIX}-phase-a`;
    setupFs({
      dirs: {
        [MAIN_REPO]: [],
        [WORKTREE_ROOT]: ['wt1'],
        [`${WORKTREE_ROOT}/wt1`]: [filename],
      },
      files: {
        [`${WORKTREE_ROOT}/wt1/${filename}`]: { mtimeMs: now - 30_000 },
      },
    });
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res = await hasActiveSignal(TASK_ID);
    expect(res.active).toBe(true);
    expect(res.reason).toBe('dev_mode_mtime_fresh');
    expect(res.source).toContain(filename);
    expect(res.ageMs).toBeGreaterThanOrEqual(29_000);
    expect(res.ageMs).toBeLessThan(31_000);
  });

  it('case 2: stale match (mtime > 90s) → inactive', async () => {
    const now = Date.now();
    const filename = `.dev-mode.cp-0423201624-${TASK_PREFIX}-phase-a`;
    setupFs({
      dirs: {
        [MAIN_REPO]: [],
        [WORKTREE_ROOT]: ['wt1'],
        [`${WORKTREE_ROOT}/wt1`]: [filename],
      },
      files: {
        [`${WORKTREE_ROOT}/wt1/${filename}`]: { mtimeMs: now - 120_000 },
      },
    });
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res = await hasActiveSignal(TASK_ID);
    expect(res.active).toBe(false);
    expect(res.reason).toBe('no_fresh_dev_mode');
    expect(res.source).toBeNull();
  });

  it('case 3: no match → inactive', async () => {
    const now = Date.now();
    setupFs({
      dirs: {
        [MAIN_REPO]: [],
        [WORKTREE_ROOT]: ['wt1'],
        [`${WORKTREE_ROOT}/wt1`]: ['.dev-mode.cp-0423221250-c36991e7-phase-b2'],
      },
      files: {
        [`${WORKTREE_ROOT}/wt1/.dev-mode.cp-0423221250-c36991e7-phase-b2`]: { mtimeMs: now - 10_000 },
      },
    });
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res = await hasActiveSignal(TASK_ID);
    expect(res.active).toBe(false);
    expect(res.reason).toBe('no_fresh_dev_mode');
  });

  it('case 4: invalid taskId → inactive', async () => {
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res1 = await hasActiveSignal(null);
    expect(res1.active).toBe(false);
    expect(res1.reason).toBe('invalid_task_id');
    const res2 = await hasActiveSignal('');
    expect(res2.active).toBe(false);
    expect(res2.reason).toBe('invalid_task_id');
  });

  it('case 5: 多文件混合（常态）→ 只命中 fresh + match', async () => {
    const now = Date.now();
    const matchFilename = `.dev-mode.cp-0423201624-${TASK_PREFIX}-phase-a`;
    setupFs({
      dirs: {
        [MAIN_REPO]: [],
        [WORKTREE_ROOT]: ['wtA', 'wtB', 'wtC'],
        [`${WORKTREE_ROOT}/wtA`]: ['.dev-mode.cp-0420-stalebranch'],                // stale mismatch
        [`${WORKTREE_ROOT}/wtB`]: ['.dev-mode.cp-0423221250-c36991e7-phase-b2'],     // fresh mismatch
        [`${WORKTREE_ROOT}/wtC`]: [matchFilename],                                    // fresh match
      },
      files: {
        [`${WORKTREE_ROOT}/wtA/.dev-mode.cp-0420-stalebranch`]: { mtimeMs: now - 3600_000 },
        [`${WORKTREE_ROOT}/wtB/.dev-mode.cp-0423221250-c36991e7-phase-b2`]: { mtimeMs: now - 5_000 },
        [`${WORKTREE_ROOT}/wtC/${matchFilename}`]: { mtimeMs: now - 10_000 },
      },
    });
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res = await hasActiveSignal(TASK_ID);
    expect(res.active).toBe(true);
    expect(res.source).toContain(matchFilename);
    expect(res.source).not.toContain('stalebranch');
    expect(res.source).not.toContain('c36991e7');
  });
});
```

- [ ] **Step 1.2: 跑测试确认 Red（模块不存在）**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
npx vitest run packages/brain/src/__tests__/quarantine-active-signal.test.js --reporter=verbose 2>&1 | tail -15
```

Expected: 全部 5 cases **FAIL**（"Cannot find module '../quarantine-active-signal.js'"）。这是正确 Red。

- [ ] **Step 1.3: 写 quarantine-active-signal.js 实现（Green）**

```javascript
/**
 * quarantine-active-signal — 给 shepherd quarantine 决策加"活跃信号"预检。
 *
 * 扫 .dev-mode.* 文件 mtime，文件名含 taskId 前 8 位且 mtime < 90s → active。
 * 只读，不改任何 .dev-mode/.dev-lock 字段（遵守 stop-hook-cwd-as-key 规则）。
 *
 * 数据源为何单选 .dev-mode 见 Phase B2 spec §3 排除理由。
 */
import { readdirSync, statSync } from 'fs';
import path from 'path';

const ACTIVE_WINDOW_MS = 90_000;
const WORKTREE_ROOT = '/Users/administrator/worktrees/cecelia';
const MAIN_REPO = '/Users/administrator/perfect21/cecelia';

/**
 * @param {string} taskId UUID 全量
 * @returns {Promise<{active:boolean, reason:string, source:string|null, ageMs:number|null}>}
 */
export async function hasActiveSignal(taskId) {
  if (!taskId || typeof taskId !== 'string') {
    return { active: false, reason: 'invalid_task_id', source: null, ageMs: null };
  }
  const prefix = taskId.slice(0, 8);
  const now = Date.now();

  for (const filePath of collectDevModeFiles()) {
    const basename = path.basename(filePath);
    if (!basename.includes(prefix)) continue;
    let mtimeMs;
    try { mtimeMs = statSync(filePath).mtimeMs; } catch { continue; }
    const ageMs = now - mtimeMs;
    if (ageMs < ACTIVE_WINDOW_MS) {
      console.log(`[quarantine-active-signal] bypass quarantine: ${basename} age=${Math.round(ageMs)}ms`);
      return { active: true, reason: 'dev_mode_mtime_fresh', source: filePath, ageMs };
    }
  }
  return { active: false, reason: 'no_fresh_dev_mode', source: null, ageMs: null };
}

function collectDevModeFiles() {
  const files = [];
  try {
    for (const f of readdirSync(MAIN_REPO)) {
      if (f.startsWith('.dev-mode.')) files.push(path.join(MAIN_REPO, f));
    }
  } catch { /* main repo 不可读时忽略 */ }
  try {
    for (const wt of readdirSync(WORKTREE_ROOT)) {
      const dir = path.join(WORKTREE_ROOT, wt);
      try {
        for (const f of readdirSync(dir)) {
          if (f.startsWith('.dev-mode.')) files.push(path.join(dir, f));
        }
      } catch { /* 单个 worktree 不可读时忽略 */ }
    }
  } catch { /* worktree root 不存在时忽略 */ }
  return files;
}
```

- [ ] **Step 1.4: 跑测试确认 Green**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
npx vitest run packages/brain/src/__tests__/quarantine-active-signal.test.js --reporter=verbose 2>&1 | tail -15
```

Expected: 5 cases 全 pass。

- [ ] **Step 1.5: 不 commit，等 Task 2+3 一起**

---

## Task 2: quarantine.js async 传染 + caller 加 await

**Files:**
- Modify: `packages/brain/src/quarantine.js`
- Modify: `packages/brain/src/__tests__/quarantine.test.js`
- Modify: `packages/brain/src/__tests__/quota-exhausted.test.js`
- Modify: `packages/brain/src/__tests__/quota-exhausted-no-quarantine.test.js`

- [ ] **Step 2.1: 改 quarantine.js — 加 import 和 async 传染**

在 `packages/brain/src/quarantine.js` 文件顶部 import 块加：

```javascript
import { hasActiveSignal } from './quarantine-active-signal.js';
```

找到 L464 附近的 `function shouldQuarantineOnFailure(task) {` 改成：

```javascript
async function shouldQuarantineOnFailure(task) {
  // quota_exhausted 不是任务本身失败，不计入失败阈值，不触发隔离
  if (task.status === 'quota_exhausted') {
    return { shouldQuarantine: false };
  }

  // Phase B2: 活跃信号预检 — 有 interactive claude 在推进 → skip
  const signal = await hasActiveSignal(task.id);
  if (signal.active) {
    return {
      shouldQuarantine: false,
      reason: 'active_signal_bypass',
      details: {
        signal_source: signal.source,
        signal_reason: signal.reason,
        age_ms: signal.ageMs,
      },
    };
  }

  const failureCount = (task.payload?.failure_count || 0) + 1;

  if (failureCount >= FAILURE_THRESHOLD) {
    return {
      shouldQuarantine: true,
      reason: QUARANTINE_REASONS.REPEATED_FAILURE,
      details: {
        failure_count: failureCount,
        threshold: FAILURE_THRESHOLD,
        last_error: task.payload?.error_details || 'Unknown',
      },
    };
  }

  return { shouldQuarantine: false };
}
```

找到 L865 附近的 `function checkShouldQuarantine(task, context = 'on_failure') {` 改成 async + await：

```javascript
async function checkShouldQuarantine(task, context = 'on_failure') {
  // 1. 失败次数检查
  if (context === 'on_failure') {
    const failureCheck = await shouldQuarantineOnFailure(task);
    if (failureCheck.shouldQuarantine) {
      return failureCheck;
    }

    // 超时模式检查
    // ...（其余逻辑不动）
```

**只改上述两处**：函数签名加 `async`、`shouldQuarantineOnFailure(task)` 前加 `await`。其余 checkShouldQuarantine 函数体不动。

找到 L1063 附近的 `const check = checkShouldQuarantine(task, 'on_failure');` 改成：

```javascript
    const check = await checkShouldQuarantine(task, 'on_failure');
```

（只加 `await`，`handleTaskFailure` 本身已是 async）

- [ ] **Step 2.2: 改 quarantine.test.js — 8 次 shouldQuarantineOnFailure + 3 次 checkShouldQuarantine 加 await**

命令：在 worktree 根目录跑 sed（macOS BSD sed）：

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
# 注意：sed 只匹配 "= shouldQuarantineOnFailure(" 或 "= checkShouldQuarantine(" 的赋值形式
sed -i '' 's/= shouldQuarantineOnFailure(/= await shouldQuarantineOnFailure(/g' packages/brain/src/__tests__/quarantine.test.js
sed -i '' 's/= checkShouldQuarantine(/= await checkShouldQuarantine(/g' packages/brain/src/__tests__/quarantine.test.js
```

然后检查：对应的外层 `it('...', () => {...})` 需改 `async`。用 grep 定位：

```bash
grep -n "await shouldQuarantineOnFailure\|await checkShouldQuarantine" packages/brain/src/__tests__/quarantine.test.js
```

对每一行，看它所在的 it/describe block：若 `it(..., () => {` 未 `async`，手动改 `async () => {`。

**加 async 的行**（依 grep 结果定位，通常是 it 行）：

预期要改的 it block 模式（在每个 `await` 前的 it 闭包）:

```
it('...quarantineThreshold...', () => {  →  it('...', async () => {
```

Alternate safer approach: 直接逐个 read + edit each it block。执行时推荐用 Edit tool 精确改。

- [ ] **Step 2.3: 改 quota-exhausted.test.js + quota-exhausted-no-quarantine.test.js**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
sed -i '' 's/= shouldQuarantineOnFailure(/= await shouldQuarantineOnFailure(/g' packages/brain/src/__tests__/quota-exhausted.test.js
sed -i '' 's/= shouldQuarantineOnFailure(/= await shouldQuarantineOnFailure(/g' packages/brain/src/__tests__/quota-exhausted-no-quarantine.test.js
```

同样检查对应 it block 是否需加 `async`：

```bash
grep -B 3 "await shouldQuarantineOnFailure" packages/brain/src/__tests__/quota-exhausted.test.js
grep -B 3 "await shouldQuarantineOnFailure" packages/brain/src/__tests__/quota-exhausted-no-quarantine.test.js
```

若 `it('...', () => {` 未 async，用 Edit 改成 `it('...', async () => {`。

- [ ] **Step 2.4: 跑改动的全套 quarantine 测试确认 0 退化**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
npx vitest run packages/brain/src/__tests__/quarantine.test.js packages/brain/src/__tests__/quota-exhausted.test.js packages/brain/src/__tests__/quota-exhausted-no-quarantine.test.js packages/brain/src/__tests__/quarantine-active-signal.test.js --reporter=verbose 2>&1 | tail -40
```

Expected: **4 文件全部 pass，0 fail**。特别注意 quarantine.test.js 里原 `result.shouldQuarantine === true` 断言仍成立（因 mock fs 在测试环境返回空目录 / 文件不存在，`hasActiveSignal` 总返回 `active:false`，原 quarantine 逻辑不受影响）。

**潜在 gotcha**：quarantine.test.js 可能 mock 了 `fs`。若冲突，在该文件顶部 `vi.mock('fs', ...)` 可能影响 quarantine-active-signal 的 `readdirSync`。检查方式：

```bash
grep -n "vi.mock.*['\"]\(fs\\|node:fs\\)['\"]" packages/brain/src/__tests__/quarantine.test.js
```

若无 mock fs → `hasActiveSignal` 真读文件系统。测试 task 用 id='test-quar-abc' 之类 → 无 `.dev-mode` 含 `test-qua` 前缀 → `active:false` → 不影响原断言。OK。

- [ ] **Step 2.5: 跑更广测试确认 shepherd.test.js 也不退化**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
npx vitest run packages/brain/src/__tests__/shepherd.test.js --reporter=verbose 2>&1 | tail -20
```

Expected: shepherd.test.js 不直接调 `shouldQuarantineOnFailure/checkShouldQuarantine`（grep 已确认），应不退化。

- [ ] **Step 2.6: DoD manual 命令校验**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
node -e "const fs=require('fs');const f=require('glob').sync('packages/brain/src/**/shepherd*.js').concat(['packages/brain/src/quarantine.js','packages/brain/src/tick.js']);let found=false;for(const p of f){if(fs.existsSync(p)&&fs.readFileSync(p,'utf8').includes('hasActiveSignal')){found=true;console.log('found in:',p);break}}if(!found)process.exit(1)"
```

Expected: `found in: packages/brain/src/quarantine.js`（或类似路径），exit 0。

若 `glob` npm 包未装：

```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/quarantine.js','utf8'); if(!c.includes('hasActiveSignal')) process.exit(1); console.log('OK: hasActiveSignal used in quarantine.js')"
```

Expected: `OK: hasActiveSignal used in quarantine.js`。

---

## Task 3: Learning + DoD 勾选 + sprint-prd + 合并 commit

**Files:**
- Create: `docs/learnings/cp-0423221250-c36991e7-phase-b2-shepherd-active-signal.md`
- Modify: `.raw-prd-cp-0423221250-c36991e7-phase-b2-shepherd-active-signal.md`（DoD 勾选，若格式适用）
- Create: `sprint-prd.md`（branch-protect hook）

- [ ] **Step 3.1: 写 learning**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
cat > docs/learnings/cp-0423221250-c36991e7-phase-b2-shepherd-active-signal.md <<'EOF'
# Phase B2 — shepherd 活跃信号判定 Learning

## 做了什么
新建 `packages/brain/src/quarantine-active-signal.js`（60 行），扫 `.dev-mode.*`
文件 mtime 判 task 是否有活跃 interactive session。`quarantine.js:shouldQuarantineOnFailure`
前加活跃预检：有 interactive claude 在推进（mtime < 90s）→ skip quarantine。
async 传染 3 个函数（shouldQuarantineOnFailure / checkShouldQuarantine /
handleTaskFailure caller），现有 14 处测试调用点加 await。

## 根本原因
shepherd quarantine 只看 `failure_count >= 3` 一个维度，不区分"docker spawn 失败"
与"人类在独立 worktree 接管" —— 后者的 interactive session 无 checkpoint 无 container
PS，唯一通用信号是 `.dev-mode` 文件 mtime（Stop Hook / devloop-check 每轮写）。
Phase A 现场 Task 76530023 就被误杀。

## 下次预防
- [ ] 新加的决策点（quarantine / cleanup / gc）凡涉及"杀任务"都要加"活跃信号"预检
- [ ] async 传染要 grep 全仓（包括测试文件）— Phase B2 发现 21 处调用点，11 处需 await
- [ ] 活跃信号只读，不写 `.dev-mode/.dev-lock` 字段（stop-hook-cwd-as-key 规则）
- [ ] 数据源选择排他：checkpoint / docker / .dev-mode / last_attempt_at 各有覆盖盲区，设计 doc 明写排除理由

## 关键决策
**活跃信号只用 `.dev-mode.*` mtime**（排除 LangGraph checkpoints / docker PS /
last_attempt_at）。interactive /dev 不写 checkpoint，docker cidfile 路径不稳定，
last_attempt_at 失败也算 attempt。`.dev-mode` 是唯一既覆盖 harness 又覆盖 interactive
的通用信号，且 stop-dev.sh → devloop-check.sh 每次 Stop Hook 触发都刷 mtime。

**90s 窗口边界**：claude 深度 think 若 >90s 无 tool call 会被误 quarantine，
但 skip 非永久豁免（下次 failure 再判），语义安全。
EOF
head -8 docs/learnings/cp-0423221250-c36991e7-phase-b2-shepherd-active-signal.md
```

- [ ] **Step 3.2: 复制 .raw-prd 为 sprint-prd.md**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
cp .raw-prd-cp-0423221250-c36991e7-phase-b2-shepherd-active-signal.md sprint-prd.md
ls -la sprint-prd.md .raw-prd-cp-0423221250-c36991e7-phase-b2-shepherd-active-signal.md
```

Expected: 两文件都存在，内容相同。

- [ ] **Step 3.3: commit 一次**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
git add packages/brain/src/quarantine-active-signal.js \
        packages/brain/src/quarantine.js \
        packages/brain/src/__tests__/quarantine-active-signal.test.js \
        packages/brain/src/__tests__/quarantine.test.js \
        packages/brain/src/__tests__/quota-exhausted.test.js \
        packages/brain/src/__tests__/quota-exhausted-no-quarantine.test.js \
        docs/learnings/cp-0423221250-c36991e7-phase-b2-shepherd-active-signal.md \
        sprint-prd.md
git status --short
git commit -m "feat(brain): v2 Phase B2 shepherd 活跃信号判定 — quarantine 前预检 .dev-mode mtime

新建 packages/brain/src/quarantine-active-signal.js（60 行）：扫 .dev-mode.*
文件 mtime < 90s 且 task_id 前 8 位 match → active → skip quarantine。

quarantine.js:shouldQuarantineOnFailure 改 async + 入口加 hasActiveSignal 预检。
async 传染 checkShouldQuarantine + handleTaskFailure caller。

现场 bug：Task 76530023 (Phase A 开工时 docker spawn 22s failed → failure_count 2→3
→ 误 quarantine)，此时 interactive claude 在独立 worktree 推进。新逻辑看到
.dev-mode.* mtime fresh 自动 skip。

单一数据源 .dev-mode.*（排除 checkpoints/docker PS/last_attempt_at 各有硬缺陷，
详见 spec §3）。只读不写，遵守 stop-hook-cwd-as-key 规则。

Task: c36991e7-822f-4d0e-aedf-d6650fc85d3d

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Expected: commit 成功。若 pre-commit hook 报错，不要 --no-verify，读错误修实际问题。

- [ ] **Step 3.4: 自检**

```bash
cd /Users/administrator/worktrees/cecelia/c36991e7-phase-b2-shepherd-active-signal
git log --oneline -3
git diff HEAD~1 --stat
```

Expected:
- 最新 commit `feat(brain): v2 Phase B2 shepherd 活跃信号判定`
- 修改 8 个文件（6 src/test + learning + sprint-prd）

---

## Task 4: Push + PR（finishing skill 接管）

由 `superpowers:finishing-a-development-branch` Option 2 处理。engine-ship 接后段。

---

## Self-Review

### 1. Spec coverage

| Spec 要求 | Task |
|---|---|
| §4.1 quarantine-active-signal.js 实现 | Task 1 Step 1.3 |
| §4.2 async 传染链（3 函数） | Task 2 Step 2.1 |
| §4.3 5 cases 测试 | Task 1 Step 1.1 |
| §4.4 现有 11 测试调用点全部 await | Task 2 Step 2.2 + 2.3 |
| §5 成功标准 1-5 | Task 2.4/2.5/2.6 + Task 1.4 |
| §6 不做 | 无相关 task（负向） |

无 gap。

### 2. Placeholder scan

无 TBD/TODO/"similar to X"/模糊描述。每步 code block 完整。

Task 2.2 sed + 后续手工 async 确认虽然是"混合"方法，但 grep 命令 + 模式都明确，合乎 bite-sized。

### 3. Type consistency

- `hasActiveSignal(taskId)` 返回 `{active, reason, source, ageMs}` 全文一致
- `ACTIVE_WINDOW_MS = 90_000` 在源码 + 测试断言一致（29_000 ≤ ageMs < 31_000 相当于 30s mtime，<90_000）
- `TASK_PREFIX = '76530023'`（测试中）与 taskId 前 8 位规则一致
