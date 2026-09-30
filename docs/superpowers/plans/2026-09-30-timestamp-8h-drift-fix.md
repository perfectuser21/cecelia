# 时间列偏 8 小时修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Brain `tasks.started_at`/`created_at` 等 `timestamp without time zone` 列
读取时被 node-pg 按进程时区（Asia/Shanghai）误解析，导致比真实时刻早 8 小时的 bug；
同步清理 `due_at` 的双重补偿，改为统一的真实 UTC 语义；顺带修 2 处独立的方向反了的
时区转换 bug。

**Architecture:** 核心是 `packages/brain/src/db.js` 加一行 `pg.types.setTypeParser(1114, ...)`
把 OID 1114 显式按 UTC 解析。这一处改动是所有下游修复的前提——因为 `due_at` 现在靠
"写入时故意存错的北京墙钟数字 + 读取时的 bug 刚好纠正"两个错误抵消凑出正确结果，
一旦只修读取不改写入，`due_at` 会从"凑巧对"变成"实打实错"，所以两处 `due_at` 相关文件
必须在同一个 PR 里跟 `db.js` 一起改（Task 1→2 顺序不能拆）。`project-compare.js`/
`routes/ops.js` 的 2 处独立 bug 与前面无依赖关系，可以在 Task 4 单独改验。

**Tech Stack:** Node.js（ESM），Vitest（pg.integration.test.js 走真实 Postgres 连接，
DB `cecelia_test`），PostgreSQL

设计文档：`docs/superpowers/specs/2026-09-30-timestamp-8h-drift-design.md`

---

### Task 1: 写失败测试复现 8 小时偏移（db.js 核心 bug）

**Files:**
- Create: `packages/brain/src/__tests__/integration/timestamp-utc-roundtrip.pg.integration.test.js`
- Modify: `packages/brain/vitest.config.js`（注册新集成测试文件）

- [ ] **Step 1: 创建失败测试**

写 `packages/brain/src/__tests__/integration/timestamp-utc-roundtrip.pg.integration.test.js`：

```javascript
/**
 * [BEHAVIOR] timestamp without time zone 列读取必须是真实 UTC 语义（任务 19684870）。
 *
 * 根因：node-pg 的 postgres-date 解析器对不带时区后缀的 timestamp 文本，落进
 * `new Date(year, month, day, ...)` 分支——用进程本地时区（容器 TZ=Asia/Shanghai）
 * 解释这些本来就是 UTC 的裸数字，读出来的 JS Date 比真实时刻早 8 小时。
 * 这个测试直接写一个已知 UTC 时刻进 tasks.started_at，再用真实连接池读出来，
 * 断言往返不丢时区语义——不 mock，因为这个 bug 只在真实 pg 驱动解析路径上出现。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pool from '../../db.js';

const created = [];

afterAll(async () => {
  if (created.length) {
    await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [created]);
  }
  await pool.end().catch(() => {});
});

describe('tasks.started_at — timestamp without time zone 必须按 UTC 解析（任务 19684870）', () => {
  it('写入已知 UTC 时刻，真实连接池读出的 JS Date 必须与写入值一致（不偏移8小时）', async () => {
    const id = randomUUID();
    // 故意选一个"减8小时"和"不减"差异肉眼可辨的时刻
    const knownUtc = new Date('2026-06-15T10:30:00.000Z');
    await pool.query(
      `INSERT INTO tasks (id, title, task_type, status, started_at)
       VALUES ($1, $2, 'data', 'queued', $3::timestamptz)`,
      [id, `utc roundtrip test ${id}`, knownUtc.toISOString()],
    );
    created.push(id);

    const { rows: [row] } = await pool.query('SELECT started_at FROM tasks WHERE id = $1', [id]);

    expect(
      row.started_at.getTime(),
      `读出来的 started_at(${row.started_at.toISOString()}) 与写入的 UTC 时刻` +
        `(${knownUtc.toISOString()}) 必须一致——差 8 小时说明 postgres-date 解析器` +
        `又把这个 timestamp without time zone 列的裸数字当成本地时区(Asia/Shanghai)解析了`,
    ).toBe(knownUtc.getTime());
  });
});
```

- [ ] **Step 2: 注册进集成测试清单**

在 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 数组里加一行
（跟在任意一个已有条目后面，例如紧跟 `qiumi-device-busy-wait.pg.integration.test.js` 那一行）：

```javascript
  'src/__tests__/integration/timestamp-utc-roundtrip.pg.integration.test.js',
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/timestamp-utc-roundtrip.pg.integration.test.js`
Expected: FAIL——`row.started_at.getTime()` 比 `knownUtc.getTime()` 少 `8*3600*1000`（28800000）毫秒

- [ ] **Step 4: Commit（先红）**

```bash
git add packages/brain/src/__tests__/integration/timestamp-utc-roundtrip.pg.integration.test.js packages/brain/vitest.config.js
git commit -m "test(brain): 复现tasks.started_at读取偏8小时（任务19684870）

node-pg的postgres-date解析器对timestamp without time zone列按进程时区
(Asia/Shanghai)解析，而DB里存的其实是UTC裸数字，导致读出来的JS Date
比真实时刻早8小时。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 修复 db.js 全局解析器

**Files:**
- Modify: `packages/brain/src/db.js`

- [ ] **Step 1: 加 setTypeParser**

把 `packages/brain/src/db.js` 开头：

```javascript
import 'dotenv/config';
import pg from 'pg';
import { DB_DEFAULTS } from './db-config.js';

const { Pool } = pg;

const pool = new Pool(DB_DEFAULTS);
```

改为：

```javascript
import 'dotenv/config';
import pg from 'pg';
import { DB_DEFAULTS } from './db-config.js';

const { Pool } = pg;

// OID 1114 = timestamp without time zone。Postgres 对这个类型输出的文本从不带时区
// 后缀，node-pg 默认解析器（postgres-date）解析不到偏移量时会落进
// `new Date(year, month, day, ...)` 分支，用进程本地时区（容器 TZ=Asia/Shanghai）
// 解释这些数字——但生产 DB 会话时区是 UTC，这些裸数字本来就是 UTC 时刻，被当成
// 上海时间解析后读出来的 JS Date 比真实时刻早 8 小时（任务 19684870，历史事故
// 87c9a08b：任务刚启动就被判超时，根因就在这里）。显式按 UTC 解析，堵死这条误判路径。
pg.types.setTypeParser(1114, (val) => (val === null ? null : new Date(`${val.replace(' ', 'T')}Z`)));

const pool = new Pool(DB_DEFAULTS);
```

- [ ] **Step 2: 运行 Task 1 的测试确认变绿**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/timestamp-utc-roundtrip.pg.integration.test.js`
Expected: PASS

- [ ] **Step 3: 运行 db.js 已有单测确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/db.test.js`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/db.js
git commit -m "fix(brain): db.js 加全局setTypeParser，timestamp without time zone列按UTC解析（任务19684870）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: 统一 due_at 写入/读取语义（撤掉双重补偿）

**Files:**
- Modify: `packages/brain/src/notion-push-sync.js:536-540`
- Modify: `packages/brain/src/lib/qiumi-device-busy.js:24-29`
- Modify: `packages/brain/src/openclaw-agent-executor.js:388`（跟随 qiumi-device-busy.js 的导出改名/删除同步改）
- Modify: `packages/brain/src/__tests__/integration/qiumi-device-busy-wait.pg.integration.test.js:66-88`

- [ ] **Step 1: notion-push-sync.js 撤掉写入补偿**

把 `packages/brain/src/notion-push-sync.js` 第 533-540 行：

```javascript
  // due_at 只来自「预期结束时间」：它是截止（手机忙排队的等待上限读它，lib/qiumi-device-busy.js）。
  // 旧列「预期完成日期」/ 英文 Plan Date 起点现在都是开始时间，落进 due_at 会让任务一忙就判过期。
  // due_at 是 timestamp without time zone：按上海墙钟落（与 DUE_AT_SELECT_SQL 读法同口径），带 Z 的时间也不错位。
  if (endIso) {
    await pool.query(
      "UPDATE tasks SET due_at=($2::timestamptz AT TIME ZONE 'Asia/Shanghai'), updated_at=NOW() WHERE id=$1", [taskId, endIso],
    );
  }
```

替换为：

```javascript
  // due_at 只来自「预期结束时间」：它是截止（手机忙排队的等待上限读它，lib/qiumi-device-busy.js）。
  // 旧列「预期完成日期」/ 英文 Plan Date 起点现在都是开始时间，落进 due_at 会让任务一忙就判过期。
  // due_at 是 timestamp without time zone，直接存真实 UTC 时刻（任务 19684870：db.js 全局
  // setTypeParser 已经把这一类列的读取修正为按 UTC 解析，这里不再需要"故意存上海墙钟数字、
  // 靠读取 bug 纠正回来"的补偿写法——与 recurring.js:111 / decision-executor.js:507 两处
  // 本来就写真实 UTC 的路径统一语义）。
  if (endIso) {
    await pool.query(
      'UPDATE tasks SET due_at=$2::timestamptz, updated_at=NOW() WHERE id=$1', [taskId, endIso],
    );
  }
```

- [ ] **Step 2: qiumi-device-busy.js 撤掉读取补偿**

把 `packages/brain/src/lib/qiumi-device-busy.js` 第 24-29 行：

```javascript
/**
 * 收割器取 due_at 的 SQL 表达式。tasks.due_at 是 timestamp without time zone，秋米入账写的是上海墙钟
 * （notion-push-sync.js ingestQiumiPage，Notion 日期带 +08:00）；生产 PG 会话时区是 UTC，
 * 裸读交给 node-pg 按进程时区猜，换台机器就差 8 小时。这里显式按上海时间转成 timestamptz。
 */
export const DUE_AT_SELECT_SQL = "(due_at AT TIME ZONE 'Asia/Shanghai')";
```

替换为：

```javascript
/**
 * 收割器取 due_at 的 SQL 表达式。任务 19684870：db.js 全局 setTypeParser 已经把
 * timestamp without time zone 列的读取修正为按 UTC 解析（tasks.due_at 现在也统一存
 * 真实 UTC 时刻，见 notion-push-sync.js ingestQiumiPage），不再需要这层 SQL 补偿，
 * 直接读原列即可。保留这个符号名只是为了不用改所有调用点的写法。
 */
export const DUE_AT_SELECT_SQL = 'due_at';
```

（保留符号名 `DUE_AT_SELECT_SQL` 不删除、只改值，是为了不用同时改
`openclaw-agent-executor.js:388` 里 `${DUE_AT_SELECT_SQL} AS due_at` 这个用法——
这样 `AS due_at` 别名依然成立，`SELECT ... due_at AS due_at ...` 语法有效。不需要
额外修改 `openclaw-agent-executor.js`。）

- [ ] **Step 3: 改写 qiumi-device-busy-wait 集成测试**

把 `packages/brain/src/__tests__/integration/qiumi-device-busy-wait.pg.integration.test.js`
第 66-88 行：

```javascript
describe('截止时间读真列 due_at（上海墙钟 timestamp → 按 DUE_AT_SELECT_SQL 转 timestamptz）', () => {
  it('due_at 已过 → expired(due_at)；未过 → requeue；排期开始时间误落 due_at → 走 24 小时默认', async () => {
    const id = await seed();
    const now = Date.now();
    // 与收割器同一读法；写法模拟入账（带 +08:00 的字符串按上海墙钟落），与会话时区无关
    const read = async () => (await pool.query(`SELECT payload, ${DUE_AT_SELECT_SQL} AS due_at FROM tasks WHERE id = $1`, [id])).rows[0];
    const setDue = (offsetMs) => pool.query(
      "UPDATE tasks SET due_at = ($2::timestamptz AT TIME ZONE 'Asia/Shanghai') WHERE id = $1", [id, new Date(now + offsetMs).toISOString()],
    );
    await setDue(-60_000);
    let t = await read();
    expect(t.due_at).toBeInstanceOf(Date);
    expect(planDeviceBusy({ payload: t.payload, dueAt: t.due_at, marker: { owner: 'x' }, now })).toMatchObject({ action: 'expired', deadlineSource: 'due_at' });
    await setDue(2 * 3600_000);
    t = await read();
    expect(planDeviceBusy({ payload: t.payload, dueAt: t.due_at, marker: { owner: 'x' }, now })).toMatchObject({ action: 'requeue', deadlineSource: 'due_at' });
    // 生产存量形状：scheduled_start 与 due_at 同一时刻（开始时间误落 due_at）
    const start = new Date(now - 3600_000).toISOString().replace('Z', '+00:00');
    await setDue(-3600_000);
    await pool.query("UPDATE tasks SET payload = payload || jsonb_build_object('scheduled_start', $2::text) WHERE id = $1", [id, start]);
    t = await read();
    expect(planDeviceBusy({ payload: t.payload, dueAt: t.due_at, marker: { owner: 'x' }, now })).toMatchObject({ action: 'requeue', deadlineSource: 'default_24h' });
  });
});
```

替换为：

```javascript
describe('截止时间读真列 due_at（真实 UTC timestamp，任务 19684870 统一语义后）', () => {
  it('due_at 已过 → expired(due_at)；未过 → requeue；排期开始时间误落 due_at → 走 24 小时默认', async () => {
    const id = await seed();
    const now = Date.now();
    // db.js 全局 setTypeParser 已把 timestamp without time zone 列统一按 UTC 解析，
    // due_at 直接存/读真实 UTC 时刻，不再需要上海墙钟补偿写法
    const read = async () => (await pool.query(`SELECT payload, ${DUE_AT_SELECT_SQL} AS due_at FROM tasks WHERE id = $1`, [id])).rows[0];
    const setDue = (offsetMs) => pool.query(
      'UPDATE tasks SET due_at = $2::timestamptz WHERE id = $1', [id, new Date(now + offsetMs).toISOString()],
    );
    await setDue(-60_000);
    let t = await read();
    expect(t.due_at).toBeInstanceOf(Date);
    expect(planDeviceBusy({ payload: t.payload, dueAt: t.due_at, marker: { owner: 'x' }, now })).toMatchObject({ action: 'expired', deadlineSource: 'due_at' });
    await setDue(2 * 3600_000);
    t = await read();
    expect(planDeviceBusy({ payload: t.payload, dueAt: t.due_at, marker: { owner: 'x' }, now })).toMatchObject({ action: 'requeue', deadlineSource: 'due_at' });
    // 生产存量形状：scheduled_start 与 due_at 同一时刻（开始时间误落 due_at）
    const start = new Date(now - 3600_000).toISOString().replace('Z', '+00:00');
    await setDue(-3600_000);
    await pool.query("UPDATE tasks SET payload = payload || jsonb_build_object('scheduled_start', $2::text) WHERE id = $1", [id, start]);
    t = await read();
    expect(planDeviceBusy({ payload: t.payload, dueAt: t.due_at, marker: { owner: 'x' }, now })).toMatchObject({ action: 'requeue', deadlineSource: 'default_24h' });
  });
});
```

- [ ] **Step 4: 运行相关测试确认变绿**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/qiumi-device-busy-wait.pg.integration.test.js src/__tests__/integration/timestamp-utc-roundtrip.pg.integration.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/notion-push-sync.js packages/brain/src/lib/qiumi-device-busy.js packages/brain/src/__tests__/integration/qiumi-device-busy-wait.pg.integration.test.js
git commit -m "fix(brain): due_at撤掉双重时区补偿，统一存真实UTC（任务19684870）

notion-push-sync.js写入due_at时不再故意存上海墙钟数字，qiumi-device-busy.js
不再需要SQL层的AT TIME ZONE补偿——两者靠互相抵消凑出的'正确'是脆弱的，
db.js全局setTypeParser修好读取路径后，统一按真实UTC语义就是真的对。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: 修复 2 处独立的方向反了的时区转换 bug

**Files:**
- Modify: `packages/brain/src/project-compare.js:140`
- Modify: `packages/brain/src/routes/ops.js:403`

- [ ] **Step 1: project-compare.js 补 ::timestamptz**

把 `packages/brain/src/project-compare.js` 第 140 行：

```javascript
              to_char(completed_at AT TIME ZONE 'Asia/Shanghai', 'IYYY-"W"IW') AS week,
```

替换为：

```javascript
              to_char(completed_at::timestamptz AT TIME ZONE 'Asia/Shanghai', 'IYYY-"W"IW') AS week,
```

（`tasks.completed_at` 是 `timestamp without time zone`，存的是 UTC 裸数字。不先
`::timestamptz`（按当前会话时区 UTC 转出正确的绝对时刻）就直接
`AT TIME ZONE 'Asia/Shanghai'`，等于把这些 UTC 数字直接当成上海时间来转，方向反了，
按周分桶的统计会算错。）

- [ ] **Step 2: routes/ops.js 补 ::timestamptz**

把 `packages/brain/src/routes/ops.js` 第 403 行：

```javascript
      conditions.push(`(archived = false OR archived IS NULL)`);
    }

    // 日期过滤（YYYY-MM-DD，Asia/Shanghai 时区）
    if (req.query.date) {
      conditions.push(`DATE(created_at AT TIME ZONE 'Asia/Shanghai') = $${paramIdx++}`);
```

只改这一行：

```javascript
      conditions.push(`DATE(created_at::timestamptz AT TIME ZONE 'Asia/Shanghai') = $${paramIdx++}`);
```

（`learnings.created_at` 同样是 `timestamp without time zone`，同样缺了
`::timestamptz` 这一步，`?date=` 过滤在北京时间 0 点～8 点这个窗口附近会筛出错误的
一批记录。）

- [ ] **Step 3: 写回归测试（覆盖北京 0 点~8 点边界）**

先确认这两处各自有没有现成的测试文件：

Run: `cd packages/brain && find src/__tests__ -iname "*project-compare*" -o -iname "*ops-learnings*" -o -iname "*ops-route*" | grep -i "date\|compare\|ops"`

如果 `project-compare.js` 已有单测文件（比如 `src/__tests__/project-compare*.test.js`），
在里面加一个新的 `it`；`routes/ops.js` 的 `/api/brain/learnings` 路由同理找现有测试文件
（搜 `routes/ops.js` 的测试通常叫 `src/__tests__/routes-ops*.test.js` 或
`src/__tests__/ops-*.test.js`）。如果两处都没有现成的单测文件覆盖这两行代码，各自新建
一个最小的 pg 集成测试（模式参照 Task 1 的 `timestamp-utc-roundtrip.pg.integration.test.js`）：

- `project-compare.js` 用例：插入一条 `completed_at` 恰好落在 UTC `2026-06-14T20:00:00Z`
  （对应北京时间 `2026-06-15T04:00:00+08:00`，即"如果方向反了会被错误分到 6-14 那周"
  的边界值）的任务，跑查询，断言 `week` 字段对应的是北京时间 6-15 所在的那一周，不是
  UTC 6-14 所在的那一周。
- `routes/ops.js` 用例：插入一条 `created_at` 恰好落在 UTC `2026-06-14T20:00:00Z`
  的 learning 记录，请求 `GET /api/brain/learnings?date=2026-06-15`，断言这条记录
  **被**返回（因为它的北京时间确实是 6-15 凌晨4点）；再请求
  `?date=2026-06-14`，断言这条记录**不**被返回。

- [ ] **Step 4: 运行新增测试确认变绿，运行 DevGate**

Run（按 Step 3 实际新建/修改的测试文件调整路径）：
`cd packages/brain && npx vitest run <Step 3 涉及的测试文件>`
Expected: 全部 PASS

Run: `cd /Users/administrator/worktrees/cecelia-deploy-main/timestamp-8h-drift-fix && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`
Expected: 三项全过

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/project-compare.js packages/brain/src/routes/ops.js <Step3新增/修改的测试文件>
git commit -m "fix(brain): project-compare.js/routes/ops.js 补due_at类似的缺失::timestamptz转换（任务19684870）

completed_at/created_at是timestamp without time zone，直接AT TIME ZONE
'Asia/Shanghai'方向反了，先::timestamptz转出正确绝对时刻再转上海时间。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 全量验证 + bump 版本 + push + PR

**Files:**
- 无新文件（本 task 为验证/收尾）

- [ ] **Step 1: 跑 Brain 包全量测试**

Run: `cd packages/brain && npx vitest run`
Expected: 全部 PASS（无新增失败；已知的环境类失败——缺测试库/API余额不足——与本次改动无关，可忽略）

- [ ] **Step 2: bump brain 版本号（DevGate brain-version-bump-gate 要求）**

```bash
cd /Users/administrator/worktrees/cecelia-deploy-main/timestamp-8h-drift-fix
git fetch origin main --quiet
git log --oneline -1 origin/main   # 确认 main 有没有新的版本号，若有以此为准
cd packages/brain && npm version patch --no-git-tag-version
cd ..
node -e "process.stdout.write(require('./packages/brain/package.json').version)" > .brain-versions
echo "" >> .brain-versions
```

手动把新版本号同步进 `DEFINITION.md` 的 `**Brain 版本**:` 那一行（用 Edit 工具，
不要用 sed 跨行替换）。

Run: `bash scripts/check-version-sync.sh`
Expected: 全部 ✅

- [ ] **Step 3: 清理调试痕迹**

Run: `git diff main..HEAD -- packages/brain/src/db.js packages/brain/src/notion-push-sync.js packages/brain/src/lib/qiumi-device-busy.js packages/brain/src/project-compare.js packages/brain/src/routes/ops.js`
确认无 `console.log` 调试残留、无注释掉的死代码。

- [ ] **Step 4: Commit 版本 bump**

```bash
git add packages/brain/package.json packages/brain/package-lock.json package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): bump version（DevGate brain-version-bump-gate 要求）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: push 分支**

```bash
git push -u origin cp-0930182336-timestamp-8h-drift-fix
```

- [ ] **Step 6: 开 PR**

```bash
gh pr create --title "fix(brain): tasks时间列读取偏8小时，统一due_at为真实UTC语义（任务19684870）" --body "$(cat <<'EOF'
## Summary
- 根因：node-pg 的 postgres-date 解析器对 timestamp without time zone 列（DB 存的是 UTC 裸数字）按进程时区（容器 TZ=Asia/Shanghai）解析，读出来的 JS Date 比真实时刻早 8 小时。历史事故 87c9a08b（任务刚启动就被判超时）的确切根因。
- 修法：① db.js 加全局 setTypeParser 按 UTC 解析 OID 1114；② due_at 撤掉"写入时故意存上海墙钟数字、读取时靠bug纠正"的双重补偿，改为统一的真实 UTC 语义（与 recurring.js/decision-executor.js 本来就对的写法一致）；③ 顺带修 project-compare.js、routes/ops.js 两处独立的、方向反了的时区转换 bug。
- 设计文档：docs/superpowers/specs/2026-09-30-timestamp-8h-drift-design.md

## Test plan
- [x] 新增 pg 集成测试先 commit，复现 8 小时偏移（timestamp-utc-roundtrip.pg.integration.test.js）
- [x] 修复后该测试变绿
- [x] qiumi-device-busy-wait 集成测试改写为真实 UTC 语义后全绿
- [x] project-compare.js / routes/ops.js 补北京 0 点~8 点边界用例
- [x] Brain 包全量测试无新增回归
- [x] DevGate 三项校验通过
- [ ] CI 全绿
- [ ] 生产验证：部署后新派任务的 started_at 与真实时间一致（合并后复测，回写 Brain 任务 19684870）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: 记录 PR URL**

Run: `gh pr view --json url,number -q '.url + " #" + (.number|tostring)'`
