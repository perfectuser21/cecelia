# self_model 滚动窗口 + 规则 9 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** updateSelfModel 加 128KB 滚动窗口修 O(n²) 滚雪球；db-slim 加规则 9 归档 self_model 历史（保 30 条）。

**Architecture:** 见 `docs/superpowers/specs/2026-09-09-selfmodel-cap-design.md`。TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每 task commit-1 = 红测试 / commit-2 = 实现变绿。

---

### Task 1: 滚动窗口 trimSelfModelContent（TDD）

**Files:**
- Modify: `packages/brain/src/self-model.js`
- Test: `packages/brain/src/__tests__/self-model.test.js`（追加 describe 块）

- [ ] **Step 1: 追加 failing test**（文件尾部追加，勿动既有用例）

```js
// ── 滚动窗口（防 O(n²) 滚雪球，2026-09-09 第二刀）──────────────
import { trimSelfModelContent, MAX_SELF_MODEL_BYTES } from '../self-model.js';

describe('trimSelfModelContent 滚动窗口', () => {
  const HEAD = '我是 Cecelia，这是头部身份段（蒸馏人格），永不裁剪。';
  const entry = (i) =>
    `[2026-0${(i % 8) + 1}-1${i % 9}] 第 ${i} 条洞察：` + 'x'.repeat(180);
  const build = (n) => HEAD + '\n\n' + Array.from({ length: n }, (_, i) => entry(i)).join('\n\n');

  it('MAX_SELF_MODEL_BYTES 为 128KB', () => {
    expect(MAX_SELF_MODEL_BYTES).toBe(131072);
  });

  it('欠限内容原样返回', () => {
    const c = build(10);
    expect(trimSelfModelContent(c)).toBe(c);
  });

  it('超限时裁到上限以内，且从最老条目开始裁', () => {
    const c = build(1200); // ~1200 × ~200B ≈ 240KB，超 128KB
    expect(Buffer.byteLength(c, 'utf8')).toBeGreaterThan(MAX_SELF_MODEL_BYTES);
    const trimmed = trimSelfModelContent(c);
    expect(Buffer.byteLength(trimmed, 'utf8')).toBeLessThanOrEqual(MAX_SELF_MODEL_BYTES);
    expect(trimmed.startsWith(HEAD)).toBe(true);              // 头部保留
    expect(trimmed).toContain('第 1199 条洞察');               // 最新条目保留
    expect(trimmed).not.toContain('第 0 条洞察');              // 最老条目被裁
  });

  it('头部+最新条目仍超限时原样返回该最小组合（不丢新洞察）', () => {
    const bigHead = 'H'.repeat(MAX_SELF_MODEL_BYTES);
    const c = bigHead + '\n\n[2026-09-09] 新洞察';
    const trimmed = trimSelfModelContent(c);
    expect(trimmed).toContain('新洞察');
    expect(trimmed.startsWith('H')).toBe(true);
  });

  it('updateSelfModel 落库内容不超上限', async () => {
    const huge = build(1200);
    mockQuery.mockReset();
    // getSelfModel 的 SELECT 返回超大 current；INSERT 捕获参数
    mockQuery.mockImplementation((sql) => {
      if (/SELECT content/.test(sql)) return Promise.resolve({ rows: [{ content: huge, created_at: new Date() }] });
      return Promise.resolve({ rows: [] });
    });
    await updateSelfModel('这是新洞察', { query: mockQuery });
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO memory_stream/.test(sql));
    expect(insertCall).toBeTruthy();
    const stored = insertCall[1][0];
    expect(Buffer.byteLength(stored, 'utf8')).toBeLessThanOrEqual(MAX_SELF_MODEL_BYTES);
    expect(stored).toContain('这是新洞察');
  });
});
```

> 注意：文件顶部已有 `updateSelfModel` 的 import 与 `mockQuery`；若 import 列表没有 `trimSelfModelContent`/`MAX_SELF_MODEL_BYTES`，并入顶部既有 import（保持文件只有一处 import self-model.js）。`updateSelfModel(insight, dbPool)` 第二参数直接传 `{ query: mockQuery }` 对象即可（模块内 `db.query` 调用）。若既有 mock 结构不同，按既有模式适配，**断言不变**。

- [ ] **Step 2: 跑测试确认新增用例 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/self-model.test.js`
Expected: 新增用例因 `trimSelfModelContent` 未导出而 FAIL，既有用例不受影响

- [ ] **Step 3: 实现**（self-model.js，`updateSelfModel` 上方加）

```js
// ── 滚动窗口（防 O(n²) 滚雪球）────────────────────────────────
// 每次演化存完整快照的设计在写入量大后无界膨胀（实测 7,075 行 / 3.8GB，
// 峰值 72 条/天）。上限内保留：头部身份段（首个日期条目之前，即种子/蒸馏
// 人格，永不裁）+ 尽可能多的近期日期条目；超限从最老条目裁起，最新条目
// 永不裁。
export const MAX_SELF_MODEL_BYTES = 131072;

const DATED_ENTRY_SPLIT = /\n\n(?=\[\d{4}-\d{2}-\d{2}\] )/;
const DATED_ENTRY_START = /^\[\d{4}-\d{2}-\d{2}\] /;

export function trimSelfModelContent(content) {
  if (Buffer.byteLength(content, 'utf8') <= MAX_SELF_MODEL_BYTES) return content;

  const parts = content.split(DATED_ENTRY_SPLIT);
  const head = DATED_ENTRY_START.test(parts[0]) ? null : parts.shift();

  const SEP_BYTES = 2; // '\n\n'
  const sizes = parts.map((p) => Buffer.byteLength(p, 'utf8'));
  let total = (head ? Buffer.byteLength(head, 'utf8') : -SEP_BYTES)
    + sizes.reduce((sum, s) => sum + SEP_BYTES + s, 0);

  let drop = 0;
  while (drop < parts.length - 1 && total > MAX_SELF_MODEL_BYTES) {
    total -= SEP_BYTES + sizes[drop];
    drop += 1;
  }

  const kept = [head, ...parts.slice(drop)].filter((x) => x !== null);
  const result = kept.join('\n\n');
  if (Buffer.byteLength(result, 'utf8') > MAX_SELF_MODEL_BYTES) {
    console.warn('[self-model] 头部身份段+最新条目仍超上限，按原样存储（需人工蒸馏头部）');
  }
  return result;
}
```

并把 `updateSelfModel` 中：

```js
  const evolved = `${current}\n\n[${date}] ${newInsight.trim()}`;
```

改为：

```js
  const evolved = trimSelfModelContent(`${current}\n\n[${date}] ${newInsight.trim()}`);
```

- [ ] **Step 4: 跑测试确认全绿**（既有 + 新增）
- [ ] **Step 5: 两个 commit**

```bash
git add packages/brain/src/__tests__/self-model.test.js && git commit -m "test(brain): self_model 滚动窗口 failing test（防 O(n²) 滚雪球）"
# 先只 commit 测试再实现？——TDD commit 顺序：本 task 允许 Step1 后立即 commit-1（红），Step3-4 后 commit-2（绿）：
git add packages/brain/src/self-model.js && git commit -m "fix(brain): updateSelfModel 加 128KB 滚动窗口，修 self_model O(n²) 滚雪球"
```

> 严格顺序：**commit-1 必须只含测试且此时测试是红的**；commit-2 含实现让它变绿。

---

### Task 2: db-slim 规则 9（TDD）

**Files:**
- Modify: `packages/brain/src/db-slim-rules.js`、`packages/brain/src/__tests__/db-slim-rules.test.js`、`packages/brain/scripts/smoke/db-slim-smoke.sh`

- [ ] **Step 1: 改测试（红）**——`db-slim-rules.test.js`：

规则名单用例追加第 9 项 `'memory_stream_selfmodel_history'`；新增用例：

```js
  it('self_model 历史规则：保留最新 30 条，其余归档删除', () => {
    const r = SLIM_RULES.find((x) => x.name === 'memory_stream_selfmodel_history');
    expect(r.table).toBe('memory_stream');
    expect(r.deleteWhere).toContain("source_type = 'self_model'");
    expect(r.deleteWhere).toContain('ORDER BY created_at DESC');
    expect(r.deleteWhere).toContain('LIMIT 30');
    expect(r.archiveWhere).toBe(r.deleteWhere);
  });
```

- [ ] **Step 2: 跑测试确认 FAIL**（名单用例 + 新用例红）
- [ ] **Step 3: 实现**——`db-slim-rules.js` 的 SLIM_RULES 末尾追加：

```js
  {
    name: 'memory_stream_selfmodel_history',
    table: 'memory_stream',
    archiveWhere: `source_type = 'self_model' AND id NOT IN (
      SELECT id FROM memory_stream
      WHERE source_type = 'self_model'
      ORDER BY created_at DESC
      LIMIT 30
    )`,
    deleteWhere: `source_type = 'self_model' AND id NOT IN (
      SELECT id FROM memory_stream
      WHERE source_type = 'self_model'
      ORDER BY created_at DESC
      LIMIT 30
    )`,
  },
```

同时 `db-slim-smoke.sh` 里 `RULE_COUNT" -eq 8` 改为 `-eq 9`，报错文案同步"应报告 9 条规则"。

- [ ] **Step 4: 全绿 + smoke 真跑**

```bash
cd packages/brain && npx vitest run src/__tests__/db-slim-rules.test.js
cd ../.. && DATABASE_URL="postgres://localhost/cecelia_test" bash packages/brain/scripts/smoke/db-slim-smoke.sh
```

Expected: 测试全绿；smoke 输出 `dry-run 9 条规则 SQL 对真实 schema 可执行` + check 双向 PASS

- [ ] **Step 5: 两个 commit**（同 Task 1 纪律：commit-1 测试红 / commit-2 实现+smoke 绿）

---

### Task 3: 版本 bump + DevGate（机械）

```bash
cd packages/brain && npm version patch --no-git-tag-version && cd ../..
node -e "process.stdout.write(require('./packages/brain/package.json').version)" > .brain-versions
# DEFINITION.md 的 "**Brain 版本**: x.y.z" 行改成新版本号
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs
git add -A && git commit -m "chore(brain): version bump"
```

（git add -A 前确认无 package-lock.json 意外变更，有则 `git checkout -- package-lock.json`。）

---

### Task 4（主会话执行，不派 subagent）: 蒸馏 + 归档 + 验收

主会话按设计文档「运维序列」执行：蒸馏 INSERT → `db-slim.mjs --apply` → VACUUM → 五条验收真查库 → push + PR → watchdog。
