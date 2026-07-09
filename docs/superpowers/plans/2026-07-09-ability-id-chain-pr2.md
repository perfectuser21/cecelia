# ability_id 全链接线 PR2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接通 ability 维度从点火（relay spawn env）→ 运行留痕（initiative_runs）→ 收尾回写（report PATCH + Notion push）的三根断线，并修复军师 eval 实锤的两个数据卫生 bug（issues.journey_id 缺失写入、tasks?journey_id= 过滤失效）。

**Architecture:** 纯接线/修 bug 类改动，无新架构。沿用现有 `CECELIA_JOURNEY_ID` env 注入模式、`notion-push-sync.js` 8 个 push 函数的同构模板、`routes/abilities.js` PR1 已建的 advancement PATCH 端点。全部改动落在 Brain 后端（`packages/brain/src`）+ harness-report skill（`packages/workflows/skills`）。

**Tech Stack:** Node.js / Express / PostgreSQL（node-postgres）/ vitest / bash（harness-report SKILL.md 里的 shell 步骤）。

## Global Constraints

- 所有 SQL 迁移文件命名 `packages/brain/migrations/<NNN>_<desc>.sql`，序号严格递增，禁止撞号（当前最大号 322，本计划用 323/324）。
- 新增/改动 API 行为必须有对应 vitest 测试，遵循仓库现有 mock 模式（`vi.mock('../db.js', ...)` + `mockPool.query`）。
- 遵循 TDD 铁律：每个 Task 先写 failing test（commit-1），再写实现让其变绿（commit-2）。
- Brain 版本四处同步（`packages/brain/package.json` / `package-lock.json` / `.brain-versions` / `DEFINITION.md`）必须一致，用 `bash scripts/check-version-sync.sh` 验证。
- 不改动 `routes/abilities.js` 现有三个 advancement 端点（PR1 已生产验证，仅复用）。
- 不改前端 / war room UI（不在本次范围）。

---

### Task 1: initiative_runs 加 ability_id 列 + relay 两处 INSERT 写入

**Files:**
- Create: `packages/brain/migrations/323_initiative_runs_ability_id.sql`
- Modify: `packages/brain/src/harness-skill-relay.js:278-282`（docker 分支 INSERT）
- Modify: `packages/brain/src/harness-skill-relay.js:483-489`（headed 分支 INSERT）
- Test: `packages/brain/src/__tests__/harness-skill-relay.test.js`

**Interfaces:**
- Consumes: 无（本任务是数据流最上游）
- Produces: `initiative_runs.ability_id` 列（后续任务 3 里 report 阶段可选读取，本 PR 不消费，仅落库）

- [ ] **Step 1: 写 migration 文件**

```sql
-- Migration 323: initiative_runs 加 ability_id 列（ability_id 全链接线 PR2）
-- relay spawn 时从 task.ability_id 带入，供后续按 ability 聚合 run 历史。
ALTER TABLE initiative_runs ADD COLUMN IF NOT EXISTS ability_id UUID REFERENCES journey_features(id);
CREATE INDEX IF NOT EXISTS idx_initiative_runs_ability_id ON initiative_runs(ability_id);
```

- [ ] **Step 2: 写 failing test（docker 分支 INSERT 带 ability_id）**

在 `packages/brain/src/__tests__/harness-skill-relay.test.js` 的 `describe('spawnSkillRelaySession', ...)` 块内，紧跟现有 happy-path test 之后新增：

```js
  it('task.ability_id 存在时，initiative_runs INSERT 带上 ability_id 参数', async () => {
    const deps = makeDeps();
    const task = { ...TASK, ability_id: 'ability-uuid-1' };
    await spawnSkillRelaySession(task, deps);

    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall).toBeTruthy();
    const [sql, params] = insertCall;
    expect(sql).toMatch(/ability_id/);
    expect(params).toContain('ability-uuid-1');
  });

  it('task.ability_id 缺省时，ability_id 参数为 null（不报错）', async () => {
    const deps = makeDeps();
    await spawnSkillRelaySession(TASK, deps); // TASK 本身无 ability_id 顶层字段
    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    const [, params] = insertCall;
    expect(params).toContain(null);
  });
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js -t "ability_id"`
Expected: FAIL（`sql` 里没有 `ability_id` 字符串 / `params` 不含预期值）

- [ ] **Step 4: 实现 — relay env 注入 + 两处 INSERT**

`packages/brain/src/harness-skill-relay.js:255` 附近（docker spawnFn env 对象），紧跟 `CECELIA_JOURNEY_ID` 那一行之后新增：

```js
          CECELIA_JOURNEY_ID: task.payload?.journey_id || '',
          CECELIA_ABILITY_ID: task.ability_id || task.payload?.ability_id || '',
```

`packages/brain/src/harness-skill-relay.js:277-282`（docker 分支 INSERT，原代码见 Task 描述），改为：

```js
    const deadlineHours = isCodex ? CODEX_RELAY_DEADLINE_HOURS : RELAY_DEADLINE_HOURS;
    const orchestratorHost = isCodex ? 'skill-relay-codex' : 'skill-relay-session';
    const abilityId = task.ability_id || task.payload?.ability_id || null;
    await dbPool.query(
      `INSERT INTO initiative_runs
         (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at, ability_id)
       VALUES ($1, 'A_planning', $2, 'v2', $3, NOW() + INTERVAL '${deadlineHours} hours', $4)`,
      [initiativeId, task.payload?.journey_id || null, orchestratorHost, abilityId]
    );
```

`packages/brain/src/harness-skill-relay.js:483-489`（headed 分支 INSERT），改为：

```js
  // initiative_runs 落行（orchestrator_host='skill-relay-codex-headed' 内联，便于测试断言）
  const headedAbilityId = task.ability_id || task.payload?.ability_id || null;
  await dbPool.query(
    `INSERT INTO initiative_runs
       (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at, ability_id)
     VALUES ($1, 'A_planning', $2, 'v2', 'skill-relay-codex-headed', NOW() + INTERVAL '${HEADED_RELAY_DEADLINE_HOURS} hours', $3)`,
    [initiativeId, task.payload?.journey_id || null, headedAbilityId]
  );
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js`
Expected: PASS（全部用例，含既有用例不回归）

- [ ] **Step 6: Commit**

```bash
git add packages/brain/migrations/323_initiative_runs_ability_id.sql \
        packages/brain/src/harness-skill-relay.js \
        packages/brain/src/__tests__/harness-skill-relay.test.js
git commit -m "feat(brain): initiative_runs 加 ability_id 列 + relay spawn env/落行接线"
```

---

### Task 2: notion-push-sync 加第9个函数 pushAdvancementItems

**Files:**
- Create: `packages/brain/migrations/324_advancement_items_notion_sync.sql`
- Modify: `packages/brain/src/notion-push-sync.js`（新增函数 + 接入 `runNotionPushSync`）
- Test: `packages/brain/src/__tests__/notion-push-sync.test.js`

**Interfaces:**
- Consumes: `computeProgress({done, doing, todo})` from `packages/brain/src/advancement-progress.js`（PR1 已存在，签名：`{done,doing,todo,total,pct}`）
- Produces: 无下游消费（本任务是 Phase B 链条末端新增的一环）

**背景（写代码前必读）**：`advancement_items` 表（migration 320）目前没有专属 Notion 数据库，也没有 `notion_id`/`notion_synced_at` 列。设计选择：不为每个推进项单独建 Notion 页面，而是把某个 ability 名下推进项的聚合进度（`done/total (pct%)`）以 rich_text 形式 PATCH 到该 ability 已同步的 Notion Feature 页面上——沿用 `pushDecisions` 里"先取一次库 schema、只在目标属性真实存在时才发送"的安全模式（避免对未建列的 Notion 库发 400）。

- [ ] **Step 1: 写 migration 文件**

```sql
-- Migration 324: advancement_items 加 notion_synced_at 列（供 pushAdvancementItems 去重）
ALTER TABLE advancement_items ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;
```

- [ ] **Step 2: 写 failing test**

在 `packages/brain/src/__tests__/notion-push-sync.test.js` 顶部 `FEATURE_DB` 常量下方增加：

```js
const FEATURE_SCHEMA_WITH_PROGRESS = {
  properties: { 'Advancement Progress': { type: 'rich_text' } },
};
```

在文件末尾（`describe('runNotionPushSync', ...)` 块内，紧挨最后一个既有 `it(...)` 之后）新增：

```js
  it('advancement_items 有未同步聚合且 Feature 库有 Advancement Progress 属性 → PATCH ability 页面并标记已同步', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // journeys
    mockQuery.mockResolvedValueOnce({ rows: [] }); // features
    mockQuery.mockResolvedValueOnce({ rows: [] }); // issues
    mockQuery.mockResolvedValueOnce({ rows: [] }); // skill_registry
    mockQuery.mockResolvedValueOnce({ rows: [] }); // journey_steps
    mockQuery.mockResolvedValueOnce({ rows: [] }); // journey_step_links
    mockQuery.mockResolvedValueOnce({ rows: [] }); // decisions
    mockQuery.mockResolvedValueOnce({ rows: [] }); // initiative_contracts
    // pushAdvancementItems 内部第一条 query：按 ability 聚合未同步推进项
    mockQuery.mockResolvedValueOnce({
      rows: [{ ability_id: 'ab-1', ability_notion_id: 'notion-ab-1', done: '2', doing: '1', todo: '1' }],
    });
    mockNotionReq.mockResolvedValueOnce(FEATURE_SCHEMA_WITH_PROGRESS); // GET database schema
    mockNotionReq.mockResolvedValueOnce({}); // PATCH page
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE advancement_items

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    const patchCall = mockNotionReq.mock.calls.find(c => c[2] === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect(patchCall[1]).toBe('/pages/notion-ab-1');
    expect(patchCall[3].properties['Advancement Progress'].rich_text[0].text.content).toContain('2/4');

    const updateCall = mockQuery.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE advancement_items')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toContain('ab-1');
  });

  it('Feature 库无 Advancement Progress 属性 → 跳过 PATCH 但仍标记已同步（避免死循环重试）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ ability_id: 'ab-2', ability_notion_id: 'notion-ab-2', done: '0', doing: '0', todo: '1' }],
    });
    mockNotionReq.mockResolvedValueOnce({ properties: {} }); // GET schema，无目标属性
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE advancement_items

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    const patchCall = mockNotionReq.mock.calls.find(c => c[2] === 'PATCH');
    expect(patchCall).toBeUndefined();
    const updateCall = mockQuery.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE advancement_items')
    );
    expect(updateCall).toBeTruthy();
  });
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/notion-push-sync.test.js -t "advancement"`
Expected: FAIL（`pushAdvancementItems` 尚不存在 / 未接入 `runNotionPushSync`）

- [ ] **Step 4: 实现 pushAdvancementItems + 接入 Phase B**

在 `packages/brain/src/notion-push-sync.js` 里 `pushInitiativeContracts` 函数之后、`export async function runNotionPushSync` 之前新增：

```js
import { computeProgress } from './advancement-progress.js';

async function pushAdvancementItems(pool, token) {
  // 按 ability 聚合：只处理该 ability 已有 Notion 页面、且存在未同步推进项的组
  const { rows } = await pool.query(`
    SELECT ai.ability_id, jf.notion_id AS ability_notion_id,
           COUNT(*) FILTER (WHERE ai.status='done')  AS done,
           COUNT(*) FILTER (WHERE ai.status='doing') AS doing,
           COUNT(*) FILTER (WHERE ai.status='todo')  AS todo
    FROM advancement_items ai
    JOIN journey_features jf ON jf.id = ai.ability_id
    WHERE ai.notion_synced_at IS NULL AND jf.notion_id IS NOT NULL
    GROUP BY ai.ability_id, jf.notion_id
    LIMIT 10
  `);
  if (rows.length === 0) return;

  // 取一次 Feature 库 schema：只有目标属性真实存在才 PATCH，避免对未建列的库 400
  // （同 pushDecisions 的 schema-check 安全模式）
  let schemaProps = {};
  try {
    const schema = await notionReq(token, `/databases/${FEATURE_DB}`, 'GET');
    schemaProps = schema?.properties || {};
  } catch {
    schemaProps = {};
  }
  const progressProp = Object.keys(schemaProps).find((k) => /advancement.*progress/i.test(k));

  for (const r of rows) {
    try {
      if (progressProp) {
        const { done, total, pct } = computeProgress({
          done: Number(r.done), doing: Number(r.doing), todo: Number(r.todo),
        });
        await notionReq(token, `/pages/${r.ability_notion_id}`, 'PATCH', {
          properties: {
            [progressProp]: { rich_text: buildRichText(`${done}/${total} 完成 (${pct}%)`) },
          },
        });
      }
      // 无论是否真的发了 PATCH（属性不存在时跳过），都标记已同步——
      // 属性缺失是"Notion 库未建列"的运维状态，不是"应无限重试"的瞬时错误
      await pool.query(
        `UPDATE advancement_items SET notion_synced_at=NOW() WHERE ability_id=$1 AND notion_synced_at IS NULL`,
        [r.ability_id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] advancement ability ${r.ability_id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}
```

在 `runNotionPushSync` 函数末尾新增第9行调用：

```js
  await pushJourneys(pool, token);
  await pushJourneyFeatures(pool, token);
  await pushIssues(pool, token);
  await pushSkillRegistry(pool, token);
  await pushJourneySteps(pool, token);
  await pushJourneyStepLinks(pool, token);
  await pushDecisions(pool, token);
  await pushInitiativeContracts(pool, token);
  await pushAdvancementItems(pool, token);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/notion-push-sync.test.js`
Expected: PASS（全部用例，含既有 8 个 push 函数用例不回归——注意既有 test 用 `mockResolvedValue({rows:[]})` 兜底剩余 query 调用，新增的第9个函数调用会落入该兜底，不需要改动既有测试）

- [ ] **Step 6: Commit**

```bash
git add packages/brain/migrations/324_advancement_items_notion_sync.sql \
        packages/brain/src/notion-push-sync.js \
        packages/brain/src/__tests__/notion-push-sync.test.js
git commit -m "feat(brain): notion-push-sync 加第9个函数 pushAdvancementItems"
```

---

### Task 3: harness-report SKILL.md 修 thickness:"done" bug + 推进项回写

**Files:**
- Modify: `packages/workflows/skills/harness-report/SKILL.md:290-296`（Step 4 附近）

**Interfaces:**
- Consumes: `PATCH /api/brain/advancements/:itemId`（PR1 已建，`routes/abilities.js`，字段 `status`/`pr_url`）
- Produces: 无（skill 文档，非被其他任务消费的代码接口）

**说明**：SKILL.md 是纯 bash 脚本文档，无 vitest 覆盖；本任务用 manual 验证（DoD 里的验收标准第4条）而非自动化单测——与仓库既有 harness-report SKILL.md 改动惯例一致（其余步骤同样无单测，靠 relay 实跑验证）。

- [ ] **Step 1: 修复 thickness 非法值 + 新增推进项回写**

把 `packages/workflows/skills/harness-report/SKILL.md` 第290-296行：

```
### Step 4: 更新 Notion Feature Registry

```bash
[ -n "$FEATURE_ID" ] && curl -s -X PATCH "localhost:5221/api/brain/journey_features/$FEATURE_ID" \
  -H "Content-Type: application/json" \
  -d '{"thickness":"done","status":"done"}' >/dev/null 2>&1 || echo "WARN: Feature Registry 更新失败（非阻断）"
echo "✅ Step 4: Notion Feature Registry status → done"
```
```

替换为：

```
### Step 4: 更新 Notion Feature Registry + 回写推进项

```bash
# thickness 合法值只有 thin/medium/thick/mature（routes/journeys.js VALID_THICKNESS），
# "done" 非法值会 400（此前一直被 || echo WARN 静默吞掉、从未真正生效）——只传 status，不传 thickness
[ -n "$FEATURE_ID" ] && curl -s -X PATCH "localhost:5221/api/brain/journey_features/$FEATURE_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}' >/dev/null 2>&1 || echo "WARN: Feature Registry 更新失败（非阻断）"
echo "✅ Step 4: Notion Feature Registry status → done"

# 推进项回写：若本次 task 关联了 advancement_item_id（军师上游派发时会带，PR2 阶段通常为空，属预期）
if [ -n "$TASK_ID" ]; then
  ADVANCEMENT_ITEM_ID=$(curl -s "localhost:5221/api/brain/tasks/$TASK_ID" 2>/dev/null \
    | jq -r '.payload.advancement_item_id // empty' 2>/dev/null)
  if [ -n "$ADVANCEMENT_ITEM_ID" ]; then
    curl -s -X PATCH "localhost:5221/api/brain/advancements/$ADVANCEMENT_ITEM_ID" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"done\",\"pr_url\":\"${PR_URL}\"}" >/dev/null 2>&1 \
      || echo "WARN: 推进项回写失败（非阻断）"
    echo "✅ Step 4.5: 推进项 $ADVANCEMENT_ITEM_ID → done, pr_url=$PR_URL"
  fi
fi
```
```

- [ ] **Step 2: 语法自检**

Run: `bash -n <(sed -n '/### Step 4:/,/^---$/p' packages/workflows/skills/harness-report/SKILL.md | sed -n '/```bash/,/```/p' | sed '1d;$d')`
Expected: 无输出（bash 语法解析通过，无 syntax error）

- [ ] **Step 3: Commit**

```bash
git add packages/workflows/skills/harness-report/SKILL.md
git commit -m "fix(harness-report): 修 thickness:done 无效值400 bug + 加推进项回写步骤"
```

---

### Task 4: issues.journey_id 写入卫生（test-lifecycle-patrol.js）

**Files:**
- Modify: `packages/brain/src/test-lifecycle-patrol.js:79-84`
- Test: `packages/brain/src/__tests__/test-lifecycle-patrol.test.js`（若不存在则新建）

**Interfaces:**
- Consumes: 无
- Produces: 无（本任务只是让 INSERT 语句显式列出 `journey_id` 列，值恒为 `NULL`——孤儿 test 对应的 `journey_features` 行已被删除，语境里无法推断其 journey 归属，显式传 NULL 优于隐式缺省，便于后续排查时一眼看出"已考虑过但确实不可推断"而非"遗漏"）

- [ ] **Step 1: 确认/建立测试文件骨架，写 failing test**

先检查是否已有该文件的测试：

Run: `ls packages/brain/src/__tests__/test-lifecycle-patrol.test.js 2>/dev/null || echo "not-exist"`

若不存在，创建 `packages/brain/src/__tests__/test-lifecycle-patrol.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTestLifecyclePatrol } from '../test-lifecycle-patrol.js';

vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
vi.mock('fs', () => ({ existsSync: vi.fn().mockReturnValue(true) }));

describe('runTestLifecyclePatrol — issues INSERT journey_id 卫生', () => {
  it('孤儿 test（feature 已删除）建 issue 时，INSERT 语句显式包含 journey_id 列（值为 NULL）', async () => {
    const rows = [
      { id: 't1', file_path: 'x/y.test.js', status: 'active', feature_id: 'deleted-feature', scanned_at: new Date() },
    ];
    const db = {
      query: vi.fn((sql) => {
        if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
          return Promise.resolve({ rows });
        }
        if (sql.includes('SELECT id FROM journey_features')) {
          return Promise.resolve({ rows: [] }); // feature 已不存在
        }
        if (sql.includes('INSERT INTO test_lifecycle_alerts')) {
          return Promise.resolve({ rows: [{ id: 'alert-1' }] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    await runTestLifecyclePatrol(db, new Date('2026-07-09T02:00:00Z'));

    const issueInsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO issues'));
    expect(issueInsert).toBeTruthy();
    const [sql, params] = issueInsert;
    expect(sql).toMatch(/journey_id/);
    expect(params).toContain(null);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/test-lifecycle-patrol.test.js`
Expected: FAIL（现有 INSERT 语句不含 `journey_id` 列/参数）

- [ ] **Step 3: 实现**

把 `packages/brain/src/test-lifecycle-patrol.js` 第79-84行：

```js
        await db.query(
          `INSERT INTO issues (title, priority, status, sub_area, body, notion_synced_at)
           VALUES ($1, 'P2', 'In progress', 'brain', $2, NULL)`,
          [
            `孤儿 test：${row.file_path}`,
            `巡检发现 test_registry 中 ${row.file_path} 关联的 journey_features(id=${row.feature_id}) 已不存在。请确认该 test 是否仍有效；若确认无效，走 /dev 删除该 test 文件。`,
          ]
        ).catch(e => console.error('[test-lifecycle-patrol] issue insert failed:', e.message));
```

改为：

```js
        // journey_id 显式传 NULL：feature 已被删除，巡检语境里无法推断其原 journey 归属，
        // 显式列出优于隐式缺省（一眼可辨"已考虑过、确实不可推断"vs"遗漏未写"）
        await db.query(
          `INSERT INTO issues (title, priority, status, sub_area, body, notion_synced_at, journey_id)
           VALUES ($1, 'P2', 'In progress', 'brain', $2, NULL, NULL)`,
          [
            `孤儿 test：${row.file_path}`,
            `巡检发现 test_registry 中 ${row.file_path} 关联的 journey_features(id=${row.feature_id}) 已不存在。请确认该 test 是否仍有效；若确认无效，走 /dev 删除该 test 文件。`,
          ]
        ).catch(e => console.error('[test-lifecycle-patrol] issue insert failed:', e.message));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/test-lifecycle-patrol.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/test-lifecycle-patrol.js packages/brain/src/__tests__/test-lifecycle-patrol.test.js
git commit -m "fix(brain): 孤儿 test issue INSERT 显式列出 journey_id（数据卫生）"
```

---

### Task 5: 修复 `GET /api/brain/tasks?journey_id=` 过滤失效

**Files:**
- Modify: `packages/brain/src/routes/task-tasks.js:170-193`
- Test: `packages/brain/src/__tests__/routes/task-tasks.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `GET /api/brain/tasks?journey_id=<uuid>` 可用（journey_id 存于 `tasks.payload` JSONB，非顶层列）

- [ ] **Step 1: 写 failing test**

在 `packages/brain/src/__tests__/routes/task-tasks.test.js` 的 `describe('GET /tasks', ...)` 块内，紧跟 `'filters by status and project_id'` 测试之后新增：

```js
    it('filters by journey_id（存于 payload JSONB，非顶层列）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/tasks?journey_id=journey-uuid-1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/payload->>'journey_id' = \$1/);
      expect(params[0]).toBe('journey-uuid-1');
    });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/routes/task-tasks.test.js -t "journey_id"`
Expected: FAIL（`journey_id` query 参数当前被静默忽略，SQL 不含该条件）

- [ ] **Step 3: 实现**

把 `packages/brain/src/routes/task-tasks.js` 第170行附近：

```js
    const { status, area_id, project_id, task_type, limit = '200', offset = '0' } = req.query;
```

改为：

```js
    const { status, area_id, project_id, task_type, journey_id, limit = '200', offset = '0' } = req.query;
```

紧跟 `task_type` 的过滤条件块之后（约第186-189行）新增：

```js
    if (task_type) {
      conditions.push(`task_type = $${paramIndex++}`);
      params.push(task_type);
    }
    // journey_id 存于 payload JSONB（tasks 表无顶层 journey_id 列），不能当普通列名处理
    if (journey_id) {
      conditions.push(`payload->>'journey_id' = $${paramIndex++}`);
      params.push(journey_id);
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/routes/task-tasks.test.js`
Expected: PASS（全部用例，含既有用例不回归）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/task-tasks.js packages/brain/src/__tests__/routes/task-tasks.test.js
git commit -m "fix(brain): 修复 GET /api/brain/tasks?journey_id= 过滤失效"
```

---

### Task 6: 版本同步 + DevGate + 全量验证

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/src/selfcheck.js:28`（`EXPECTED_SCHEMA_VERSION`）

**Interfaces:**
- Consumes: 全部前 5 个任务的改动
- Produces: 无（收尾任务）

**背景**：跑 `bash scripts/check-version-sync.sh` 已确认基线本身就有漂移——`package.json` 是 1.243.7，另外 3 个文件仍是 1.243.6（main 上的既有 bug，非本 PR 引入）。本任务顺手把 4 个文件同步到 1.243.8（在漂移的基础上 +1 patch），一次性修好。

- [ ] **Step 1: 版本 bump 4 文件**

```bash
cd packages/brain && npm version 1.243.8 --no-git-tag-version --allow-same-version
cd -
node -e "process.stdout.write(require('./packages/brain/package.json').version)" > .brain-versions
echo >> .brain-versions
```

编辑 `DEFINITION.md` 第9行：`**Brain 版本**: 1.243.6` → `**Brain 版本**: 1.243.8`

- [ ] **Step 2: EXPECTED_SCHEMA_VERSION 更新为本次最新 migration 号**

`packages/brain/src/selfcheck.js:28`：`export const EXPECTED_SCHEMA_VERSION = '322';` → `export const EXPECTED_SCHEMA_VERSION = '324';`

- [ ] **Step 3: 跑 DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 三条命令全部 exit 0。若 facts-check 因 EXPECTED_SCHEMA_VERSION 之外的项失败，按报错逐条修正（不属于本计划预期范围，需临场判断）。

- [ ] **Step 4: 全量跑 Brain 单元测试**

```bash
cd packages/brain && npx vitest run
```

Expected: 全部通过（含 Task 1-5 新增的所有测试）。

- [ ] **Step 5: node --check 冒烟（Brain deploy 前必须过的语法检查，避免 SyntaxError 只有真启动才炸）**

```bash
node --check packages/brain/src/server.js
node --check packages/brain/src/harness-skill-relay.js
node --check packages/brain/src/notion-push-sync.js
node --check packages/brain/src/routes/task-tasks.js
node --check packages/brain/src/test-lifecycle-patrol.js
```

Expected: 无输出（语法全部合法）。

- [ ] **Step 6: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md packages/brain/src/selfcheck.js
git commit -m "chore(brain): 版本同步至 1.243.8 + EXPECTED_SCHEMA_VERSION→324"
```

---

## Self-Review（写完计划后的核对）

- **spec 覆盖**：PrepPRD 7 项 ↔ Task 映射：① relay env → Task1 ② initiative_runs 列 → Task1 ③ pushAdvancementItems → Task2 ④ report 回写 + thickness bug → Task3 ⑤ issues journey_id → Task4 ⑥ tasks 过滤 → Task5 ⑦ ability_id 现状核实 → 已在 Task1 的 relay 代码里直接消费 `task.ability_id`（等同一次回归验证，无需单列任务）。全部覆盖。
- **占位符扫描**：无 TBD/TODO，所有 diff 均为完整代码块。
- **类型一致性**：`task.ability_id` 在 Task1/Task3 里统一取自同一顶层字段（`task-tasks.js` 已确认落库），`payload?.ability_id` 仅作兜底；`advancement_item_id` 统一存在 `tasks.payload.advancement_item_id`（Task3 消费，PR3 待生产），命名前后一致。
- **范围检查**：单 PR 可完成，6 个任务全部聚焦本次断线接线 + 两个卫生 bug，无越界改动。
