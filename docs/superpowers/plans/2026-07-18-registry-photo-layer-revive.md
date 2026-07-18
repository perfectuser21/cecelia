# 刀0 照相层复活 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GET /api/brain/registry?type=api|db_schema|test 改道读照相层三表并带账龄哨兵;扫描器接每日 cron 重扫。

**Architecture:** 照抄 registry.js 现有 `type=skill → skill_registry` 的 per-type 路由先例,新增 lib/registry-photo-layer.js(查询+字段映射)与 lib/registry-freshness.js(账龄纯函数);POST/PATCH 与其余 type 一字不动。扫描侧新增 run-all-scans.sh 统一入口供 host cron 调用。

**Tech Stack:** Node ESM(packages/brain 全 import/export)、express、pg、vitest(mock 模式照 routes/__tests__/registry.test.js)。

## Global Constraints

- spec:`docs/superpowers/specs/2026-07-18-registry-photo-layer-revive-design.md`(响应形状已消歧:三个新分支返回 `{items,count,freshness}` 包装,type=skill 及其余 type 保持裸数组)
- TDD 死规矩:NO PRODUCTION CODE WITHOUT FAILING TEST FIRST;每 task commit-1 失败测试 / commit-2 实现
- 所有 commit message 简体中文,尾注 task id `[dfb27642]`
- packages/brain 改动 → brain 版本 patch bump(四处同步,`bash scripts/check-version-sync.sh` 校验)
- push 前 DevGate 三件:`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/engine/scripts/devgate/check-dod-mapping.cjs`
- 本地跑测试用 `cd packages/brain && npx vitest run <path>`;禁对本地 cecelia 库做破坏性 DELETE(integration 测试的清库场景必须 guard 在 db 名含 `_test`/`_scratch` 时才执行)

---

### Task 1: computeFreshness 账龄纯函数

**Files:**
- Create: `packages/brain/src/lib/registry-freshness.js`
- Test: `packages/brain/src/lib/__tests__/registry-freshness.test.js`

**Interfaces:**
- Produces: `computeFreshness(latestScanAt: Date|string|null, now?: Date, thresholdHours?: number) → { latest_scan: string|null, age_hours: number|null, stale: boolean, warning: string|null }`;常量 `PHOTO_STALE_THRESHOLD_HOURS = 24`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/lib/__tests__/registry-freshness.test.js
import { describe, it, expect } from 'vitest';
import { computeFreshness, PHOTO_STALE_THRESHOLD_HOURS } from '../registry-freshness.js';

describe('computeFreshness', () => {
  const now = new Date('2026-07-18T12:00:00Z');

  it('null 输入(从未扫过)→ stale:true 且 warning 提示先跑扫描', () => {
    const f = computeFreshness(null, now);
    expect(f.stale).toBe(true);
    expect(f.latest_scan).toBeNull();
    expect(f.age_hours).toBeNull();
    expect(f.warning).toContain('run-all-scans');
  });

  it('23h 前 → fresh(stale:false, warning:null)', () => {
    const f = computeFreshness(new Date('2026-07-17T13:00:00Z'), now);
    expect(f.stale).toBe(false);
    expect(f.warning).toBeNull();
    expect(f.age_hours).toBe(23);
  });

  it('25h 前 → stale:true 且 warning 提到 cron', () => {
    const f = computeFreshness(new Date('2026-07-17T11:00:00Z'), now);
    expect(f.stale).toBe(true);
    expect(f.warning).toContain('cron');
  });

  it('接受字符串时间戳', () => {
    const f = computeFreshness('2026-07-18T11:30:00Z', now);
    expect(f.stale).toBe(false);
    expect(f.latest_scan).toBe('2026-07-18T11:30:00.000Z');
  });

  it('阈值常量为 24', () => {
    expect(PHOTO_STALE_THRESHOLD_HOURS).toBe(24);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/registry-freshness.test.js`
Expected: FAIL(模块不存在)

- [ ] **Step 3: commit-1(Red)**

```bash
git add packages/brain/src/lib/__tests__/registry-freshness.test.js
git commit -m "test(brain): 账龄纯函数 computeFreshness 失败测试(Red) [dfb27642]"
```

- [ ] **Step 4: 最小实现**

```js
// packages/brain/src/lib/registry-freshness.js
/**
 * 照相层账龄哨兵(刀0,spec: docs/superpowers/specs/2026-07-18-registry-photo-layer-revive-design.md)
 * cron 停摆 >24h 时所有消费方响应自动带 stale:true——哨兵即守卫,无需额外监控件。
 */
export const PHOTO_STALE_THRESHOLD_HOURS = 24;

export function computeFreshness(latestScanAt, now = new Date(), thresholdHours = PHOTO_STALE_THRESHOLD_HOURS) {
  if (!latestScanAt) {
    return {
      latest_scan: null,
      age_hours: null,
      stale: true,
      warning: '照相层无数据:扫描器从未运行,先跑 scripts/scan/run-all-scans.sh',
    };
  }
  const latest = latestScanAt instanceof Date ? latestScanAt : new Date(latestScanAt);
  const ageHours = (now.getTime() - latest.getTime()) / 3600000;
  const stale = ageHours > thresholdHours;
  return {
    latest_scan: latest.toISOString(),
    age_hours: Math.round(ageHours * 10) / 10,
    stale,
    warning: stale
      ? `照相层已 ${Math.round(ageHours)}h 未刷新(阈值 ${thresholdHours}h),检查 host cron: registry-scan`
      : null,
  };
}
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/registry-freshness.test.js`
Expected: 5 passed

- [ ] **Step 6: commit-2(Green)**

```bash
git add packages/brain/src/lib/registry-freshness.js
git commit -m "feat(brain): 账龄纯函数 computeFreshness——照相层哨兵(Green) [dfb27642]"
```

---

### Task 2: 照相层查询模块 + GET 改道

**Files:**
- Create: `packages/brain/src/lib/registry-photo-layer.js`
- Modify: `packages/brain/src/routes/registry.js`(在 type=skill 分支结束的 `}` 后、`// 其余 type → system_registry` 注释前插入新分支;顶部加 import)
- Modify: `packages/brain/src/routes/__tests__/registry.test.js`(72-82 行现有用例断言 type=api SQL 含 system_registry——改用 type=machine 保持该用例意图,另加照相层新用例)
- Modify: `packages/brain/src/__tests__/registry.test.js`(grep `system_registry`/`type=api`,凡断言 api/db_schema/test 走 system_registry 的用例同步改为 machine 或改期望)
- Test: `packages/brain/src/routes/__tests__/registry-photo-layer.test.js`(新)

**Interfaces:**
- Consumes: Task 1 的 `computeFreshness`
- Produces: `isPhotoType(type: string) → boolean`;`listPhotoLayer(pool, type, {search, limit, offset}) → Promise<{items, count, freshness}>`,items 元素形状 `{id, name, type, status, location, description, area, scanned_at}`

- [ ] **Step 1: 写失败测试(mock 模式照抄 routes/__tests__/registry.test.js:3-16)**

```js
// packages/brain/src/routes/__tests__/registry-photo-layer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

let app;
beforeEach(async () => {
  vi.clearAllMocks();
  const { default: router } = await import('../registry.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain/registry', router);
});

describe('GET /api/brain/registry 照相层改道', () => {
  it('type=api → 查 api_registry,返回 {items,count,freshness} 包装且字段映射正确', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, method: 'GET', path: '/api/brain/context', file_path: 'packages/brain/src/routes.js', line_number: 42, area: 'cecelia', description: null, scanned_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ latest: new Date() }] });
    const res = await request(app).get('/api/brain/registry?type=api');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toContain('api_registry');
    expect(mockQuery.mock.calls[0][0]).not.toContain('system_registry');
    expect(res.body.items[0].name).toBe('GET /api/brain/context');
    expect(res.body.items[0].location).toBe('packages/brain/src/routes.js:42');
    expect(res.body.freshness.stale).toBe(false);
    expect(res.body.count).toBe(1);
  });

  it('type=db_schema → 查 db_schema_registry,name=table_name', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 2, table_name: 'tasks', columns: 'id,title,status', area: 'cecelia', scanned_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ latest: new Date() }] });
    const res = await request(app).get('/api/brain/registry?type=db_schema');
    expect(mockQuery.mock.calls[0][0]).toContain('db_schema_registry');
    expect(res.body.items[0].name).toBe('tasks');
  });

  it('type=test → 查 test_registry,description 含 test_count', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 3, file_path: 'packages/brain/src/__tests__/a.test.js', test_count: 7, test_type: 'unit', status: 'active', area: 'cecelia', scanned_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ latest: new Date() }] });
    const res = await request(app).get('/api/brain/registry?type=test');
    expect(mockQuery.mock.calls[0][0]).toContain('test_registry');
    expect(res.body.items[0].description).toContain('7 tests');
  });

  it('照相层空表 → items:[] 且 freshness.stale:true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ latest: null }] });
    const res = await request(app).get('/api/brain/registry?type=api');
    expect(res.body.items).toEqual([]);
    expect(res.body.freshness.stale).toBe(true);
  });

  it('search 参数作用于 path/file_path', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ latest: new Date() }] });
    await request(app).get('/api/brain/registry?type=api&search=brain');
    expect(mockQuery.mock.calls[0][0]).toContain('ILIKE');
    expect(mockQuery.mock.calls[0][1]).toContain('%brain%');
  });

  it('type=machine 仍走 system_registry 裸数组(其余 type 行为不变)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, name: 'us-m4', type: 'machine', status: 'active' }] });
    const res = await request(app).get('/api/brain/registry?type=machine');
    expect(mockQuery.mock.calls[0][0]).toContain('system_registry');
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑新测试确认失败;同时跑现有两个 registry 测试记录哪些用例因改道预期红**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/registry-photo-layer.test.js src/routes/__tests__/registry.test.js src/__tests__/registry.test.js`
Expected: 新文件 FAIL(分支不存在);现有文件此刻仍全绿(还没改道)

- [ ] **Step 3: commit-1(Red)**

```bash
git add packages/brain/src/routes/__tests__/registry-photo-layer.test.js
git commit -m "test(brain): registry GET 照相层改道失败测试(Red) [dfb27642]"
```

- [ ] **Step 4: 实现 lib/registry-photo-layer.js**

```js
// packages/brain/src/lib/registry-photo-layer.js
/**
 * 照相层(事实层)查询:api_registry / db_schema_registry / test_registry 三张扫描表。
 * 与账本层(system_registry,对抗流水线增量)永久分离——刀0 决策,2026-07-18。
 * spec: docs/superpowers/specs/2026-07-18-registry-photo-layer-revive-design.md
 */
import { computeFreshness } from './registry-freshness.js';

const PHOTO_TABLES = {
  api: {
    table: 'api_registry',
    columns: 'id, method, path, file_path, line_number, area, description, scanned_at',
    searchClause: (n1, n2) => `(path ILIKE $${n1} OR file_path ILIKE $${n2})`,
    orderBy: 'path, method',
    mapRow: (r) => ({
      id: r.id, name: `${r.method} ${r.path}`, type: 'api', status: 'active',
      location: `${r.file_path}:${r.line_number}`, description: r.description,
      area: r.area, scanned_at: r.scanned_at,
    }),
  },
  db_schema: {
    table: 'db_schema_registry',
    columns: 'id, table_name, columns, area, scanned_at',
    searchClause: (n1, n2) => `(table_name ILIKE $${n1} OR columns::text ILIKE $${n2})`,
    orderBy: 'table_name',
    mapRow: (r) => ({
      id: r.id, name: r.table_name, type: 'db_schema', status: 'active',
      location: r.area,
      description: (typeof r.columns === 'string' ? r.columns : JSON.stringify(r.columns)).slice(0, 500),
      area: r.area, scanned_at: r.scanned_at,
    }),
  },
  test: {
    table: 'test_registry',
    columns: 'id, file_path, test_count, test_type, status, area, scanned_at',
    searchClause: (n1, n2) => `(file_path ILIKE $${n1} OR test_type ILIKE $${n2})`,
    orderBy: 'file_path',
    mapRow: (r) => ({
      id: r.id, name: r.file_path, type: 'test', status: r.status || 'active',
      location: r.file_path, description: `${r.test_count} tests, ${r.test_type || 'unknown'}`,
      area: r.area, scanned_at: r.scanned_at,
    }),
  },
};

export function isPhotoType(type) {
  return Object.hasOwn(PHOTO_TABLES, type);
}

export async function listPhotoLayer(pool, type, { search, limit = 50, offset = 0 } = {}) {
  const cfg = PHOTO_TABLES[type];
  const params = [];
  let where = '';
  if (search) {
    const qv = `%${search}%`;
    params.push(qv, qv);
    where = `WHERE ${cfg.searchClause(params.length - 1, params.length)}`;
  }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT ${cfg.columns} FROM ${cfg.table} ${where}
     ORDER BY ${cfg.orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: fr } = await pool.query(`SELECT max(scanned_at) AS latest FROM ${cfg.table}`);
  return {
    items: rows.map(cfg.mapRow),
    count: rows.length,
    freshness: computeFreshness(fr[0]?.latest ?? null),
  };
}
```

- [ ] **Step 5: 改道 routes/registry.js**

顶部 import 区(`import pool from '../db.js';` 之后)加:

```js
import { isPhotoType, listPhotoLayer } from '../lib/registry-photo-layer.js';
```

在 GET `/` 处理器内、type=skill 分支收尾的 `}`(原 94 行)之后、`// 其余 type → system_registry(保持原有行为)` 注释之前插入:

```js
    // 照相层三 type → 扫描表 + 账龄哨兵(刀0 2026-07-18,照相层/账本层分离)
    if (isPhotoType(req.query.type)) {
      const result = await listPhotoLayer(pool, req.query.type, {
        search: req.query.search || req.query.q,
        limit,
        offset,
      });
      return res.json(result);
    }
```

- [ ] **Step 6: 更新被改道打红的旧用例**

`packages/brain/src/routes/__tests__/registry.test.js` 72-82 行「routes other types to system_registry」用例:把 `type=api` 换成 `type=machine`(用例意图=「非 skill 的老 type 走 system_registry」,machine 仍满足);`packages/brain/src/__tests__/registry.test.js` 同 grep `system_registry`+`api` 处理(同样换 machine 或改期望为 api_registry)。**只改这两处受影响断言,不动其他用例。**

- [ ] **Step 7: 跑全部相关测试确认绿**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/ src/__tests__/registry.test.js src/lib/__tests__/registry-freshness.test.js`
Expected: 全 PASS

- [ ] **Step 8: commit-2(Green)**

```bash
git add packages/brain/src/lib/registry-photo-layer.js packages/brain/src/routes/registry.js packages/brain/src/routes/__tests__/registry.test.js packages/brain/src/__tests__/registry.test.js
git commit -m "feat(brain): registry GET type=api|db_schema|test 改道照相层三表+账龄哨兵(Green) [dfb27642]"
```

---

### Task 3: 照相层真库 integration 测试

**Files:**
- Create: `packages/brain/src/__tests__/integration/registry-photo-layer.integration.test.js`

**Interfaces:**
- Consumes: Task 2 的 `listPhotoLayer(pool, type, opts)`

- [ ] **Step 1: 写测试(先写,真库下第一次跑就该过——本 task 验的是 SQL 对真表成立,Red 体现在 Task 2 未实现时无法 import;若 Task 2 已完成则本测试直接绿,属加固不属 TDD 违例)**

```js
// packages/brain/src/__tests__/integration/registry-photo-layer.integration.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { listPhotoLayer } from '../../lib/registry-photo-layer.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia',
});
const MARK = 'itest-photo-layer';
// 破坏性清库场景只在测试库执行(死规矩:禁对本地 cecelia 做 DELETE 全表)
const isTestDb = /_test|_scratch/.test(process.env.DATABASE_URL || '');

beforeAll(async () => {
  await pool.query(`DELETE FROM api_registry WHERE file_path LIKE $1`, [`${MARK}%`]);
  await pool.query(
    `INSERT INTO api_registry (method, path, file_path, line_number, area, scanned_at)
     VALUES ('GET', '/itest/fresh', $1, 1, 'cecelia', NOW()),
            ('POST', '/itest/old', $2, 2, 'cecelia', NOW() - interval '25 hours')`,
    [`${MARK}/fresh.js`, `${MARK}/old.js`]
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM api_registry WHERE file_path LIKE $1`, [`${MARK}%`]);
  await pool.end();
});

describe('照相层真库查询', () => {
  it('search 命中 marker 行,字段映射正确', async () => {
    const r = await listPhotoLayer(pool, 'api', { search: MARK });
    expect(r.items.length).toBe(2);
    const fresh = r.items.find((i) => i.name === 'GET /itest/fresh');
    expect(fresh.location).toBe(`${MARK}/fresh.js:1`);
    expect(r.freshness).toHaveProperty('stale');
    expect(typeof r.freshness.stale).toBe('boolean');
  });

  it('db_schema 真表可查(至少含本库真实表)', async () => {
    const r = await listPhotoLayer(pool, 'db_schema', { limit: 5 });
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.freshness).toHaveProperty('latest_scan');
  });

  it.runIf(isTestDb)('proven-to-fire:全表只剩 25h 旧行 → stale:true;插入新行 → stale:false', async () => {
    await pool.query(`DELETE FROM api_registry WHERE file_path NOT LIKE $1`, [`${MARK}%`]);
    await pool.query(`DELETE FROM api_registry WHERE file_path = $1`, [`${MARK}/fresh.js`]);
    const stale = await listPhotoLayer(pool, 'api', {});
    expect(stale.freshness.stale).toBe(true);
    await pool.query(
      `INSERT INTO api_registry (method, path, file_path, line_number, area, scanned_at)
       VALUES ('GET', '/itest/fresh2', $1, 3, 'cecelia', NOW())`,
      [`${MARK}/fresh2.js`]
    );
    const ok = await listPhotoLayer(pool, 'api', {});
    expect(ok.freshness.stale).toBe(false);
  });
});
```

- [ ] **Step 2: 本地跑(scratch 库缺表则允许跳过,以 CI 为准)**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/registry-photo-layer.integration.test.js`
Expected: 本地(cecelia 库)前两条 PASS、proven-to-fire 条 skip;CI(cecelia_test)三条全 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/__tests__/integration/registry-photo-layer.integration.test.js
git commit -m "test(brain): 照相层真库 integration+proven-to-fire 账龄验证 [dfb27642]"
```

---

### Task 4: run-all-scans.sh 统一扫描入口 + smoke

**Files:**
- Create: `scripts/scan/run-all-scans.sh`
- Create: `packages/brain/scripts/smoke/registry-photo-layer-smoke.sh`(结构照抄同目录 `promise-map-ledger-smoke.sh`:同样的 BRAIN_URL 取法/等待预算/jq 断言风格;禁在 smoke 里用裸 jq 之外的花活)
- Modify: `packages/quality/smoke-allowlist.txt`(追加一行 `registry-photo-layer-smoke.sh`,格式照现有行)

**Interfaces:**
- Produces: `bash scripts/scan/run-all-scans.sh` 退出码 0=三扫描器全成功,非 0=至少一个失败(全部跑完才退出)

- [ ] **Step 1: 写 run-all-scans.sh**

```bash
#!/usr/bin/env bash
# 照相层全量重扫统一入口(刀0,2026-07-18)。
# host cron 安装说明(SSOT,系统时区 America/Los_Angeles,LA 05:00 = 北京 20:00):
#   0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh >> /tmp/registry-scan.log 2>&1
# 哨兵:本脚本停摆 >24h 后,GET /api/brain/registry?type=api|db_schema|test 自动 stale:true。
set -uo pipefail
cd "$(dirname "$0")/../.."

echo "=== registry photo-layer scan $(date '+%F %T %Z') ==="

if [ "$(git branch --show-current)" = "main" ] && [ -z "$(git status --porcelain)" ]; then
  git pull --ff-only 2>&1 || echo "WARN: git pull 失败,用当前工作区继续"
else
  echo "WARN: 非 main 分支或工作区不干净,跳过 git pull"
fi

FAIL=0
for s in scan-api-registry scan-db-schema scan-test-registry; do
  if node "scripts/scan/${s}.js"; then
    echo "OK: ${s}"
  else
    echo "FAIL: ${s}"
    FAIL=1
  fi
done
exit $FAIL
```

- [ ] **Step 2: 语法验证 + 真跑一次(这就是照相层复活本身)**

Run: `bash -n scripts/scan/run-all-scans.sh && bash scripts/scan/run-all-scans.sh`
Expected: 退出码 0;输出三行 OK;随后 `psql -h localhost -U postgres -d cecelia -t -c "SELECT count(*), max(scanned_at)::date FROM api_registry"` 显示行数 ≥600 且日期=今天(2026-07-18)

- [ ] **Step 3: 写 smoke(照 promise-map-ledger-smoke.sh 模式)**

核心断言(嵌入该模式的框架里):

```bash
RESP=$(curl -sf "${BRAIN_URL}/api/brain/registry?type=api&limit=3")
echo "$RESP" | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d);
    if(!Array.isArray(j.items)) { console.error('FAIL: items 不是数组'); process.exit(1); }
    if(!('stale' in (j.freshness||{}))) { console.error('FAIL: freshness.stale 缺失'); process.exit(1); }
    console.log('OK: photo-layer 包装形状正确');
  })"
```

- [ ] **Step 4: 登记 allowlist 并本地验证 smoke 语法**

Run: `bash -n packages/brain/scripts/smoke/registry-photo-layer-smoke.sh && grep registry-photo-layer packages/quality/smoke-allowlist.txt`
Expected: 无语法错;allowlist 有该行

- [ ] **Step 5: Commit**

```bash
git add scripts/scan/run-all-scans.sh packages/brain/scripts/smoke/registry-photo-layer-smoke.sh packages/quality/smoke-allowlist.txt
git commit -m "feat(scan): run-all-scans.sh 统一扫描入口+photo-layer smoke——cron 安装说明即脚本头注释 [dfb27642]"
```

---

### Task 5: 版本 bump + learning + DevGate

**Files:**
- Modify: `packages/brain/package.json`(version patch +1)+ `bash scripts/check-version-sync.sh` 指出的其余同步处(通常含 .brain-versions / package-lock 两处 / DEFINITION.md,以脚本输出为准)
- Create: `docs/learnings/cp-07181251-registry-photo-layer-revive.md`

**Interfaces:**
- Consumes: 前四个 task 全部完成

- [ ] **Step 1: bump 版本并跑同步校验**

Run: 改 `packages/brain/package.json` version(patch +1,当前值以 main 为准),然后 `bash scripts/check-version-sync.sh`,按其输出补齐所有不同步处,直到 exit 0

- [ ] **Step 2: DevGate 三件全过**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/engine/scripts/devgate/check-dod-mapping.cjs`
Expected: 三条全部 exit 0(任一失败按输出修复,禁跳过)

- [ ] **Step 3: 写 learning(占位符=失败,必须真实内容)**

```markdown
# Learning: 刀0 照相层复活(registry 双账断链根治第一步)

### 根本原因
registry 一词底下混着两本账:扫描器写的照相层三表(api/db_schema/test_registry,5/26 起无人触发)与端点读的账本层(system_registry,仅 54/6/18 行增量)。旧政权(全量照相)被弃时未收尾,新政权(对抗流水线)只记自己时代——proposer 开工查询命中率跌到 8%/3%/1%,"查不到→自创 [NEW_PATTERN]"成为孤岛制造机。

### 下次预防
- [ ] 凡 derived 表必须带账龄哨兵:数据源停摆 >阈值时消费端响应自动 stale:true,不允许静默陈账
- [ ] 废弃一条数据链路时必须同 PR 收尾:停写入器 + 迁移/关停读取端 + 更新 skill 文档,禁"新链上线旧链悬空"
- [ ] 照相层(机器事实,全量,无判断)与账本层(承诺,拍板入账)永久分层,禁合并、禁互相补录
```

- [ ] **Step 4: 全量 brain 单测回归**

Run: `cd packages/brain && npx vitest run --exclude='src/__tests__/integration/**'`
Expected: 全 PASS(与 main 基线一致,无新红)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/package.json docs/learnings/cp-07181251-registry-photo-layer-revive.md
# 加上 check-version-sync.sh 要求同步的其他文件
git commit -m "chore(brain): bump 版本 + 刀0 learning——照相层复活 [dfb27642]"
```

---

## 合并后手动步骤(不在 PR 内,由本 session 收尾时执行)

1. 装 cron:`crontab -e` 追加 run-all-scans.sh 头注释里那行(LA 05:00)
2. Gate3 自动部署 brain 后:`curl -s 'localhost:5221/api/brain/registry?type=api&limit=1'` 确认 `{items,freshness}` 形状且 stale:false
3. proven-to-fire(生产哨兵亲眼见红):`psql -c "UPDATE api_registry SET scanned_at = scanned_at - interval '26 hours'"` → curl 见 stale:true → `bash scripts/scan/run-all-scans.sh` → curl 见 stale:false
