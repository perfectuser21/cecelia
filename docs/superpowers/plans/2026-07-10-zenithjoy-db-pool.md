# PR-A：Brain 发布回执解耦——zenithjoy 独立连接池 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain 写 `zenithjoy.works`/`zenithjoy.publish_logs` 的路径改走可切换的独立连接池——`ZENITHJOY_DB_NAME` 未设时行为完全不变（向后兼容），设了就指向独立 zenithjoy 库（拆库刀1，决策 0710）。

**Architecture:** 新模块 `zenithjoy-db.js`（懒初始化+memoize，配置回落 `DB_DEFAULTS`）；`execution.js` 发布回执块的 3 条 `zenithjoy.*` SQL 换池（`tasks` 查询留主池）；backfill 脚本同 env 参数化。

**Tech Stack:** Node ESM / pg / vitest。

## Global Constraints

- TDD 强制：commit-1 全部测试（红）→ commit-2 实现（绿）。
- feat(brain) 触及 brain/src → 必须新增 `packages/brain/scripts/smoke/*.sh`（≥5 实行+真命令）且登记 `packages/quality/smoke-allowlist.txt`。
- brain PR 必 bump `packages/brain/package.json`（1.244.1 → 1.244.2）。
- env 命名用 Brain 惯例 `ZENITHJOY_DB_*`（对齐 db-config.js 的 `DB_*`，不用 ZJ repo 的 DATABASE_* 风格）。
- `ZENITHJOY_DB_NAME` 未设时**不得创建任何新 Pool**（返回主 pool 同一对象引用）。
- eslint 零 warning。

---

### Task 1: 失败测试（commit-1）

**Files:**
- Create: `packages/brain/src/__tests__/zenithjoy-db.test.js`

**Interfaces:**
- Produces: Task 2 必须实现的导出——`getZenithjoyPool()` / `_resetZenithjoyPoolForTest()`（`packages/brain/src/zenithjoy-db.js`）。

- [ ] **Step 1: 写测试（完整内容）**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import defaultPool from '../db.js';
import { getZenithjoyPool, _resetZenithjoyPoolForTest } from '../zenithjoy-db.js';

// 拆库刀1（决策 0710）：ZENITHJOY_DB_NAME 未设 = 行为不变（返回主 pool 同一引用）；
// 设了 = 独立 Pool 指向该库。切换前两 PR 可安全合并的向后兼容契约就在这两条断言里。
describe('zenithjoy-db: 可切换独立连接池', () => {
  const ENV_KEYS = ['ZENITHJOY_DB_NAME', 'ZENITHJOY_DB_HOST', 'ZENITHJOY_DB_PORT', 'ZENITHJOY_DB_USER', 'ZENITHJOY_DB_PASSWORD'];
  const saved = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    _resetZenithjoyPoolForTest();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    _resetZenithjoyPoolForTest();
  });

  it('env 未设 → 返回主 pool 同一对象引用（零新连接池）', () => {
    expect(getZenithjoyPool()).toBe(defaultPool);
  });

  it('ZENITHJOY_DB_NAME 已设 → 独立 Pool 指向该库，且不是主 pool', () => {
    process.env.ZENITHJOY_DB_NAME = 'zenithjoy';
    const p = getZenithjoyPool();
    expect(p).not.toBe(defaultPool);
    expect(p.options.database).toBe('zenithjoy');
  });

  it('独立 Pool memoize（两次调用同一实例）', () => {
    process.env.ZENITHJOY_DB_NAME = 'zenithjoy';
    expect(getZenithjoyPool()).toBe(getZenithjoyPool());
  });

  it('ZENITHJOY_DB_HOST/USER 覆盖生效，未覆盖项回落 DB_DEFAULTS', async () => {
    process.env.ZENITHJOY_DB_NAME = 'zenithjoy';
    process.env.ZENITHJOY_DB_HOST = 'db.example.internal';
    process.env.ZENITHJOY_DB_USER = 'zj_user';
    const { DB_DEFAULTS } = await import('../db-config.js');
    const p = getZenithjoyPool();
    expect(p.options.host).toBe('db.example.internal');
    expect(p.options.user).toBe('zj_user');
    expect(p.options.port).toBe(DB_DEFAULTS.port);
  });

  it('execution.js 发布回执块已接线新池（源码契约：zenithjoy.* SQL 不再走主 pool.query）', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../routes/execution.js', import.meta.url), 'utf8');
    expect(src).toContain("from '../zenithjoy-db.js'");
    // 发布回执块内三条 zenithjoy.* SQL 全部走 zjPool
    const block = src.slice(src.indexOf('content_publish 完成'), src.indexOf('小任务积累触发'));
    expect(block).toContain('zjPool.query');
    expect((block.match(/pool\.query\(\s*[`']INSERT INTO zenithjoy/g) || []).length).toBe(0);
    expect((block.match(/pool\.query\(\s*[`']SELECT id FROM zenithjoy/g) || []).length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/zenithjoy-db.test.js 2>&1 | tail -8`
Expected: FAIL（zenithjoy-db.js 模块不存在）。记录输出。

- [ ] **Step 3: Commit（commit-1）**

```bash
git add packages/brain/src/__tests__/zenithjoy-db.test.js
git commit -m "test(brain): zenithjoy 独立连接池契约先行——env 未设=主池引用不变/设了=独立池+execution.js 接线断言"
```

---

### Task 2: 实现（commit-2）

**Files:**
- Create: `packages/brain/src/zenithjoy-db.js`
- Modify: `packages/brain/src/routes/execution.js`（发布回执块，约 556-637 行）
- Modify: `packages/brain/scripts/backfill-publish-logs.js`（连接参数化）
- Create: `packages/brain/scripts/smoke/zenithjoy-db-pool-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`（登记 smoke）
- Modify: `packages/brain/package.json`（version 1.244.2）

- [ ] **Step 1: zenithjoy-db.js（完整内容）**

```javascript
/**
 * zenithjoy-db.js — zenithjoy 库独立连接池（拆库刀1，决策 0710 环境隔离）
 *
 * 背景：cecelia 库曾同时装着 Cecelia 生产（public/dbos）和 ZenithJoy 生产（zenithjoy schema）。
 * Brain 在 content_publish 回调里跨 schema 写 zenithjoy.works / zenithjoy.publish_logs——
 * 这是两产品唯一的运行时 DB 耦合点。拆库后该路径必须指向独立 zenithjoy 库。
 *
 * 切换协议（向后兼容）：
 *   - ZENITHJOY_DB_NAME 未设 → 返回 Brain 主 pool（行为与拆库前完全一致，本 PR 合并即安全）
 *   - ZENITHJOY_DB_NAME 已设 → 懒初始化独立 Pool；host/port/user/password 可用
 *     ZENITHJOY_DB_HOST/PORT/USER/PASSWORD 覆盖，未覆盖项回落 DB_DEFAULTS 同名配置
 *
 * ⚠️ zenithjoy.publish_logs 的表结构以 ZJ repo apps/api/db/migrations 为准；
 *    brain/migrations/277 是历史双写残留，迁库后不再作为该表定义来源。
 */
import pg from 'pg';
import defaultPool from './db.js';
import { DB_DEFAULTS } from './db-config.js';

let _zjPool = null;

export function getZenithjoyPool() {
  if (!process.env.ZENITHJOY_DB_NAME) return defaultPool;
  if (!_zjPool) {
    _zjPool = new pg.Pool({
      ...DB_DEFAULTS,
      database: process.env.ZENITHJOY_DB_NAME,
      host: process.env.ZENITHJOY_DB_HOST || DB_DEFAULTS.host,
      port: parseInt(process.env.ZENITHJOY_DB_PORT || String(DB_DEFAULTS.port), 10),
      user: process.env.ZENITHJOY_DB_USER || DB_DEFAULTS.user,
      password: process.env.ZENITHJOY_DB_PASSWORD ?? DB_DEFAULTS.password,
    });
    _zjPool.on('error', (err) => {
      console.error('[zenithjoy-db] pool error:', err.message);
    });
  }
  return _zjPool;
}

/** 测试专用：重置 memoize（vitest 各 case 间隔离） */
export function _resetZenithjoyPoolForTest() {
  _zjPool = null;
}
```

- [ ] **Step 2: execution.js 接线**

顶部 import 区加：`import { getZenithjoyPool } from '../zenithjoy-db.js';`
发布回执块（`// content_publish 完成 → 写入 zenithjoy.publish_logs` 那个 `Promise.resolve().then(async () => {` 内）：
1. 块开头 `const pubTaskRow = await pool.query(...)` **之前**加一行 `const zjPool = getZenithjoyPool();`
2. `tasks` 表查询（pubTaskRow）**保持 pool.query 不动**（tasks 在 cecelia 库）
3. 三处换池：`INSERT INTO zenithjoy.works`、`SELECT id FROM zenithjoy.publish_logs`、`INSERT INTO zenithjoy.publish_logs` 的 `pool.query` → `zjPool.query`

- [ ] **Step 3: backfill-publish-logs.js 参数化**

先读该脚本现有连接方式；将其中写 `zenithjoy.*` 的连接改为 `import { getZenithjoyPool } from '../src/zenithjoy-db.js'`（若脚本自建 Pool，则改用同一组 `ZENITHJOY_DB_*` env 回落逻辑，保持脚本可独立运行）。改动最小化，读 `tasks` 等 cecelia 表的连接不动。

- [ ] **Step 4: smoke 脚本（完整内容）**

`packages/brain/scripts/smoke/zenithjoy-db-pool-smoke.sh`：

```bash
#!/usr/bin/env bash
# Smoke: zenithjoy-db 可切换连接池（拆库刀1，决策 0710）
# 真加载 ESM 模块验证切换契约：env 未设=主池引用；设了=独立池指向目标库。
set -euo pipefail

echo "[zj-db-pool-smoke] 1. env 未设 → 返回主 pool 同一引用（向后兼容）"
node --input-type=module -e "
import defaultPool from './packages/brain/src/db.js';
import { getZenithjoyPool } from './packages/brain/src/zenithjoy-db.js';
if (getZenithjoyPool() !== defaultPool) { console.error('FAIL: 未设 env 应返回主池引用'); process.exit(1); }
console.log('主池引用 ✓');
"

echo "[zj-db-pool-smoke] 2. ZENITHJOY_DB_NAME 设置 → 独立池指向该库"
ZENITHJOY_DB_NAME=zenithjoy_smoke_probe node --input-type=module -e "
import defaultPool from './packages/brain/src/db.js';
import { getZenithjoyPool } from './packages/brain/src/zenithjoy-db.js';
const p = getZenithjoyPool();
if (p === defaultPool) { console.error('FAIL: 设了 env 不应返回主池'); process.exit(1); }
if (p.options.database !== 'zenithjoy_smoke_probe') { console.error('FAIL: database=' + p.options.database); process.exit(1); }
console.log('独立池 database=zenithjoy_smoke_probe ✓');
"

echo "[zj-db-pool-smoke] 3. execution.js 发布回执块已接线（源码契约）"
node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
if (!src.includes(\"from '../zenithjoy-db.js'\")) { console.error('FAIL: execution.js 未 import zenithjoy-db'); process.exit(1); }
const block = src.slice(src.indexOf('content_publish 完成'), src.indexOf('小任务积累触发'));
if (!block.includes('zjPool.query')) { console.error('FAIL: 发布回执块未用 zjPool'); process.exit(1); }
console.log('execution.js 接线 ✓');
"

echo "[zj-db-pool-smoke] ✅ 全部通过"
```

`chmod +x` 后，`packages/quality/smoke-allowlist.txt` 按字母序附近插入一行 `zenithjoy-db-pool-smoke.sh`。

- [ ] **Step 5: bump 版本**

`packages/brain/package.json` version `1.244.1` → `1.244.2`。

- [ ] **Step 6: 验证绿**

Run: `cd packages/brain && npx vitest run src/__tests__/zenithjoy-db.test.js 2>&1 | tail -6 && npm run lint 2>&1 | tail -2 && cd ../.. && bash packages/brain/scripts/smoke/zenithjoy-db-pool-smoke.sh`
Expected: 5 tests 全 PASS；lint 无输出；smoke 三步 ✓。

- [ ] **Step 7: Commit（commit-2）**

```bash
git add packages/brain/src/zenithjoy-db.js packages/brain/src/routes/execution.js packages/brain/scripts/backfill-publish-logs.js packages/brain/scripts/smoke/zenithjoy-db-pool-smoke.sh packages/quality/smoke-allowlist.txt packages/brain/package.json
git commit -m "feat(brain): 发布回执解耦——zenithjoy 独立连接池（ZENITHJOY_DB_* 切换,未设=行为不变）拆库刀1,bump 1.244.2"
```
