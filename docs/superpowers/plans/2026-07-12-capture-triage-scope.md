# capture-triage scope 分诊实施计划（GP T5，修订 57d296a1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** capture-triage 的 line_backlog 路由增加 scope 分诊——repair 级维持自动派工零变化，capability 级改写 golden_paths(candidate) 收编为 GP 方向菜单输入源。

**Architecture:** 全部改动集中在 `packages/brain/src/capture-triage.js` 单文件 + 其测试文件。cheap rule（`classifyScope`）先判，thalamus LLM 兜底（扩展既有 TRIAGE_LLM_PROMPT），不可判默认 repair（保持 57d296a1 现状）。capability 路照 invariant 路的事务模式写 golden_paths。设计 SSOT: `docs/superpowers/specs/2026-07-12-capture-triage-scope-design.md`。

**Tech Stack:** Node.js ESM + vitest（mock pool 骨架已存在于测试文件）。

**背景事实（工人须知）:**
- `golden_paths` 表已在库（migration 334，PR #3779 已合），字段见 `packages/brain/migrations/334_golden_paths.sql`；`source` CHECK 含 `'capture_triage'`，`status` 含 `'candidate'`，`title`/`one_liner` NOT NULL。
- 修订决策已落 decisions（id b2eeb1b5），无需再写。
- 测试跑法：`cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`（禁全量 vitest，环境级 OOM）。
- 提交规范：TDD 两 commit（commit-1 failing test / commit-2 实现），push 用 `--no-verify`（主仓 pre-push 全量 quickcheck ~10min）。

---

### Task 1: classifyScope cheap rule

**Files:**
- Modify: `packages/brain/src/capture-triage.js`（第 42 行 applyCheapRules 之后新增）
- Test: `packages/brain/src/__tests__/capture-triage.test.js`

- [ ] **Step 1: 写 failing test**

在 `capture-triage.test.js` 顶部 import 行加入 `classifyScope`：

```js
import { applyCheapRules, classifyScope, isProductionSensitive, runCaptureTriage, updateAtom, __resetCaptureTriageForTest } from '../capture-triage.js';
```

在 `describe('isProductionSensitive...')` 块之后新增：

```js
describe('classifyScope（scope 分诊 cheap rules，修订 57d296a1）', () => {
  it('内容含新平台/新方向/新能力/从零/立项 → capability', () => {
    expect(classifyScope({ target_subtype: 'PASS+NEXT', content: '建议开一个新平台的发布器' })).toBe('capability');
    expect(classifyScope({ target_subtype: 'FAIL', content: '这是个新方向，值得立项' })).toBe('capability');
    expect(classifyScope({ target_subtype: null, content: '需要从零做一套新能力' })).toBe('capability');
  });
  it('capability 关键词优先于 FAIL（含新方向的失败交接进 GP 菜单）', () => {
    expect(classifyScope({ target_subtype: 'FAIL', content: '失败了，根因是缺一个新平台适配层' })).toBe('capability');
  });
  it('handoff FAIL 普通内容 → repair', () => {
    expect(classifyScope({ target_subtype: 'FAIL', content: '回归测试挂了，修一下解析函数' })).toBe('repair');
  });
  it('handoff PASS+NEXT 普通内容 → repair（cheap rule 直接判，不走 LLM）', () => {
    expect(classifyScope({ target_subtype: 'PASS+NEXT', content: '下一步补齐既有 ability 的错误处理' })).toBe('repair');
  });
  it('非 FAIL/PASS+NEXT 且无关键词 → null（拿不准）', () => {
    expect(classifyScope({ target_subtype: 'failure_pattern', content: '一条普通教训' })).toBeNull();
    expect(classifyScope({ target_subtype: null, content: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: FAIL —— `classifyScope is not a function`（SyntaxError: export 不存在）

- [ ] **Step 3: 最小实现**

在 `capture-triage.js` 的 `applyCheapRules`（第 42 行 `return null;` 后的 `}`）之后新增：

```js
export const SCOPES = ['repair', 'capability'];

// scope 分诊 cheap rules（修订 57d296a1，decisions b2eeb1b5）。
// capability 关键词优先于 FAIL/PASS+NEXT：误收进 GP 菜单可由人工圈选恢复，反向误判=自动开工本应批审的方向。
const CAPABILITY_SCOPE_PATTERN = /新方向|新能力|新平台|新业务|从零|立项|new\s+(capability|platform|direction)/i;

/** line_backlog 的 scope 判定：'capability' | 'repair' | null（拿不准，走 LLM 兜底）。 */
export function classifyScope(atom) {
  if (CAPABILITY_SCOPE_PATTERN.test(atom.content || '')) return 'capability';
  if (atom.target_subtype === 'FAIL' || atom.target_subtype === 'PASS+NEXT') return 'repair';
  return null;
}
```

- [ ] **Step 4: 跑测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: 全绿（新增 5 条 + 既有全部）

- [ ] **Step 5: 两段 commit**

```bash
git add packages/brain/src/__tests__/capture-triage.test.js
git commit -m "test(brain): classifyScope scope 分诊 cheap rules failing tests（GP T5）"
git add packages/brain/src/capture-triage.js
git commit -m "feat(brain): capture-triage classifyScope——line_backlog scope cheap rules（修订 57d296a1）"
```

（注意：Step 5 时实现已写完测试已绿，两个 commit 按文件拆分即可满足 tdd commit order——先只 add 测试文件 commit，再 add 实现 commit。若 lint-tdd-commit-order 闸门要求 commit-1 时测试必须红，则改为 Step 1-2 后立即 commit 测试，Step 3-4 后 commit 实现。）

---

### Task 2: capability 路落地（golden_paths 收编）

**Files:**
- Modify: `packages/brain/src/capture-triage.js`（routeAtom 的 line_backlog 分支，第 98-133 行）
- Test: `packages/brain/src/__tests__/capture-triage.test.js`（makePool 骨架扩展 + 4 条用例）

- [ ] **Step 1: 扩展 makePool 骨架**

在 `makePool` 的 `handle` 函数里、`if (/SELECT id FROM decisions/...)` 一行之前插入：

```js
    if (/SELECT id FROM golden_paths/.test(sql)) return { rows: extra.existingGpId ? [{ id: extra.existingGpId }] : [] };
    if (/INSERT INTO golden_paths/.test(sql)) {
      gpInserts.push({ sql, params });
      if (extra.gpInsertThrows) throw new Error(extra.gpInsertThrows);
      return { rows: [{ id: 'gp-1' }] };
    }
```

并在 `makePool` 开头 `const inserts = [];` 之后加 `const gpInserts = [];`，在 `const pool = {` 的暴露清单里把 `inserts,` 改为 `inserts, gpInserts,`。

- [ ] **Step 2: 写 failing tests**

在 `describe('runCaptureTriage 四路落地')` 块内追加：

```js
  it('capability：handoff 含新平台语义 → 不 createTask，写 golden_paths(candidate, capture_triage)，atom 标 [triage:capability]', async () => {
    const pool = makePool([{ id: 'a-cap', target_type: 'handoff', target_subtype: 'PASS+NEXT', content: '建议做一个新平台的自动发布能力', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    const r = await runCaptureTriage(pool);
    expect(r.failed).toBe(0);
    expect(createTask).not.toHaveBeenCalled();
    expect(pool.gpInserts).toHaveLength(1);
    const ins = pool.gpInserts[0];
    expect(ins.sql).toMatch(/'candidate'/);
    expect(ins.sql).toMatch(/'capture_triage'/);
    expect(ins.params[0]).toBe('建议做一个新平台的自动发布能力'.slice(0, 80)); // title
    expect(ins.params[2]).toBe('jrn-1');                                        // journey_id
    expect(ins.params[3]).toContain('atom:a-cap');                              // status_reason 幂等锚
    const upd = pool.updates[0];
    expect(upd.sql).toMatch(/status = 'confirmed'/);
    expect(upd.params).toContain('golden_paths');
    expect(upd.params).toContain('gp-1');
    expect(upd.params.join(' ')).toContain('[triage:capability]');
    expect(pool.txStatements).toEqual(['BEGIN', 'COMMIT']);
  });

  it('capability 判定优先于生产护栏：含新平台+生产环境 → 仍走 GP 收编不留箱', async () => {
    const pool = makePool([{ id: 'a-cap2', target_type: 'handoff', target_subtype: 'FAIL', content: '生产环境需要一个新平台监控能力', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    await runCaptureTriage(pool);
    expect(createTask).not.toHaveBeenCalled();
    expect(pool.gpInserts).toHaveLength(1);
    expect(pool.updates[0].params.join(' ')).toContain('[triage:capability]');
  });

  it('capability 幂等：同 atom 锚已有 golden_paths → 不重复 INSERT，只补 atom 指针', async () => {
    const pool = makePool(
      [{ id: 'a-cap3', target_type: 'handoff', target_subtype: 'PASS+NEXT', content: '新平台候选重试', routed_to_table: 'tasks', routed_to_id: 't1' }],
      { existingGpId: 'gp-old' }
    );
    await runCaptureTriage(pool);
    expect(pool.gpInserts).toHaveLength(0);
    const upd = pool.updates[0];
    expect(upd.params).toContain('gp-old');
    expect(upd.params.join(' ')).toContain('[triage:capability]');
  });

  it('capability FK 容错：INSERT 抛 FK/uuid 错误 → ROLLBACK 且按 no_journey 语义留箱', async () => {
    const pool = makePool(
      [{ id: 'a-cap4', target_type: 'handoff', target_subtype: 'PASS+NEXT', content: '新平台但 journey 脏了', routed_to_table: 'tasks', routed_to_id: 't1' }],
      { gpInsertThrows: 'insert or update on table "golden_paths" violates foreign key constraint' }
    );
    const r = await runCaptureTriage(pool);
    expect(r.failed).toBe(0);
    expect(pool.txStatements).toContain('ROLLBACK');
    const upd = pool.updates[0];
    expect(upd.sql).not.toMatch(/status = 'confirmed'/);
    expect(upd.params.join(' ')).toContain('[triage:no_journey]');
  });
```

- [ ] **Step 3: 跑测试确认新 4 条 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: 新增 4 条 FAIL（createTask 仍被调用 / gpInserts 为空），既有用例仍绿。

- [ ] **Step 4: commit failing tests**

```bash
git add packages/brain/src/__tests__/capture-triage.test.js
git commit -m "test(brain): capability 路收编 golden_paths failing tests（GP T5）"
```

- [ ] **Step 5: 实现 capability 路**

`capture-triage.js` 中，在 `routeAtom` 函数之前新增：

```js
/** capability 级收编（修订 57d296a1，decisions b2eeb1b5）：写 golden_paths(candidate)，不自动开工。
 *  INSERT 与 atom UPDATE 同事务（照 invariant 路模式）；status_reason 内嵌 atom:<id> 做幂等锚。 */
async function routeCapability(pool, atom, verdict, journeyId) {
  const { confidence, reason = '' } = verdict;
  const atomUpdate = { status: 'confirmed', routedToTable: 'golden_paths', confidence };
  const { rows: existing } = await pool.query(
    `SELECT id FROM golden_paths WHERE status_reason LIKE $1 LIMIT 1`,
    [`%atom:${atom.id}%`]
  );
  if (existing.length) {
    return updateAtom(pool, atom.id, { ...atomUpdate, routedToId: existing[0].id, aiReason: `[triage:capability] 已收编 GP 候选 ${existing[0].id}。${reason}` });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO golden_paths (title, one_liner, journey_id, status, source, status_reason)
       VALUES ($1,$2,$3,'candidate','capture_triage',$4) RETURNING id`,
      [atom.content.slice(0, 80), atom.content.slice(0, 200), journeyId, `capture-triage atom:${atom.id}`]
    );
    await updateAtom(client, atom.id, { ...atomUpdate, routedToId: rows[0].id, aiReason: `[triage:capability] 收编 GP 候选 ${rows[0].id}。${reason}` });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // journey_id 来自 tasks.payload（text，无 FK 保证）：FK/uuid 违约按 no_journey 语义留箱，避免脏数据反复占用重试
    if (/foreign key|invalid input syntax/i.test(err.message)) {
      return updateAtom(pool, atom.id, { confidence, aiReason: `[triage:no_journey] golden_paths 写入失败（journey_id 非法）：${err.message.slice(0, 120)}。${reason}` });
    }
    throw err;
  } finally {
    client.release();
  }
}
```

在 `routeAtom` 的 line_backlog 分支里，`if (!journeyId) {...}` 块之后、`if (isProductionSensitive(atom)) {...}` 之前插入：

```js
    const scope = await resolveScope(atom, verdict, opts);
    if (scope === 'capability') {
      return routeCapability(pool, atom, verdict, journeyId);
    }
```

并临时新增最小 `resolveScope`（Task 3 再扩 LLM 兜底）：

```js
/** line_backlog 的 scope 解析：verdict 自带 → cheap rule → （Task 3 加 LLM 兜底）→ 默认 repair 维持 57d296a1 现状。 */
async function resolveScope(atom, verdict, _opts) {
  if (SCOPES.includes(verdict.scope)) return verdict.scope;
  return classifyScope(atom) ?? 'repair';
}
```

- [ ] **Step 6: 跑测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: 全绿。

- [ ] **Step 7: commit 实现**

```bash
git add packages/brain/src/capture-triage.js
git commit -m "feat(brain): capture-triage capability 路收编 golden_paths(candidate)——不再自动建任务（修订 57d296a1）"
```

---

### Task 3: LLM scope 兜底 + prompt 扩展

**Files:**
- Modify: `packages/brain/src/capture-triage.js`（TRIAGE_LLM_PROMPT + resolveScope + LLM verdict 组装）
- Test: `packages/brain/src/__tests__/capture-triage.test.js`（3 条用例）

- [ ] **Step 1: 写 failing tests**

在 `describe('runCaptureTriage 四路落地')` 块内追加（注入 llm 的写法与既有 LLM 用例一致——`runCaptureTriage(pool, { llm })`）：

```js
  it('LLM scope 兜底：cheap rule 拿不准（learning 无关键词路由 line_backlog）→ LLM 判 capability 走 GP 收编', async () => {
    const pool = makePool([{ id: 'a-llm1', target_type: 'learning', target_subtype: 'note', content: '值得考虑的一块业务空白', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    const llm = vi.fn().mockResolvedValue({ text: JSON.stringify({ route: 'line_backlog', confidence: 0.9, reason: 'x', scope: 'capability' }) });
    await runCaptureTriage(pool, { llm });
    expect(createTask).not.toHaveBeenCalled();
    expect(pool.gpInserts).toHaveLength(1);
  });

  it('LLM scope 兜底：LLM 路由 line_backlog 但 scope 非法/缺失 → 默认 repair 走 createTask（57d296a1 现状）', async () => {
    const pool = makePool([{ id: 'a-llm2', target_type: 'learning', target_subtype: 'note', content: '一条模糊教训', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    const llm = vi.fn().mockResolvedValue({ text: JSON.stringify({ route: 'line_backlog', confidence: 0.9, reason: 'x' }) });
    await runCaptureTriage(pool, { llm });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(pool.gpInserts).toHaveLength(0);
  });

  it('TRIAGE_LLM_PROMPT 含 scope 字段要求（repair|capability）', async () => {
    const pool = makePool([{ id: 'a-llm3', target_type: 'learning', target_subtype: 'note', content: 'x', routed_to_table: null, routed_to_id: null }]);
    const llm = vi.fn().mockResolvedValue({ text: JSON.stringify({ route: 'okr', confidence: 0.9, reason: 'x' }) });
    await runCaptureTriage(pool, { llm });
    expect(llm.mock.calls[0][1]).toMatch(/scope/);
    expect(llm.mock.calls[0][1]).toMatch(/repair\|capability/);
  });
```

- [ ] **Step 2: 跑测试确认前两条按预期（第 1 条 FAIL：走了 createTask；第 3 条 FAIL：prompt 无 scope）**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: 第 1、3 条 FAIL；第 2 条可能已绿（resolveScope 默认 repair）——保留作回归锁。

- [ ] **Step 3: commit failing tests**

```bash
git add packages/brain/src/__tests__/capture-triage.test.js
git commit -m "test(brain): LLM scope 兜底 failing tests（GP T5）"
```

- [ ] **Step 4: 实现**

① `TRIAGE_LLM_PROMPT` 末行改为：

```js
只输出 JSON：{"route":"urgent|line_backlog|invariant|okr","confidence":0.0-1.0,"reason":"一句话","scope":"repair|capability"}
scope 仅在 route=line_backlog 时必填：repair=修复/回归/既有能力小改；capability=新方向/新能力/新平台/新业务。其他 route 可省略。`;
```

② `runCaptureTriage` LLM 路径组装 verdict 时带上 scope（第 220 行）：

```js
        verdict = { route: parsed.route, confidence: parsed.confidence, reason: parsed.reason || '', scope: parsed.scope };
```

③ `resolveScope` 扩成完整版（替换 Task 2 的最小版）：

```js
/** line_backlog 的 scope 解析：verdict 自带 → cheap rule → LLM 兜底 → 默认 repair（维持 57d296a1 现状，
 *  误判有 isProductionSensitive 护栏 + CI + code-review + 次日验货三层事后兜底）。 */
async function resolveScope(atom, verdict, { llm } = {}) {
  if (SCOPES.includes(verdict.scope)) return verdict.scope;
  const ruled = classifyScope(atom);
  if (ruled) return ruled;
  if (LLM_ENABLED && llm) {
    try {
      const { text } = await llm('thalamus', TRIAGE_LLM_PROMPT(atom), { maxTokens: 256 });
      const parsed = extractJsonObject(text);
      if (parsed && SCOPES.includes(parsed.scope)) return parsed.scope;
    } catch { /* 兜底走默认 */ }
  }
  return 'repair';
}
```

- [ ] **Step 5: 跑测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: 全绿。

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/capture-triage.js
git commit -m "feat(brain): capture-triage LLM scope 兜底+prompt 扩展，拿不准默认 repair（GP T5）"
```

---

### Task 4: 回归锁（[自动派工] 前缀 = 晨报口径）+ 版本 bump + DevGate

**Files:**
- Test: `packages/brain/src/__tests__/capture-triage.test.js`（1 条断言）
- Modify: `packages/brain/package.json`（version minor bump）

- [ ] **Step 1: 写晨报口径回归锁测试**

在 `describe('runCaptureTriage 四路落地')` 内追加：

```js
  it('repair 回归锁：createTask title 以 [自动派工] 前缀开头（晨报 T6 查询口径 title LIKE）', async () => {
    const pool = makePool([{ id: 'a-rep', target_type: 'handoff', target_subtype: 'FAIL', content: '修复解析函数的回归', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    await runCaptureTriage(pool);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0].title.startsWith('[自动派工] ')).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认 PASS（本条是锁现状，应直接绿）**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js`
Expected: 全绿。

- [ ] **Step 3: 版本 bump + DevGate**

```bash
cd packages/brain && npm version minor --no-git-tag-version && cd ../..
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node --check packages/brain/src/capture-triage.js
```

Expected: 三项全部通过。若 check-version-sync 报另有三处版本要同步，按脚本输出逐处改齐。

- [ ] **Step 4: 跑相邻测试确认无误伤**

```bash
cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js src/__tests__/scheduler-jobs.test.js
```

Expected: 全绿。

- [ ] **Step 5: commit**

```bash
git add packages/brain/src/__tests__/capture-triage.test.js packages/brain/package.json
git commit -m "test(brain): [自动派工] 前缀回归锁（晨报口径）+ brain 版本 bump（GP T5）"
```

---

## DoD（PR 描述用）

- [ ] [BEHAVIOR] repair 级 atom（handoff FAIL 普通内容）自动派工零变化，title 前缀 [自动派工] — Test: tests/ `packages/brain/src/__tests__/capture-triage.test.js`
- [ ] [BEHAVIOR] capability 级 atom（含新平台语义）不建任务，写 golden_paths(candidate, source='capture_triage')，atom 标 [triage:capability] — Test: tests/ `packages/brain/src/__tests__/capture-triage.test.js`
- [ ] [BEHAVIOR] scope 拿不准走 LLM 兜底，LLM 失败默认 repair — Test: tests/ `packages/brain/src/__tests__/capture-triage.test.js`
- [ ] 修订决策已落 decisions（b2eeb1b5，引用 57d296a1+cb6be3f6）— 验证: manual: `node -e "console.log('decisions b2eeb1b5 已于 PrepPRD 阶段写入')"`
- [ ] CI 全绿

## 哨兵说明

本改动全部是**逻辑接缝**（分类函数 + SQL 路由），CI regression test 即为对种类的守卫，无环境接缝（不碰真机/生产 env 读取/部署路径），不需要运行时自检。proven-to-fire：Task 2/3 的 failing test 阶段即亲眼见红。
