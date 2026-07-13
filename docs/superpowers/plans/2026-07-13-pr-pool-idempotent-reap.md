# PR 池幂等收尸 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修两个已确认的 Brain 派发/收尸漏洞——派发前无重复判重导致同语义任务被两个独立 task_id 各自合法派发（产出重复 PR）；orphan-pr-worker 红色 CI 孤儿 PR 只贴标签永不关闭、也从不检测/关闭被取代的重复 PR。

**Architecture:** 新增纯函数模块 `dispatch-dedup.js`（标题 Jaccard 相似度 + 判重），被 `dispatcher.js`（DB 侧任务级判重）和 `orphan-pr-worker.js`（GitHub 侧 PR 级 superseded 判重）复用。orphan-pr-worker 额外新增 `closePr()`（仿现有 `mergePr`/`labelPr` 风格）和红孤儿超期关闭逻辑。

**Tech Stack:** Node.js ESM，vitest，pg（Postgres），gh CLI（通过 execSync 封装）。

---

### Task 1: 纯函数判重模块 `dispatch-dedup.js`

**Files:**
- Create: `packages/brain/src/dispatch-dedup.js`
- Test: `packages/brain/test/dispatch-dedup.test.js`

- [ ] **Step 1: 写 failing test**

```javascript
// packages/brain/test/dispatch-dedup.test.js
import { describe, it, expect } from 'vitest';
import { titleSimilarity, findDuplicateSibling } from '../src/dispatch-dedup.js';

describe('titleSimilarity', () => {
  it('高重叠标题返回高相似度', () => {
    const a = 'feat(brain): skill-eval-worker 常驻 daemon + running 超时回收';
    const b = 'feat(brain): skill-eval-worker 常驻 daemon + running 超时回收 + pm2 ecosystem';
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.6);
  });

  it('无关标题返回低相似度', () => {
    const a = 'feat(brain): skill-eval-worker 常驻 daemon';
    const b = 'fix(dashboard): 修复登录页样式错位';
    expect(titleSimilarity(a, b)).toBeLessThan(0.3);
  });

  it('完全相同标题返回 1', () => {
    const a = '同一个标题';
    expect(titleSimilarity(a, a)).toBe(1);
  });

  it('空字符串不抛错，返回 0', () => {
    expect(titleSimilarity('', 'abc')).toBe(0);
    expect(titleSimilarity('', '')).toBe(0);
  });
});

describe('findDuplicateSibling', () => {
  it('命中阈值以上的候选，返回该候选', () => {
    const title = 'skill-eval-worker 常驻 daemon + running 超时回收';
    const siblings = [
      { id: 'a', title: '无关任务' },
      { id: 'b', title: 'skill-eval-worker 常驻 daemon + running 超时回收 + pm2 ecosystem' },
    ];
    const hit = findDuplicateSibling(title, siblings, { threshold: 0.6, keyFn: (s) => s.title });
    expect(hit).not.toBeNull();
    expect(hit.id).toBe('b');
  });

  it('无命中时返回 null', () => {
    const title = 'skill-eval-worker 常驻 daemon';
    const siblings = [{ id: 'a', title: '完全无关的标题内容' }];
    const hit = findDuplicateSibling(title, siblings, { threshold: 0.6, keyFn: (s) => s.title });
    expect(hit).toBeNull();
  });

  it('siblings 为空数组返回 null', () => {
    expect(findDuplicateSibling('any title', [], { threshold: 0.6, keyFn: (s) => s.title })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run test/dispatch-dedup.test.js`
Expected: FAIL — `Cannot find module '../src/dispatch-dedup.js'`

- [ ] **Step 3: 写最小实现**

```javascript
// packages/brain/src/dispatch-dedup.js
/**
 * 标题级重复判定——纯函数，无 IO。
 *
 * 背景：Brain 派发/orphan-worker 都需要判断"这件事是不是已经在办/办过了"，
 * 但两个独立 task_id（dispatcher 场景）或两个独立 PR（orphan-worker 场景）
 * 之间没有共享 ID，唯一可比对的信号是标题语义重叠。用 Jaccard（分词集合交并比）
 * 而非编辑距离——标题常见"在前一版基础上加一段后缀"（如 "...+ pm2 ecosystem"），
 * Jaccard 对这种子集扩展关系比编辑距离更稳健。
 */

/**
 * 分词：按空白/常见标点切分，转小写，过滤空 token。
 * 不做真正的中文分词（无依赖）——中英混合标题里的中文短语本身常以空格/标点
 * 与其他部分分隔（如 "常驻 daemon + running 超时回收"），按空白切分已能捕获有效 token。
 */
function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[\s+():{}[\]/\\,，。、\-—－]+/)
    .filter(Boolean);
}

/**
 * Jaccard 相似度：|交集| / |并集|，范围 [0,1]。
 * 两个空 token 集合返回 0（避免 0/0 = NaN）。
 */
export function titleSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const unionSize = setA.size + setB.size - intersection;
  return unionSize === 0 ? 0 : intersection / unionSize;
}

/**
 * 在候选列表里找第一个标题相似度 >= threshold 的，返回该候选本身；无命中返回 null。
 *
 * @param {string} title 待判重的标题
 * @param {Array<object>} candidates 候选列表
 * @param {{threshold?: number, keyFn: (c:object)=>string}} opts keyFn 必填：从候选对象取标题
 */
export function findDuplicateSibling(title, candidates, opts) {
  const threshold = opts?.threshold ?? 0.6;
  const keyFn = opts?.keyFn;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  for (const c of candidates) {
    if (titleSimilarity(title, keyFn(c)) >= threshold) return c;
  }
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run test/dispatch-dedup.test.js`
Expected: PASS — 7 tests passed

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/dispatch-dedup.js packages/brain/test/dispatch-dedup.test.js
git commit -m "test+feat(brain): dispatch-dedup 标题相似度判重纯函数"
```

---

### Task 2: dispatcher.js 派发前判重（刀1）

**Files:**
- Modify: `packages/brain/src/dispatcher.js:434-436`（在 `preFlightFailedIds.push(candidate.id); continue;` 之后插入）
- Modify: `packages/brain/src/dispatcher.js:1-30`（新增 import）
- Test: `packages/brain/test/dispatcher-dedup.test.js`

- [ ] **Step 1: 写 failing test**

先确认 `dispatchNextTask` 现有测试文件的 mock 风格：

Run: `grep -rn "vi.mock.*db.js\|vi.mock.*dispatch-stats" packages/brain/test/dispatcher*.test.js 2>/dev/null | head -5`

若已有 `dispatcher.test.js` 且 mock 了 `./db.js` 和 `./dispatch-stats.js`，本测试沿用同款 mock 结构，只新增一个 test case 断言 duplicate 分支：

```javascript
// packages/brain/test/dispatcher-dedup.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../src/db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));

const mockRecordDispatchResult = vi.fn();
vi.mock('../src/dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
}));

// selectNextDispatchableTask 返回两个候选：先返回带重复标题的候选 A，
// 判重命中后 continue，第二轮返回候选 B（不重复）触发正常派发路径的其余 mock。
// 本测试只验证判重分支本身被触发、claim 未被调用，不验证完整派发链路（超出本任务范围）。
import { _internals_findDuplicateTaskSibling } from '../src/dispatcher.js';

describe('dispatcher duplicate-task guard', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRecordDispatchResult.mockReset();
  });

  it('DB 里存在高相似度 sibling → 判定为重复', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'sibling-1', title: 'skill-eval-worker 常驻 daemon + running 超时回收 + pm2 ecosystem' },
      ],
    });
    const candidate = {
      id: 'candidate-1',
      task_type: 'dev',
      title: 'skill-eval-worker 常驻 daemon + running 超时回收',
      created_at: new Date().toISOString(),
    };
    const dup = await _internals_findDuplicateTaskSibling(candidate);
    expect(dup).not.toBeNull();
    expect(dup.id).toBe('sibling-1');
  });

  it('DB 查询失败 → 保守放行（返回 null，不阻塞派发）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const candidate = {
      id: 'candidate-2',
      task_type: 'dev',
      title: '任意标题',
      created_at: new Date().toISOString(),
    };
    const dup = await _internals_findDuplicateTaskSibling(candidate);
    expect(dup).toBeNull();
  });

  it('无 sibling → 返回 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const candidate = {
      id: 'candidate-3',
      task_type: 'dev',
      title: '独一无二的标题',
      created_at: new Date().toISOString(),
    };
    const dup = await _internals_findDuplicateTaskSibling(candidate);
    expect(dup).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run test/dispatcher-dedup.test.js`
Expected: FAIL — `_internals_findDuplicateTaskSibling is not exported`

- [ ] **Step 3: 实现**

在 `packages/brain/src/dispatcher.js` 顶部 import 区（约 line 28 `recordDispatchResult` 那行附近）新增：

```javascript
import { findDuplicateSibling } from './dispatch-dedup.js';
```

在文件里新增一个独立函数（放在 `dispatchNextTask` 定义之前，紧邻其他 helper 函数即可，例如
`tickLog`/`logTickDecision` 附近）：

```javascript
const DUPLICATE_TASK_WINDOW_HOURS = 6;
const DUPLICATE_TASK_TITLE_THRESHOLD = 0.6;

/**
 * 派发前判重：同 task_type 且状态 queued/in_progress 的任务里，
 * 找创建时间窗口内标题高度相似的 sibling。查询失败保守放行（返回 null），
 * 不能因为一次 DB 抖动阻塞整个派发循环。
 */
export async function _internals_findDuplicateTaskSibling(candidate) {
  try {
    const { rows } = await pool.query(
      `SELECT id, title FROM tasks
        WHERE task_type = $1
          AND status IN ('queued', 'in_progress')
          AND id != $2
          AND created_at BETWEEN $3::timestamptz - INTERVAL '${DUPLICATE_TASK_WINDOW_HOURS} hours'
                              AND $3::timestamptz + INTERVAL '${DUPLICATE_TASK_WINDOW_HOURS} hours'
        LIMIT 20`,
      [candidate.task_type, candidate.id, candidate.created_at]
    );
    return findDuplicateSibling(candidate.title || '', rows, {
      threshold: DUPLICATE_TASK_TITLE_THRESHOLD,
      keyFn: (r) => r.title || '',
    });
  } catch (err) {
    console.warn(`[dispatch] duplicate-task lookup failed (non-fatal, fail-open): ${err.message}`);
    return null;
  }
}
```

在 `dispatchNextTask` 内，`preFlightFailedIds.push(candidate.id); continue;` 分支结束后
（即 pre-flight 通过、进入 `// 3b'. Retired harness task_types` 之前）插入：

```javascript
    // 3a'. 派发前语义查重（P1 6fc3bfe8 刀1）：同 task_type 时间窗口内标题高度相似的
    //      sibling 已 queued/in_progress → 大概率是同一件事被独立创建了两个 task 行，
    //      跳过本候选，让已在办的那个继续走，避免重复派发出两个几乎相同的 PR。
    const duplicateSibling = await _internals_findDuplicateTaskSibling(candidate);
    if (duplicateSibling) {
      tickLog(`[dispatch] task ${candidate.id} 与 sibling ${duplicateSibling.id} 标题高度相似，判定重复，跳过: ${candidate.title}`);
      await recordDispatchResult(pool, false, 'duplicate_task_title_match');
      duplicateSkipIds.push(candidate.id);
      continue;
    }
```

并在 `preFlightFailedIds` / `holSkipIds` / `noExecutorSkipIds` 声明处（约 line 335-337）同款新增：

```javascript
  const duplicateSkipIds = []; // IDs skipped due to duplicate-title sibling already queued/in_progress
```

同时把 `skipIds` 组装那行（约 line 372）补上：

```javascript
    const skipIds = [...preFlightFailedIds, ...holSkipIds, ...noExecutorSkipIds, ...duplicateSkipIds];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run test/dispatcher-dedup.test.js`
Expected: PASS — 3 tests passed

再跑一次 dispatcher 现有测试确认没有回归：

Run: `cd packages/brain && npx vitest run test/dispatcher.test.js 2>&1 | tail -30`（若文件不存在则跳过，改为 `find packages/brain/test -iname "*dispatch*"` 先确认实际文件名）
Expected: 现有测试全部仍 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/dispatcher.js packages/brain/test/dispatcher-dedup.test.js
git commit -m "fix(brain): 派发前标题相似度判重，防同语义任务被两个 task_id 各自派发"
```

---

### Task 3: orphan-pr-worker 红孤儿超期关闭（刀2 前半）

**Files:**
- Modify: `packages/brain/src/orphan-pr-worker.js`
- Test: `packages/brain/test/orphan-pr-worker.test.js`（若已存在则在其中新增 describe 块；若不存在则新建）

- [ ] **Step 1: 确认现有测试文件情况**

Run: `find packages/brain/test -iname "*orphan*"`

- [ ] **Step 2: 写 failing test**

在该测试文件（新建或追加）里加入：

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _internals } from '../src/orphan-pr-worker.js';

describe('orphan-pr-worker 红孤儿超期关闭', () => {
  it('classifyChecks=failure 且超过 staleCloseDays 且无 keep label → 应关闭', () => {
    const pr = {
      number: 101,
      labels: [],
      ageHours: 24 * 8, // 8 天，超过默认 7 天阈值
    };
    expect(_internals.shouldCloseStaleFail(pr, 7)).toBe(true);
  });

  it('未超过阈值 → 不关闭', () => {
    const pr = { number: 102, labels: [], ageHours: 24 * 3 };
    expect(_internals.shouldCloseStaleFail(pr, 7)).toBe(false);
  });

  it('带 keep label → 即使超期也不关闭', () => {
    const pr = { number: 103, labels: [{ name: 'keep' }], ageHours: 24 * 30 };
    expect(_internals.shouldCloseStaleFail(pr, 7)).toBe(false);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run test/orphan-pr-worker.test.js`
Expected: FAIL — `_internals.shouldCloseStaleFail is not a function`

- [ ] **Step 4: 实现**

在 `packages/brain/src/orphan-pr-worker.js` 顶部常量区（`DEFAULT_ORPHAN_LABEL` 附近）新增：

```javascript
const DEFAULT_STALE_CLOSE_DAYS = parseFloat(
  process.env.ORPHAN_PR_STALE_CLOSE_DAYS || '7'
);
const KEEP_LABEL = 'keep';
```

新增两个纯函数（放在 `labelPr` 定义之后）：

```javascript
/**
 * PR 是否带 keep 豁免标签（人工点名要救的 PR，永不自动关闭）。
 */
function hasKeepLabel(pr) {
  return Array.isArray(pr?.labels) && pr.labels.some((l) => l?.name === KEEP_LABEL);
}

/**
 * 红色（CI failure）孤儿是否该超期关闭：无 keep label 且 age 超过阈值天数。
 */
function shouldCloseStaleFail(pr, staleCloseDays) {
  if (hasKeepLabel(pr)) return false;
  const ageDays = (pr.ageHours || 0) / 24;
  return ageDays > staleCloseDays;
}

/**
 * 关闭 PR（不删分支，可恢复），并留痕评论。
 */
function closePr(prNumber, reason, dryRun) {
  if (dryRun) {
    console.log(`[orphan-pr-worker] [dry-run] would close PR #${prNumber} (${reason})`);
    return;
  }
  gh(`gh pr comment ${prNumber} --body ${JSON.stringify(reason)}`);
  gh(`gh pr close ${prNumber}`);
}
```

修改 `scanOrphanPrs` 内 `ciStatus === 'failure'` 分支（原第 320-334 行），改为：

```javascript
      if (ciStatus === 'failure') {
        const staleCloseDays = Number.isFinite(opts.staleCloseDays)
          ? opts.staleCloseDays
          : DEFAULT_STALE_CLOSE_DAYS;
        if (shouldCloseStaleFail(pr, staleCloseDays)) {
          closePr(pr.number, `[orphan-pr-worker] CI 红色超过 ${staleCloseDays} 天未修复，自动关闭（如需保留请加 "${KEEP_LABEL}" 标签）`, dryRun);
          result.details.push({
            pr: pr.number,
            url: pr.url,
            branch: pr.headRefName,
            action: 'closed',
            reason: 'ci_failure_stale',
          });
          console.log(
            `[orphan-pr-worker] closed stale-failing orphan PR #${pr.number} (${pr.headRefName}) age=${pr.ageHours}h${dryRun ? ' [dry-run]' : ''}`
          );
          continue;
        }
        labelPr(pr.number, label, dryRun);
        result.labeled++;
        result.details.push({
          pr: pr.number,
          url: pr.url,
          branch: pr.headRefName,
          action: 'labeled',
          reason: 'ci_failure',
        });
        console.log(
          `[orphan-pr-worker] labeled orphan PR #${pr.number} (${pr.headRefName}) -> ${label}${dryRun ? ' [dry-run]' : ''}`
        );
        continue;
      }
```

`result` 对象的 JSDoc 类型注释（约 line 229）里 `action` 枚举补充 `'closed'`；函数签名 JSDoc 的
`opts` 补充 `staleCloseDays?: number`。

`listOrphanCandidates`（约 line 72-95）目前只取 `number,url,headRefName,createdAt,updatedAt`，
需要 label 信息才能判 keep——把 `gh pr list` 的 `--json` 字段加上 `labels`：

```javascript
  const raw = gh(
    "gh pr list --author @me --state open --limit 100 --json number,url,headRefName,createdAt,updatedAt,labels"
  );
```

并在 `candidates.push({...})` 里带上 `labels: pr.labels || []`。

最后把 `_internals` 导出对象（文件末尾）补上：

```javascript
export const _internals = {
  DEFAULT_AGE_THRESHOLD_HOURS,
  DEFAULT_ORPHAN_LABEL,
  DEFAULT_STALE_CLOSE_DAYS,
  listOrphanCandidates,
  hasActiveBrainTask,
  classifyChecks,
  mergePr,
  labelPr,
  closePr,
  hasKeepLabel,
  shouldCloseStaleFail,
};
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run test/orphan-pr-worker.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/orphan-pr-worker.js packages/brain/test/orphan-pr-worker.test.js
git commit -m "fix(brain): orphan-pr-worker 红孤儿超期自动关闭 + keep label 豁免"
```

---

### Task 4: orphan-pr-worker superseded 检测（刀2 后半）

**Files:**
- Modify: `packages/brain/src/orphan-pr-worker.js`
- Test: `packages/brain/test/orphan-pr-worker.test.js`（追加）

- [ ] **Step 1: 写 failing test**

```javascript
import { findDuplicateSibling } from '../src/dispatch-dedup.js';

describe('orphan-pr-worker superseded 检测', () => {
  it('存在高相似度 MERGED PR → 判定为 superseded', () => {
    const candidateTitle = 'feat(brain): skill-eval-worker 常驻 daemon + running 超时回收';
    const mergedPrs = [
      { number: 3650, title: 'feat: skill-eval-worker 超时回收 + pm2 常驻脚本 + 并发冒烟', state: 'MERGED' },
      { number: 999, title: '完全无关的 PR 标题内容', state: 'MERGED' },
    ];
    const hit = findDuplicateSibling(candidateTitle, mergedPrs, { threshold: 0.4, keyFn: (p) => p.title });
    // 阈值放宽到 0.4 验证：真实案例里标题措辞会变但核心词重叠（skill-eval-worker/超时回收/常驻）
    expect(hit).not.toBeNull();
    expect(hit.number).toBe(3650);
  });

  it('_internals.shouldCloseSuperseded 命中 keep label 时不关闭', () => {
    expect(_internals.hasKeepLabel({ labels: [{ name: 'keep' }] })).toBe(true);
  });
});
```

（复用 Task 1 已验证的 `findDuplicateSibling`，这里只需验证真实案例数据下阈值选取合理，
以及 `hasKeepLabel` 复用同一豁免逻辑——不需要为 superseded 单独写新纯函数。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run test/orphan-pr-worker.test.js`
Expected: FAIL（新 describe 块里 `findDuplicateSibling` 导入正常，但 `_internals.hasKeepLabel`
在 Task 3 已实现，此步应仅第一个 real-world-threshold 断言需要人工核实数值——若实际相似度
不足 0.4，调整测试用的示例标题或阈值，不要为了让测试通过而降低生产阈值到不合理的值）

- [ ] **Step 3: 实现**

在 `packages/brain/src/orphan-pr-worker.js` 顶部新增 import：

```javascript
import { findDuplicateSibling } from './dispatch-dedup.js';
```

新增常量：

```javascript
const SUPERSEDED_TITLE_THRESHOLD = parseFloat(
  process.env.ORPHAN_PR_SUPERSEDED_THRESHOLD || '0.5'
);
```

修改 `scanOrphanPrs` 主循环，在 `HARNESS_SUBTASK_BRANCH_RE` 豁免判断之后、
`hasActiveBrainTask` 判断之前，插入 superseded 检测（需要先在函数顶部拿到全量 MERGED PR
列表——扩展 `listOrphanCandidates` 的返回，或在 `scanOrphanPrs` 里单独拉一次）：

```javascript
  // 1.5) 拉一次全量 MERGED PR（供 superseded 检测复用，避免每个候选都单独调一次 gh）
  let mergedPrs = [];
  try {
    const raw = gh(
      `gh pr list --author @me --state merged --limit 100 --json number,url,headRefName,title`
    );
    mergedPrs = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn(`[orphan-pr-worker] gh pr list --state merged failed (non-fatal, skip superseded check): ${err.message}`);
  }
```

在候选循环里，`HARNESS_SUBTASK_BRANCH_RE` 豁免之后插入：

```javascript
      // 2.0.5) Superseded 检测：已有语义高度相似的 MERGED PR → 当前这个是重复的败者，直接关闭。
      //        不看 CI 状态、不受 age 阈值限制——已经被取代的工作没有"再等等看会不会转绿"的价值。
      if (!hasKeepLabel(pr)) {
        const supersededBy = findDuplicateSibling(pr.title || '', mergedPrs, {
          threshold: SUPERSEDED_TITLE_THRESHOLD,
          keyFn: (p) => p.title || '',
        });
        if (supersededBy && supersededBy.number !== pr.number) {
          closePr(pr.number, `[orphan-pr-worker] 已被 #${supersededBy.number} 取代（标题高度相似且已合并），自动关闭（如需保留请加 "${KEEP_LABEL}" 标签）`, dryRun);
          result.details.push({
            pr: pr.number,
            url: pr.url,
            branch: pr.headRefName,
            action: 'closed',
            reason: 'superseded',
            superseded_by: supersededBy.number,
          });
          console.log(
            `[orphan-pr-worker] closed superseded PR #${pr.number} (superseded by #${supersededBy.number})${dryRun ? ' [dry-run]' : ''}`
          );
          continue;
        }
      }
```

注意：`listOrphanCandidates` 目前返回的候选对象没有 `title` 字段（只取了
`number,url,headRefName,createdAt,updatedAt,labels`）——需要在 Task 3 已经改过的 `--json`
参数里再加 `title`，并在 `candidates.push({...})` 里带上 `title: pr.title || ''`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run test/orphan-pr-worker.test.js`
Expected: PASS — 所有 orphan-pr-worker 测试通过

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/orphan-pr-worker.js packages/brain/test/orphan-pr-worker.test.js
git commit -m "fix(brain): orphan-pr-worker superseded PR 检测自动关闭败者"
```

---

### Task 5: DevGate + 全量校验 + 关闭 issue

**Files:** 无新文件，仅校验

- [ ] **Step 1: DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 三个命令全部退出码 0（若 check-version-sync 提示需要 bump brain 版本，按提示在
`packages/brain/package.json` + 其余 4 处同步文件 bump patch 版本，单独一个 commit）。

- [ ] **Step 2: 跑 brain 目标测试文件（不跑全量，避免已知 OOM）**

```bash
cd packages/brain && npx vitest run test/dispatch-dedup.test.js test/dispatcher-dedup.test.js test/orphan-pr-worker.test.js
```

Expected: 全部 PASS

- [ ] **Step 3: node --check 冒烟（Brain deploy 前必须的语法检查，见 CLAUDE.md 铁律）**

```bash
node --check packages/brain/src/dispatch-dedup.js
node --check packages/brain/src/dispatcher.js
node --check packages/brain/src/orphan-pr-worker.js
```

Expected: 无输出（语法通过）

- [ ] **Step 4: push + 开 PR**

```bash
git push -u origin HEAD
gh pr create --title "fix(brain): PR池幂等收尸——派发前标题判重 + orphan红孤儿超期关+superseded检测" --body "$(cat <<'EOF'
## Summary
- 刀1：dispatcher.js 派发前按标题相似度判重（同 task_type 6h 窗口内），防止两个独立
  task_id 描述同一件事各自被合法派发出重复 PR（根因核实：claim 已是原子的，问题在
  "是否已在办"这层判重完全缺失）
- 刀2：orphan-pr-worker.js 红色 CI 孤儿超过 7 天（可配）且无 keep label → 自动关闭；
  新增 superseded 检测，已有高相似度 MERGED PR 的败者直接关闭
- 两者均加 keep label 逃生阀，都是纯函数判重（dispatch-dedup.js）+ 保守 fail-open

## Test plan
- [x] dispatch-dedup.test.js（7 tests，纯函数）
- [x] dispatcher-dedup.test.js（3 tests，判重分支 mock DB）
- [x] orphan-pr-worker.test.js（新增用例覆盖超期关闭/keep豁免/superseded）
- [x] facts-check.mjs / check-version-sync.sh / check-dod-mapping.cjs 全过
- [x] node --check 三个改动文件语法冒烟

Closes Brain issue 6fc3bfe8-73fb-4e0c-a2b5-e146b9bbb221

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: 关闭 Brain issue**

```bash
curl -s -X PATCH localhost:5221/api/brain/issues/6fc3bfe8-73fb-4e0c-a2b5-e146b9bbb221 \
  -H "Content-Type: application/json" \
  -d '{"status":"Closed","pr_url":"<上一步实际拿到的 PR URL>"}'
```
