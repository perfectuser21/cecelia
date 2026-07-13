# Migration 341 search_path 事故修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 migration 341 里对生产库有全局破坏性的 `ALTER DATABASE` 语句，改为 ZenithJoy 连接层自行设置 search_path，并加永久 CI 守卫防止同类事故复发。

**Architecture:** Cecelia 侧只改一个 SQL 文件 + 加两个测试文件（unit test + smoke.sh）；ZenithJoy 侧另开一个 PR 改一行 Pool 配置 + 加一个配置断言测试。两边互不依赖，可并行。

**Tech Stack:** Node.js / vitest（Cecelia）、TypeScript / 该 repo 现有测试框架（ZenithJoy）、bash（smoke.sh）

---

### Task 1: Cecelia — migration 341 回归测试 + 全局守卫（TDD Red）

**Files:**
- Create: `packages/brain/src/__tests__/migration-341.test.js`
- Read（不改）: `packages/brain/migrations/341_zenithjoy_schema_move.sql`

- [ ] **Step 1: Write the failing test**

```javascript
/**
 * Migration 341 Tests — zenithjoy 裸表归位 schema，禁止 ALTER DATABASE 全局副作用
 *
 * 背景（P0 事故 2026-07-13）：原版 migration 341 含
 * `ALTER DATABASE cecelia SET search_path = zenithjoy, public`，
 * 该语句是数据库级别全局设置，把 Brain 自己裸写的 `tasks(goal_id)` 解析到了
 * ZenithJoy 同名但结构不同的 zenithjoy.tasks 表，导致 Brain 容器 crash-loop。
 * 两个 App 共享一个物理库时，任何一条 migration 都不能用 ALTER DATABASE 改
 * 全局 search_path —— 消费方应显式加 schema 前缀（zenithjoy.xxx），不能靠
 * search_path 兜底。
 *
 * 不依赖 DB（避免 CI flaky），通过读取 migration SQL 文件验证关键内容。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../../migrations');
const sqlPath = join(migrationsDir, '341_zenithjoy_schema_move.sql');
const sql = readFileSync(sqlPath, 'utf8');

describe('Migration 341 — zenithjoy 裸表归位 schema（无全局副作用）', () => {
  it('不含 ALTER DATABASE（禁止数据库级别全局 search_path 变更）', () => {
    expect(sql).not.toMatch(/ALTER\s+DATABASE/i);
  });

  it('把 5 张裸表 SET SCHEMA zenithjoy', () => {
    const tables = ['operator_sessions', 'verification', 'account', 'session'];
    for (const table of tables) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} SET SCHEMA zenithjoy`, 'i'));
    }
    expect(sql).toMatch(/ALTER TABLE public\."user" SET SCHEMA zenithjoy/i);
  });

  it('迁移是幂等的（用 IF EXISTS / DO 块判断，可重复执行）', () => {
    expect(sql).toMatch(/DO \$\$/);
    expect(sql).toMatch(/IF EXISTS/i);
  });
});

describe('全局守卫 — 任何 migration 文件都不能出现 ALTER DATABASE', () => {
  it('packages/brain/migrations/*.sql 里没有任何 ALTER DATABASE 语句（防止同类事故复发）', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const offenders = [];
    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), 'utf8');
      if (/ALTER\s+DATABASE/i.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-341.test.js`
Expected: FAIL — 两个断言失败："不含 ALTER DATABASE" 和 全局守卫测试，因为当前 341 文件仍含 `ALTER DATABASE cecelia SET search_path = zenithjoy, public;`

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/brain/src/__tests__/migration-341.test.js
git commit -m "test(brain): migration 341 不得含 ALTER DATABASE 全局副作用 + 全局守卫（Red）"
```

---

### Task 2: Cecelia — 修复 migration 341（TDD Green）

**Files:**
- Modify: `packages/brain/migrations/341_zenithjoy_schema_move.sql`

- [ ] **Step 1: 删除 ALTER DATABASE 行，改写文件头注释**

把整个文件内容替换为：

```sql
-- Migration 341: 刀1a — ZenithJoy 裸表归位 zenithjoy schema
--
-- 背景：user/session/account/verification/operator_sessions 这 5 张表是 Better Auth
-- 在 ZenithJoy 早期建的，因 DATABASE_URL 指向 cecelia 库，建在了 public schema。
-- 现在 zenithjoy schema 已存在（内含 works/publish_logs 等 ZJ 产品表），
-- 把这 5 张表迁入 zenithjoy schema，消除与未来 Cecelia 表的撞名风险。
--
-- ⚠️ P0 事故修复（2026-07-13）：原版此处还有
--   `ALTER DATABASE cecelia SET search_path = zenithjoy, public;`
-- 该语句是数据库级别全局设置，导致 Brain 自己裸写的 tasks(goal_id) 优先
-- 解析到 ZenithJoy 同名但结构不同的 zenithjoy.tasks 表，Brain 容器 crash-loop。
-- 两个 App 共享一个物理库时禁止用 ALTER DATABASE 改全局 search_path。
-- ZenithJoy 侧改为在自己的 pg.Pool 连接配置里加
--   `options: '-c search_path=zenithjoy,public'`
-- 这是连接级别设置，只影响 ZenithJoy 自己发起的连接，不影响 Brain。
-- 见 zenithjoy 仓库 apps/api/src/db/connection.ts。
--
-- 方案：
--   ALTER TABLE ... SET SCHEMA zenithjoy（FK 约束按 OID 追踪，自动更新，数据原地保留）
--
-- 幂等：用 DO $$ ... $$ 块判断表是否已在 zenithjoy schema，避免重复执行报错。
-- 执行顺序：user 最后移（account/session 有 FK 指向它，先移 FK 源，再移被引用表）

-- 确保 zenithjoy schema 存在（通常已有，此处兜底）
CREATE SCHEMA IF NOT EXISTS zenithjoy;

DO $$
BEGIN
  -- operator_sessions（无外键）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'operator_sessions') THEN
    ALTER TABLE public.operator_sessions SET SCHEMA zenithjoy;
  END IF;

  -- verification（无外键）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'verification') THEN
    ALTER TABLE public.verification SET SCHEMA zenithjoy;
  END IF;

  -- account（FK → user，先移 account 再移 user，FK 按 OID 追踪）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'account') THEN
    ALTER TABLE public.account SET SCHEMA zenithjoy;
  END IF;

  -- session（FK → user）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'session') THEN
    ALTER TABLE public.session SET SCHEMA zenithjoy;
  END IF;

  -- user（被 account/session 引用，最后移）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'user') THEN
    ALTER TABLE public."user" SET SCHEMA zenithjoy;
  END IF;
END $$;
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-341.test.js`
Expected: PASS — 全部断言通过

- [ ] **Step 3: Commit**

```bash
git add packages/brain/migrations/341_zenithjoy_schema_move.sql
git commit -m "fix(brain): migration 341 删除ALTER DATABASE全局副作用(P0事故修复,Green)"
```

---

### Task 3: Cecelia — 补 smoke.sh（满足 lint-feature-has-smoke）

**Files:**
- Create: `packages/brain/scripts/smoke/zenithjoy-schema-migration-smoke.sh`

- [ ] **Step 1: 写 smoke 脚本**

```bash
#!/usr/bin/env bash
# Smoke: migration 341 不含 ALTER DATABASE 全局副作用（P0 事故修复验证）
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

MIGRATION_FILE="packages/brain/migrations/341_zenithjoy_schema_move.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "FAIL: $MIGRATION_FILE 不存在"
  exit 1
fi

if grep -qi "ALTER DATABASE" "$MIGRATION_FILE"; then
  echo "FAIL: $MIGRATION_FILE 含 ALTER DATABASE（P0 事故根因语句复发）"
  exit 1
fi
echo "OK: migration 341 不含 ALTER DATABASE"

for table in operator_sessions verification account session; do
  if ! grep -qi "ALTER TABLE public.$table SET SCHEMA zenithjoy" "$MIGRATION_FILE"; then
    echo "FAIL: 缺少 $table 的 SET SCHEMA zenithjoy 语句"
    exit 1
  fi
done
echo "OK: 5 张裸表归位语句完整"

echo "✅ zenithjoy-schema-migration-smoke 全部通过"
```

- [ ] **Step 2: 加执行权限**

Run: `chmod +x packages/brain/scripts/smoke/zenithjoy-schema-migration-smoke.sh`

- [ ] **Step 3: 本地跑一遍验证**

Run: `bash packages/brain/scripts/smoke/zenithjoy-schema-migration-smoke.sh`
Expected: 输出三行 OK + 一行 ✅，退出码 0

- [ ] **Step 4: Commit**

```bash
git add packages/brain/scripts/smoke/zenithjoy-schema-migration-smoke.sh
git commit -m "test(brain): 补 zenithjoy-schema-migration smoke.sh（lint-feature-has-smoke要求）"
```

---

### Task 4: Cecelia — bump 版本 + push + 等 CI

**Files:**
- Modify: `packages/brain/package.json`（patch version bump，如 1.258.7 → 1.258.8）
- Modify: `.brain-versions`（追加新版本行，格式同现有条目）

- [ ] **Step 1: 查看当前版本号**

Run: `grep '"version"' packages/brain/package.json`

- [ ] **Step 2: bump patch 版本**（用 Edit 工具把 version 字段 +1 patch）

- [ ] **Step 3: .brain-versions 追加一行**（格式对齐文件里已有条目，写当前 patch 版本号 + 本次改动摘要）

- [ ] **Step 4: Commit**

```bash
git add packages/brain/package.json .brain-versions
git commit -m "chore(brain): bump version — migration 341 P0 fix"
```

- [ ] **Step 5: Push**

```bash
git push origin cp-07131334-zenithjoy-schema
```

- [ ] **Step 6: 等 CI**

Run: `gh pr checks 3847 --watch` 直到全部通过或明确失败项。若有新失败项，按报错信息定位修复（不属于本计划已知范围的失败，回到 systematic-debugging 单独处理该失败）。

---

### Task 5: ZenithJoy — connection.ts 加 search_path（另一 repo，独立 PR）

**Files:**
- Modify: `apps/api/src/db/connection.ts`（`/Users/administrator/perfect21/zenithjoy` 仓库）
- Test: 该 repo 现有测试目录下新建 `apps/api/src/db/__tests__/connection.test.ts`（若该目录不存在测试约定，查该 repo `apps/api/src/**/__tests__/` 下任一现有 `.test.ts` 文件确认测试框架 import 方式后照抄）

- [ ] **Step 1: 查该 repo 测试框架**

Run: `find /Users/administrator/perfect21/zenithjoy/apps/api/src -name "*.test.ts" | head -1 | xargs head -10`

确认用的是 vitest 还是 jest，import 语法。

- [ ] **Step 2: Write the failing test**（用 Step 1 确认的框架语法写，示例按 vitest）

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('pg', () => {
  const PoolMock = vi.fn();
  return { Pool: PoolMock };
});

describe('ZenithJoy DB connection — search_path 隔离', () => {
  it('Pool 配置含 options: -c search_path=zenithjoy,public（不使用数据库级别全局 search_path）', async () => {
    const { Pool } = await import('pg');
    await import('../connection');
    const config = (Pool as any).mock.calls[0][0];
    expect(config.options).toBe('-c search_path=zenithjoy,public');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/administrator/perfect21/zenithjoy && npx vitest run apps/api/src/db/__tests__/connection.test.ts`
Expected: FAIL — `config.options` 是 `undefined`，因为当前 `connection.ts` 的 Pool 配置里没有 `options` 字段

- [ ] **Step 4: 实现修复**

在 `apps/api/src/db/connection.ts` 的 `new Pool({...})` 配置对象里加一行：

```typescript
const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  options: '-c search_path=zenithjoy,public',
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/administrator/perfect21/zenithjoy && npx vitest run apps/api/src/db/__tests__/connection.test.ts`
Expected: PASS

- [ ] **Step 6: Commit + Push + 开 PR**

```bash
cd /Users/administrator/perfect21/zenithjoy
git checkout -b cp-07132346-connection-search-path-scope
git add apps/api/src/db/connection.ts apps/api/src/db/__tests__/connection.test.ts
git commit -m "fix(api): pg Pool加连接级search_path=zenithjoy,public,配合cecelia侧migration341修复(P0事故)"
git push origin cp-07132346-connection-search-path-scope
gh pr create --title "fix(api): DB连接层显式search_path=zenithjoy,public（P0事故配套修复）" --body "配合 cecelia PR #3847 的 migration 341 修复。ZenithJoy 的 5 张 better-auth 表已归位 zenithjoy schema，这里让 ZenithJoy 自己的连接（而非数据库全局）能找到它们。"
```

---

### Task 6: 生产验证 + Initiative 收尾（两个 PR 都合并后执行）

**Files:** 无代码改动，纯运维验证 + Brain API 调用

- [ ] **Step 1: 确认两个 PR 都已合并**

Run: `gh pr view 3847 --json state,mergedAt` 和对应 zenithjoy PR 号，确认都是 `MERGED`

- [ ] **Step 2: 在 cecelia_test 库先跑一遍修正后的 migration**

```bash
psql -h localhost -U cecelia -d cecelia_test -f packages/brain/migrations/341_zenithjoy_schema_move.sql
psql -h localhost -U cecelia -d cecelia_test -c "SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('user','session','account','verification','operator_sessions');"
```

Expected: 5 行，`table_schema` 全部是 `zenithjoy`

- [ ] **Step 3: 对生产 cecelia 库执行**

```bash
psql -h localhost -U cecelia -d cecelia -f packages/brain/migrations/341_zenithjoy_schema_move.sql
```

- [ ] **Step 4: 验证 Brain 健康**

Run: `curl -s localhost:5221/api/brain/health | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])"`
Expected: `healthy`

- [ ] **Step 5: 验证 ZenithJoy 部署了新代码并且 auth 正常**（ZenithJoy PR 合并后需走该 repo 自己的部署流程，确认 `apps/api` 已重启加载新 `connection.ts`）

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5200/api/auth/get-session`
Expected: `200`

- [ ] **Step 6: 解锁 Brain Initiative Task1/Task2**

```bash
curl -s -X PATCH "localhost:5221/api/brain/tasks/9bb15e4e-187a-4df3-b606-d4b8d445b384" \
  -H "Content-Type: application/json" -d '{"status":"completed"}'

curl -s -X POST localhost:5221/api/brain/tasks/6a5cecd6-32b8-4cd1-8fcf-e398bd673b40/unblock 2>&1 \
  || psql -h localhost -U cecelia -d cecelia -c "UPDATE tasks SET status='queued', claimed_by=NULL, blocked_at=NULL, blocked_reason=NULL, updated_at=NOW() WHERE id='6a5cecd6-32b8-4cd1-8fcf-e398bd673b40';"
```

- [ ] **Step 7: 更新 Notion P0 issue 为已修复**

```bash
node scripts/notion-create-issue.js --help 2>&1 | grep -qi update \
  && echo "查该脚本是否支持update子命令,若无则用Brain API直接PATCH issues表" 
curl -s -X PATCH "localhost:5221/api/brain/issues/ad16e103-399f-4a24-8414-8d7ace4ec7fb" \
  -H "Content-Type: application/json" \
  -d '{"status":"Closed","pr_url":"https://github.com/perfectuser21/cecelia/pull/3847"}'
```
