# fix-progress-ledger-unique-constraint 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补 `progress_ledger` 表的 UNIQUE 约束（让 ON CONFLICT 正常工作），同时强制释放 6 个死锁僵尸任务解冻 dispatch。

**Architecture:** 两个独立操作：(1) migration 263 给 `progress_ledger` 加 UNIQUE 约束 + selfcheck 版本更新；(2) 通过 Brain PATCH API 一次性强制释放 6 个僵尸任务。Integration test 验证约束存在。

**Tech Stack:** Node.js, PostgreSQL, vitest, supertest（Brain API 调用）

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `packages/brain/migrations/263_fix_progress_ledger_unique.sql` | 补 UNIQUE 约束 |
| 新建 | `packages/brain/src/__tests__/integration/progress-ledger-constraint.integration.test.js` | 验证约束存在 + ON CONFLICT 正常工作 |
| 修改 | `packages/brain/src/selfcheck.js` | EXPECTED_SCHEMA_VERSION '262' → '263' |
| 新建 | `docs/learnings/cp-0505181305-fix-progress-ledger-unique-constraint.md` | 学习记录 |

---

## Task 1: 写失败的 integration test（TDD commit-1）

**Files:**
- Create: `packages/brain/src/__tests__/integration/progress-ledger-constraint.integration.test.js`

- [ ] **Step 1: 写测试文件**

```js
/**
 * progress-ledger UNIQUE 约束集成测试
 *
 * 验证：
 *   1. migration 263 后 uk_progress_ledger_step 约束存在
 *   2. 相同 (task_id, run_id, step_sequence) 插入两次 → DO UPDATE（不报错）
 *
 * 运行环境：需真实 PostgreSQL（cecelia_test），在 brain-integration CI job 跑。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const pool = new pg.Pool(DB_DEFAULTS);

afterAll(() => pool.end());

describe('progress_ledger UNIQUE 约束', () => {
  it('uk_progress_ledger_step 约束存在于 pg_catalog', async () => {
    const res = await pool.query(`
      SELECT COUNT(*)::int AS cnt
      FROM pg_constraint
      WHERE conname = 'uk_progress_ledger_step'
    `);
    expect(res.rows[0].cnt).toBe(1);
  });

  it('相同 (task_id, run_id, step_sequence) 插入两次 → ON CONFLICT DO UPDATE 不报错', async () => {
    const taskId = '00000000-0000-0000-0000-000000000263';
    const runId  = '00000000-0000-0000-0000-000000000001';

    // 清理：确保干净状态
    await pool.query('DELETE FROM progress_ledger WHERE task_id = $1', [taskId]);

    const upsert = () => pool.query(`
      INSERT INTO progress_ledger (
        task_id, run_id, step_sequence, step_name, step_type, status
      )
      VALUES ($1, $2, 1, 'test_step', 'execution', 'completed')
      ON CONFLICT (task_id, run_id, step_sequence)
      DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
      RETURNING id
    `, [taskId, runId]);

    // 第一次插入
    const r1 = await upsert();
    expect(r1.rows).toHaveLength(1);

    // 第二次插入相同 key → 应触发 DO UPDATE，不报错
    const r2 = await upsert();
    expect(r2.rows).toHaveLength(1);
    expect(r2.rows[0].id).toBe(r1.rows[0].id); // 同一行被更新

    // 清理
    await pool.query('DELETE FROM progress_ledger WHERE task_id = $1', [taskId]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/fix-progress-ledger-unique-constraint
DB_NAME=cecelia_test npx vitest run packages/brain/src/__tests__/integration/progress-ledger-constraint.integration.test.js --reporter=verbose 2>&1
```

预期：**FAIL** — `uk_progress_ledger_step 约束存在于 pg_catalog` 报 `expect(0).toBe(1)`

- [ ] **Step 3: commit-1（只含失败测试）**

```bash
git add packages/brain/src/__tests__/integration/progress-ledger-constraint.integration.test.js
git commit -m "test(brain): progress-ledger UNIQUE 约束 integration test（failing）(cp-0505181305)"
```

---

## Task 2: 实现 migration 263 + selfcheck 版本更新（TDD commit-2）

**Files:**
- Create: `packages/brain/migrations/263_fix_progress_ledger_unique.sql`
- Modify: `packages/brain/src/selfcheck.js`

- [ ] **Step 1: 创建 migration 263**

创建文件 `packages/brain/migrations/263_fix_progress_ledger_unique.sql`：

```sql
-- Migration 263: fix progress_ledger missing UNIQUE constraint
-- 背景：088_progress_ledger.sql 建表时漏掉 UNIQUE(task_id, run_id, step_sequence)，
-- 导致 progress-ledger.js 里的 ON CONFLICT 子句每次都报
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"。
-- 该错误被 callback-processor.js catch 块吞掉，progress_ledger 步骤记录永远写不进去。
-- Spec: docs/superpowers/specs/2026-05-05-fix-progress-ledger-unique-constraint-design.md

DO $$ BEGIN
    ALTER TABLE progress_ledger
        ADD CONSTRAINT uk_progress_ledger_step
        UNIQUE (task_id, run_id, step_sequence);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

- [ ] **Step 2: 更新 selfcheck.js 的 EXPECTED_SCHEMA_VERSION**

打开 `packages/brain/src/selfcheck.js`，找到：

```js
export const EXPECTED_SCHEMA_VERSION = '262';
```

改为：

```js
export const EXPECTED_SCHEMA_VERSION = '263';
```

- [ ] **Step 3: 在本地 cecelia_test DB 跑 migration**

```bash
cd /Users/administrator/worktrees/cecelia/fix-progress-ledger-unique-constraint
DB_NAME=cecelia_test node packages/brain/src/migrate.js 2>&1
```

预期输出含：`[migrate] running migration 263_fix_progress_ledger_unique.sql`

- [ ] **Step 4: 运行测试，确认通过**

```bash
DB_NAME=cecelia_test npx vitest run packages/brain/src/__tests__/integration/progress-ledger-constraint.integration.test.js --reporter=verbose 2>&1
```

预期：**PASS** — 2 个测试全绿

- [ ] **Step 5: commit-2（migration + selfcheck）**

```bash
git add packages/brain/migrations/263_fix_progress_ledger_unique.sql
git add packages/brain/src/selfcheck.js
git commit -m "fix(brain): migration 263 — progress_ledger 补 UNIQUE 约束 + selfcheck 版本更新 (cp-0505181305)"
```

---

## Task 3: 强制释放 6 个僵尸 in_progress 任务

**Files:** 无代码文件（运维操作，通过 Brain API 执行）

- [ ] **Step 1: 批量 PATCH 6 个僵尸任务为 failed**

依次执行（Brain 必须在运行：`curl localhost:5221/api/brain/tick/status`）：

```bash
for TASK_ID in \
  c7907f00-0065-4ccf-8594-32a872a61876 \
  d317f033-1a06-4b93-b12f-51c0acca5189 \
  013d3d13-76a0-457c-985f-aec82a11378f \
  e850eedf-ee2a-46e5-8a3a-d9774f6bd3a8 \
  16aa148b-f465-4f23-b5ce-9074c2afb7e0 \
  eac7e7fe-1038-453c-a5b0-bd3300712d8e
do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PATCH "localhost:5221/api/brain/tasks/${TASK_ID}" \
    -H "Content-Type: application/json" \
    -d '{"status":"failed","result":{"reason":"zombie_force_released","released_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}')
  echo "${TASK_ID}: HTTP ${STATUS}"
done
```

预期：6 行 `HTTP 200`

- [ ] **Step 2: 验证 slot 已释放**

```bash
curl -s localhost:5221/api/brain/tick/status | python3 -c "
import sys,json
d=json.load(sys.stdin)
sb=d.get('slot_budget',{})
tp=sb.get('taskPool',{})
print(f\"taskPool: used={tp.get('used')} available={tp.get('available')} dispatchAllowed={d.get('dispatchAllowed')}\")
"
```

预期：`used < 6`，`available > 0`，`dispatchAllowed=True`

- [ ] **Step 3: commit-3（记录本次释放操作）**

```bash
git commit --allow-empty -m "fix(brain): 强制释放 6 个僵尸 in_progress 任务解冻 dispatch (cp-0505181305)

释放的任务 ID：
  c7907f00 [Insight修复] failure_type 分类路由
  d317f033 [Insight修复] 诊断-行动断裂
  013d3d13 [SelfDrive] Accelerate WeChat Mini Program
  e850eedf [SelfDrive] RCA & Fix success rate 29%
  16aa148b [P1] account3 auth 失败 285 次
  eac7e7fe Auto-Fix PROBE_FAIL_SELF_DRIVE_HEALTH
"
```

---

## Task 4: 写 Learning 文档并最终提交

**Files:**
- Create: `docs/learnings/cp-0505181305-fix-progress-ledger-unique-constraint.md`

- [ ] **Step 1: 写 Learning 文件**

创建 `docs/learnings/cp-0505181305-fix-progress-ledger-unique-constraint.md`：

```markdown
# fix-progress-ledger-unique-constraint Learning（2026-05-05）

## 任务

修复 `progress_ledger` 表缺失 UNIQUE 约束，释放 6 个僵尸 in_progress 任务。

### 根本原因

`088_progress_ledger.sql` 建表时漏掉了 `UNIQUE(task_id, run_id, step_sequence)` 约束。
`progress-ledger.js:84` 使用 `ON CONFLICT (task_id, run_id, step_sequence) DO UPDATE`，
PostgreSQL 要求对应 UNIQUE 约束必须存在，否则报错：
`ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`

该错误被 `callback-processor.js:239` 的 catch 块捕获（有 console.error 但不 re-throw），
所以 progress_ledger 步骤记录永远写失败，但任务状态 UPDATE 仍正常 COMMIT。

6 个僵尸任务的根因是：执行超时/容器崩溃后无回调，被 `autoFailTimedOutTasks` 反复触发
quarantine → 释放 → 重新 dispatch 的死锁循环，导致 taskPool 6/6 满，dispatch 冻结。

### 下次预防

- [ ] 新建 migration 含 ON CONFLICT 子句时，必须同时建对应的 UNIQUE/PRIMARY KEY 约束
- [ ] Integration test 模板：验证 migration 跑完后约束存在（pg_catalog.pg_constraint）
- [ ] 写 migration 时用 DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$ 确保幂等
- [ ] 僵尸任务应由 autoFailTimedOutTasks 自动清理；如 3 天以上仍 in_progress，需人工干预
```

- [ ] **Step 2: 提交 Learning 文件**

```bash
git add docs/learnings/cp-0505181305-fix-progress-ledger-unique-constraint.md
git commit -m "docs(learning): progress_ledger UNIQUE 约束缺失 + 僵尸任务根因 RCA (cp-0505181305)"
```

- [ ] **Step 3: 确认 DoD**

```bash
# [BEHAVIOR] UNIQUE 约束存在
node -e "const {Pool}=require('pg');const p=new Pool({host:'localhost',port:5432,database:'cecelia',user:'cecelia',password:'cecelia'});p.query(\"SELECT COUNT(*)::int cnt FROM pg_constraint WHERE conname='uk_progress_ledger_step'\").then(r=>{if(r.rows[0].cnt===0){console.error('FAIL: constraint missing');p.end();process.exit(1);}console.log('OK: constraint exists');p.end();}).catch(e=>{console.error(e.message);process.exit(1);})"

# [BEHAVIOR] slot 可用（zombie 已释放）
node -e "const h=require('http');h.get('http://localhost:5221/api/brain/tick/status',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);const avail=j.slot_budget?.taskPool?.available??-1;if(avail<=0){console.error('FAIL: slots still full:',avail);process.exit(1);}console.log('OK: slots available:',avail);});});"
```

两条命令预期都输出 `OK`。
