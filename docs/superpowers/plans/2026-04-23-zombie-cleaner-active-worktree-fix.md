# zombie-cleaner P0 fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 zombie-cleaner 文件名不匹配 bug，防止所有活跃 /dev worktree 被误删。

**Architecture:** 新增 `isWorktreeActive(wtPath)` 扫 `.dev-mode*` mtime < 24h 判活跃；cleanup 循环加预检，保留 `findTaskIdForWorktree + activeTasks` 双回退向后兼容。

**Tech Stack:** Node.js ESM + vitest + 现有 zombie-cleaner.js mock 模式（`vi.mock('fs')` + importActual）。

---

## File Structure

| 文件 | 变化 | 责任 |
|---|---|---|
| `packages/brain/src/zombie-cleaner.js` | 改 ~20 行 | 新增 `isWorktreeActive` + 加 `readdirSync` import + 主循环预检 + 新常量导出 |
| `packages/brain/src/__tests__/zombie-cleaner.test.js` | 扩 ~150 行 | mock 加 `readdirSync` + 新增 5 cases |

---

## Task 1: 扩测试先 Red

**Files:**
- Modify: `packages/brain/src/__tests__/zombie-cleaner.test.js`

- [ ] **Step 1.1: 改 vi.mock('fs') 加 readdirSync**

在 `packages/brain/src/__tests__/zombie-cleaner.test.js` L9-18 把 mock 块改成：

```javascript
// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    rmSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});
```

然后 L35 import 加 `readdirSync`：

```javascript
import { existsSync, readFileSync, rmSync, statSync, readdirSync } from 'fs';
```

L40-47 import 块加 `isWorktreeActive` 和 `ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS`：

```javascript
import {
  cleanupStaleSlots,
  cleanupOrphanWorktrees,
  runZombieCleanup,
  findTaskIdForWorktree,
  isWorktreeActive,
  STALE_SLOT_MIN_AGE_MS,
  ORPHAN_WORKTREE_MIN_AGE_MS,
  ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS,
} from '../zombie-cleaner.js';
```

- [ ] **Step 1.2: 在文件末尾（`runZombieCleanup` describe 之前 或 最后一个 describe 之后）追加 isWorktreeActive 单元测试**

```javascript
// ============================================================
// isWorktreeActive (Phase B2-bis active signal)
// ============================================================

describe('isWorktreeActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fresh .dev-mode.${branch} → true', () => {
    const now = Date.now();
    readdirSync.mockReturnValue(['.dev-mode.cp-xxx-branch', 'packages', 'docs']);
    statSync.mockImplementation((p) => {
      if (p.endsWith('.dev-mode.cp-xxx-branch')) return { mtimeMs: now - 60_000 };
      throw new Error('unexpected stat');
    });
    expect(isWorktreeActive('/fake/wt')).toBe(true);
  });

  it('老 .dev-mode 无后缀 fresh → true', () => {
    const now = Date.now();
    readdirSync.mockReturnValue(['.dev-mode']);
    statSync.mockReturnValue({ mtimeMs: now - 60_000 });
    expect(isWorktreeActive('/fake/wt')).toBe(true);
  });

  it('所有 .dev-mode* stale (>24h) → false', () => {
    const now = Date.now();
    readdirSync.mockReturnValue(['.dev-mode.cp-xxx', '.dev-mode.cp-yyy']);
    statSync.mockReturnValue({ mtimeMs: now - 25 * 60 * 60 * 1000 });
    expect(isWorktreeActive('/fake/wt')).toBe(false);
  });

  it('无 .dev-mode* 文件 → false', () => {
    readdirSync.mockReturnValue(['packages', 'docs', 'README.md']);
    expect(isWorktreeActive('/fake/wt')).toBe(false);
  });

  it('readdirSync throws → false', () => {
    readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(isWorktreeActive('/fake/wt')).toBe(false);
  });
});
```

- [ ] **Step 1.3: 在 cleanupOrphanWorktrees describe 里加 2 个集成 case**

找 `describe('cleanupOrphanWorktrees'` block（grep 定位），在块内末尾追加：

```javascript
  it('worktree 有 fresh .dev-mode.branch → 跳过清理（活跃信号预检）', async () => {
    const now = Date.now();
    execSync.mockReturnValue('worktree /Users/administrator/worktrees/cecelia/active-wt\n\n');
    existsSync.mockReturnValue(true);
    statSync.mockImplementation((p) => {
      if (p.endsWith('.dev-mode.cp-yyy')) return { mtimeMs: now - 10_000 };
      // worktree 目录本身的 mtime 用于 age 判定
      return { mtimeMs: now - 40 * 60 * 1000 }; // 40 min, 超 30 min grace
    });
    readdirSync.mockReturnValue(['.dev-mode.cp-yyy', 'packages']);
    readFileSync.mockReturnValue('');
    const pool = makePool([]);

    const result = await cleanupOrphanWorktrees(pool);

    expect(result.removed).toBe(0);
    // 未调 git worktree remove
    const removeCalls = execSync.mock.calls.filter(c => String(c[0]).includes('worktree remove'));
    expect(removeCalls).toHaveLength(0);
  });

  it('worktree 无 .dev-mode* 文件 → 正常清理（不受新信号影响）', async () => {
    const now = Date.now();
    execSync
      .mockReturnValueOnce('worktree /Users/administrator/worktrees/cecelia/dead-wt\n\n')
      .mockReturnValueOnce(''); // git worktree remove 成功
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ mtimeMs: now - 60 * 60 * 1000 }); // 1h age 超 grace
    readdirSync.mockReturnValue(['packages', 'docs']); // 无 .dev-mode*
    const pool = makePool([]);

    const result = await cleanupOrphanWorktrees(pool);

    expect(result.removed).toBe(1);
  });
```

- [ ] **Step 1.4: 跑测试确认 Red**

```bash
cd /Users/administrator/worktrees/cecelia/6259b170-zombie-cleaner-fix
npx vitest run packages/brain/src/__tests__/zombie-cleaner.test.js --reporter=verbose 2>&1 | tail -30
```

Expected: 新 5 cases + 2 集成 cases **全 FAIL**（`isWorktreeActive` not exported）。

---

## Task 2: 实现 zombie-cleaner.js（Green）

**Files:**
- Modify: `packages/brain/src/zombie-cleaner.js`

- [ ] **Step 2.1: 加 readdirSync import**

改 L15 `import { existsSync, readFileSync, rmSync, statSync } from 'fs';` 成：

```javascript
import { existsSync, readFileSync, rmSync, statSync, readdirSync } from 'fs';
```

- [ ] **Step 2.2: 加新常量 + 新函数**

在 L27 `const ORPHAN_WORKTREE_MIN_AGE_MS = 30 * 60 * 1000;` 后加：

```javascript
const ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h
```

在 L115 `findTaskIdForWorktree` 函数之后（L116 前空行处）加：

```javascript
/**
 * 判断 worktree 是否活跃（依据 .dev-mode* 文件 mtime < ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS）。
 * 覆盖老 `.dev-mode` 无后缀格式和新 `.dev-mode.${branch}` 格式（v19.0.0 cwd-as-key 起）。
 * Phase B2-bis: fix findTaskIdForWorktree 文件名不匹配 bug —— 改用 mtime 判活跃而非依赖文件内容解析 UUID。
 *
 * @param {string} wtPath - Worktree 目录路径
 * @returns {boolean} - true 如果任一 .dev-mode* 文件 mtime < 24h
 */
function isWorktreeActive(wtPath) {
  try {
    const now = Date.now();
    const entries = readdirSync(wtPath).filter(f => f.startsWith('.dev-mode'));
    for (const name of entries) {
      try {
        const mtimeMs = statSync(join(wtPath, name)).mtimeMs;
        if (now - mtimeMs < ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS) {
          return true;
        }
      } catch { /* continue on stat error */ }
    }
  } catch { /* readdir failed, treat as inactive */ }
  return false;
}
```

- [ ] **Step 2.3: 改 cleanupOrphanWorktrees 主循环**

找 L189-193 的：

```javascript
      // 检查是否有对应的活跃任务
      const taskId = findTaskIdForWorktree(wtPath);
      if (taskId && activeTasks.has(taskId)) {
        continue; // 有对应活跃任务，不清理
      }
```

改成：

```javascript
      // 活跃信号预检（Phase B2-bis）：.dev-mode* mtime fresh → 跳过
      if (isWorktreeActive(wtPath)) {
        continue;
      }

      // 老格式 .dev-mode 向后兼容：findTaskIdForWorktree + activeTasks 双回退
      const taskId = findTaskIdForWorktree(wtPath);
      if (taskId && activeTasks.has(taskId)) {
        continue;
      }
```

- [ ] **Step 2.4: 更新 export**

找 L274-281 `export { ... }` 块，改成：

```javascript
export {
  cleanupStaleSlots,
  cleanupOrphanWorktrees,
  runZombieCleanup,
  findTaskIdForWorktree,
  isWorktreeActive,
  STALE_SLOT_MIN_AGE_MS,
  ORPHAN_WORKTREE_MIN_AGE_MS,
  ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS,
};
```

- [ ] **Step 2.5: 跑测试确认 Green**

```bash
cd /Users/administrator/worktrees/cecelia/6259b170-zombie-cleaner-fix
npx vitest run packages/brain/src/__tests__/zombie-cleaner.test.js --reporter=verbose 2>&1 | tail -30
```

Expected: 所有测试 pass（原有 + 新 5 cases + 新 2 集成 cases）。若 readdirSync 未在原 cases mock，可能需要在相关 `beforeEach` 或具体 it 里加 `readdirSync.mockReturnValue([])`。

- [ ] **Step 2.6: DoD manual 命令校验**

```bash
cd /Users/administrator/worktrees/cecelia/6259b170-zombie-cleaner-fix
node -e "const c=require('fs').readFileSync('packages/brain/src/zombie-cleaner.js','utf8'); if(!c.includes('isWorktreeActive')) process.exit(1); if(!/if\s*\(\s*isWorktreeActive\(/.test(c)) process.exit(2); console.log('OK: isWorktreeActive defined + called')"
```

Expected: `OK: isWorktreeActive defined + called`。

---

## Task 3: Learning + sprint-prd + 一次 commit

**Files:**
- Create: `docs/learnings/cp-0423234408-6259b170-zombie-cleaner-fix.md`
- Create: `sprint-prd.md`

- [ ] **Step 3.1: 写 learning**

```bash
cd /Users/administrator/worktrees/cecelia/6259b170-zombie-cleaner-fix
cat > docs/learnings/cp-0423234408-6259b170-zombie-cleaner-fix.md <<'EOF'
# zombie-cleaner P0 fix Learning

## 做了什么
修 `packages/brain/src/zombie-cleaner.js:findTaskIdForWorktree` 文件名不匹配
bug（读 `.dev-mode` / 写 `.dev-mode.${branch}`）。新增 `isWorktreeActive(wtPath)`
扫 `.dev-mode*` 文件 mtime < 24h 判活跃。cleanup 主循环加预检，保留
`findTaskIdForWorktree + activeTasks` 双回退兼容老格式。

## 根本原因
v19.0.0 cwd-as-key 改革时 `worktree-manage.sh` 把 `.dev-mode` 改成
`.dev-mode.${branch}`（按分支名带后缀，便于 cwd 归属识别），但 zombie-cleaner
没跟着改读取逻辑。文件名不匹配 → `readFileSync` 抛 → `return null` →
`activeTasks.has(null)=false` → 所有新格式 /dev worktree 活过 30min 被删。
命案：Phase B2 PR #2568 期间 interactive worktree age=33min 被误杀。

## 下次预防
- [ ] `.dev-mode/.dev-lock` 格式改动需全仓 grep 读取点（zombie-cleaner /
      pipeline-patrol / zombie-sweep 等），不能只改写入点
- [ ] cleanup/gc 脚本不要依赖内容解析（UUID 匹配），用稳定信号（文件存在 +
      mtime）更 robust
- [ ] Brain docker logs 有 "taskId=unknown" 要报警（本 bug 已生效 8+ 小时
      才被人眼看到，17 条误报无人追查）

## 关键决策
**24h 阈值**：interactive /dev 跨天工作合理，30min 太短。复用 Phase B2
`quarantine-active-signal` 同构思路（B2 用 90s 因为是 per-tick 决策；本场景
tick 跑一次就 rm 文件不可逆，必须宽）。

**保留 findTaskIdForWorktree + activeTasks OR 回退**：老格式 `.dev-mode`
（Brain docker agent 内部 worktree-manage.sh 版本可能未升级）仍要兼容。
EOF
```

- [ ] **Step 3.2: sprint-prd + 合并 commit**

```bash
cd /Users/administrator/worktrees/cecelia/6259b170-zombie-cleaner-fix
cp .raw-prd-cp-0423234408-6259b170-zombie-cleaner-fix.md sprint-prd.md
git add packages/brain/src/zombie-cleaner.js \
        packages/brain/src/__tests__/zombie-cleaner.test.js \
        docs/learnings/cp-0423234408-6259b170-zombie-cleaner-fix.md \
        sprint-prd.md
git status --short
git commit -m "fix(brain): zombie-cleaner P0 — .dev-mode* mtime 判活跃修文件名不匹配误杀 bug

findTaskIdForWorktree 读 .dev-mode（无后缀老格式），worktree-manage.sh v19.0.0
后写 .dev-mode.\${branch}（有后缀新格式）→ 文件名永远不匹配 → 所有活跃 /dev
worktree 活过 30min 被 git worktree remove --force 静默删。

新增 isWorktreeActive(wtPath)：扫 .dev-mode* 文件 mtime < ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS=24h
判活跃。cleanup 循环加预检，保留 findTaskIdForWorktree + activeTasks OR 回退兼容老格式。

命案：Phase B2 PR #2568 interactive worktree age=33min 被误杀（只剩空 packages/ 目录）。
铁证：Brain docker logs 17 条 \"Orphan worktree ... taskId=unknown\" 全 unknown（命中率 100%）。

Task: 6259b170-9409-4bc1-8052-ea930de5cd87

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Expected: commit 成功。

- [ ] **Step 3.3: 自检**

```bash
cd /Users/administrator/worktrees/cecelia/6259b170-zombie-cleaner-fix
git log --oneline -3
git diff HEAD~1 --stat
```

Expected: 最新 commit 是 P0 fix，4 文件改动（zombie-cleaner.js + test + learning + sprint-prd）。

---

## Task 4: Push + PR（finishing skill 接管）

---

## Self-Review

### 1. Spec coverage

| Spec 要求 | Task |
|---|---|
| §2.1 isWorktreeActive 实现 | Task 2.2 |
| §2.2 cleanup 循环预检 | Task 2.3 |
| §2.3 新常量导出 | Task 2.4 |
| §4.1 5 + 2 cases 测试 | Task 1.2 + 1.3 |
| §5 成功标准 1-3 | Task 2.5/2.6 |
| §6 不做 | 无相关 task（负向） |

### 2. Placeholder scan

Task 1.3 的 "grep 定位 describe" 是精确指令不是 placeholder（grep 可重复）。其余无。

### 3. Type consistency

- `ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS` 源码 + 测试 import 一致
- `isWorktreeActive(wtPath)` → `boolean` 全程一致
- `readdirSync` mock 在 setup + cases 一致使用
