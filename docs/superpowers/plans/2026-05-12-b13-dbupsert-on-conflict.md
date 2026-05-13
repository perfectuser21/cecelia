# B13 — harness-initiative dbUpsert ON CONFLICT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `harness-initiative.graph.js` 两处 `INSERT INTO initiative_contracts` 加 `ON CONFLICT (initiative_id, version) DO UPDATE SET ...`，graph restart resume 时幂等，杜绝 W34/W35 撞 PK violation。

**Architecture:** 单文件双 SQL 变更（runOnce + dbUpsertNode 两路径必须对称），配 integration test 验证 SQL 字符串含 ON CONFLICT 子句，配 smoke.sh 真 PG 验证两次 INSERT 第二次走 UPDATE path。

**Tech Stack:** Node.js / PostgreSQL / pg / vitest / docker compose

**Spec:** `docs/superpowers/specs/2026-05-12-b13-dbupsert-on-conflict-design.md`

---

## File Structure

- **Modify**: `packages/brain/src/workflows/harness-initiative.graph.js` — 两处 INSERT 加 ON CONFLICT
- **Create**: `packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js` — integration test 验 SQL 含 ON CONFLICT
- **Create**: `packages/brain/scripts/smoke/b13-dbupsert-idempotent-smoke.sh` — 真 PG 幂等 smoke
- **Modify**: 顶层 DoD 文档（如果有）

---

### Task 1: 写 fail integration test + smoke.sh 骨架（RED commit）

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js`
- Create: `packages/brain/scripts/smoke/b13-dbupsert-idempotent-smoke.sh`

- [ ] **Step 1: 创建 integration test 文件**

```javascript
// packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('B13 harness-initiative dbUpsert 幂等', () => {
  const graphSource = readFileSync(
    resolve(__dirname, '../harness-initiative.graph.js'),
    'utf8'
  );

  it('两处 INSERT initiative_contracts 都含 ON CONFLICT (initiative_id, version) DO UPDATE', () => {
    const matches = graphSource.match(
      /ON CONFLICT \(initiative_id, version\) DO UPDATE/g
    );
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('两处 INSERT 都覆盖 contract_content 列（用 EXCLUDED.contract_content）', () => {
    const matches = graphSource.match(/contract_content = EXCLUDED\.contract_content/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('两处 INSERT 都用 approved_at = NOW() 重置时间戳', () => {
    const onConflictBlocks = graphSource.split('ON CONFLICT (initiative_id, version) DO UPDATE');
    expect(onConflictBlocks.length).toBeGreaterThanOrEqual(3); // 2 处 + split 前缀
    onConflictBlocks.slice(1).forEach((block, idx) => {
      const upToNextSemi = block.split(';')[0];
      expect(upToNextSemi).toMatch(/approved_at\s*=\s*NOW\(\)/);
    });
  });
});
```

- [ ] **Step 2: 跑测试验证 RED**

```bash
cd /Users/administrator/worktrees/cecelia/b13-dbupsert-on-conflict
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js 2>&1 | tail -20
```

Expected: FAIL — `matches` is null（源文件还没 ON CONFLICT 子句）

- [ ] **Step 3: 创建 smoke.sh 骨架**

```bash
# packages/brain/scripts/smoke/b13-dbupsert-idempotent-smoke.sh
#!/usr/bin/env bash
# B13 smoke: 真 PG 验证 initiative_contracts ON CONFLICT DO UPDATE 幂等
set -euo pipefail

# 期望由 CI / 本机环境提供 PG (host postgres:5432)
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-cecelia}"
PG_DB="${PG_DB:-cecelia}"
export PGPASSWORD="${PGPASSWORD:-cecelia}"

# 构造测试 initiative_id
TEST_ID=$(uuidgen | tr 'A-Z' 'a-z')
echo "[B13 smoke] test_initiative_id=$TEST_ID"

cleanup() {
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
    -c "DELETE FROM initiative_contracts WHERE initiative_id='$TEST_ID'::uuid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 第一次 INSERT — 应该成功
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c "
  INSERT INTO initiative_contracts (
    initiative_id, version, status, prd_content, contract_content,
    review_rounds, budget_cap_usd, timeout_sec, branch, approved_at
  )
  VALUES ('$TEST_ID'::uuid, 1, 'approved', 'prd-v1', 'contract-v1', 1, 10.0, 3600, 'branch-v1', NOW())
  ON CONFLICT (initiative_id, version) DO UPDATE SET
    status = EXCLUDED.status,
    prd_content = EXCLUDED.prd_content,
    contract_content = EXCLUDED.contract_content,
    review_rounds = EXCLUDED.review_rounds,
    budget_cap_usd = EXCLUDED.budget_cap_usd,
    timeout_sec = EXCLUDED.timeout_sec,
    branch = EXCLUDED.branch,
    approved_at = NOW()
" || { echo "[B13 smoke] first INSERT failed"; exit 1; }

# 第二次 INSERT 同 (initiative_id, version=1) — 必须走 UPDATE 不抛
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c "
  INSERT INTO initiative_contracts (
    initiative_id, version, status, prd_content, contract_content,
    review_rounds, budget_cap_usd, timeout_sec, branch, approved_at
  )
  VALUES ('$TEST_ID'::uuid, 1, 'approved', 'prd-v2', 'contract-v2', 2, 20.0, 7200, 'branch-v2', NOW())
  ON CONFLICT (initiative_id, version) DO UPDATE SET
    status = EXCLUDED.status,
    prd_content = EXCLUDED.prd_content,
    contract_content = EXCLUDED.contract_content,
    review_rounds = EXCLUDED.review_rounds,
    budget_cap_usd = EXCLUDED.budget_cap_usd,
    timeout_sec = EXCLUDED.timeout_sec,
    branch = EXCLUDED.branch,
    approved_at = NOW()
" || { echo "[B13 smoke] second INSERT (must UPDATE) failed"; exit 1; }

# 验证只有 1 行 + 内容是 v2
ROW_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT count(*) FROM initiative_contracts WHERE initiative_id='$TEST_ID'::uuid")
if [[ "$ROW_COUNT" != "1" ]]; then
  echo "[B13 smoke] expected row_count=1, got $ROW_COUNT"; exit 1
fi

CONTRACT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT contract_content FROM initiative_contracts WHERE initiative_id='$TEST_ID'::uuid")
if [[ "$CONTRACT" != "contract-v2" ]]; then
  echo "[B13 smoke] expected contract-v2, got $CONTRACT"; exit 1
fi

echo "[B13 smoke] PASS — dbUpsert ON CONFLICT 幂等验证通过"
```

- [ ] **Step 4: chmod +x smoke.sh**

```bash
chmod +x /Users/administrator/worktrees/cecelia/b13-dbupsert-on-conflict/packages/brain/scripts/smoke/b13-dbupsert-idempotent-smoke.sh
```

- [ ] **Step 5: Commit RED**

```bash
cd /Users/administrator/worktrees/cecelia/b13-dbupsert-on-conflict
git add packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js \
        packages/brain/scripts/smoke/b13-dbupsert-idempotent-smoke.sh
git commit -m "test: B13 dbUpsert ON CONFLICT 幂等测试 + smoke (RED)"
```

---

### Task 2: 改 harness-initiative.graph.js 两处 INSERT 加 ON CONFLICT（GREEN commit）

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:206-215` (runOnce path)
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:672-681` (dbUpsertNode path)

- [ ] **Step 1: 改第一处（约第 207 行）**

将 SQL 从

```javascript
const contractInsert = await client.query(
  `INSERT INTO initiative_contracts (
     initiative_id, version, status,
     prd_content, contract_content, review_rounds,
     budget_cap_usd, timeout_sec, branch, approved_at
   )
   VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
   RETURNING id`,
  [initiativeId, plannerOutput, ganResult.contract_content, ganResult.rounds, budgetUsd, timeoutSec, ganResult.propose_branch || null]
);
```

改为

```javascript
const contractInsert = await client.query(
  `INSERT INTO initiative_contracts (
     initiative_id, version, status,
     prd_content, contract_content, review_rounds,
     budget_cap_usd, timeout_sec, branch, approved_at
   )
   VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
   ON CONFLICT (initiative_id, version) DO UPDATE SET
     status = EXCLUDED.status,
     prd_content = EXCLUDED.prd_content,
     contract_content = EXCLUDED.contract_content,
     review_rounds = EXCLUDED.review_rounds,
     budget_cap_usd = EXCLUDED.budget_cap_usd,
     timeout_sec = EXCLUDED.timeout_sec,
     branch = EXCLUDED.branch,
     approved_at = NOW()
   RETURNING id`,
  [initiativeId, plannerOutput, ganResult.contract_content, ganResult.rounds, budgetUsd, timeoutSec, ganResult.propose_branch || null]
);
```

- [ ] **Step 2: 改第二处（约第 673 行 — dbUpsertNode）**

将 SQL 从

```javascript
const contractInsert = await client.query(
  `INSERT INTO initiative_contracts (
     initiative_id, version, status,
     prd_content, contract_content, review_rounds,
     budget_cap_usd, timeout_sec, branch, approved_at
   )
   VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
   RETURNING id`,
  [state.initiativeId, state.plannerOutput, state.ganResult.contract_content, state.ganResult.rounds, budgetUsd, timeoutSec, state.ganResult.propose_branch || null]
);
```

改为

```javascript
const contractInsert = await client.query(
  `INSERT INTO initiative_contracts (
     initiative_id, version, status,
     prd_content, contract_content, review_rounds,
     budget_cap_usd, timeout_sec, branch, approved_at
   )
   VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
   ON CONFLICT (initiative_id, version) DO UPDATE SET
     status = EXCLUDED.status,
     prd_content = EXCLUDED.prd_content,
     contract_content = EXCLUDED.contract_content,
     review_rounds = EXCLUDED.review_rounds,
     budget_cap_usd = EXCLUDED.budget_cap_usd,
     timeout_sec = EXCLUDED.timeout_sec,
     branch = EXCLUDED.branch,
     approved_at = NOW()
   RETURNING id`,
  [state.initiativeId, state.plannerOutput, state.ganResult.contract_content, state.ganResult.rounds, budgetUsd, timeoutSec, state.ganResult.propose_branch || null]
);
```

- [ ] **Step 3: 跑 integration test 验证 GREEN**

```bash
cd /Users/administrator/worktrees/cecelia/b13-dbupsert-on-conflict
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js 2>&1 | tail -20
```

Expected: PASS — 三个 it 都通过

- [ ] **Step 4: 跑 smoke.sh 验证真 PG 行为**

前提：localhost:5432 有 cecelia/cecelia PG（host 本机 postgres 跑着）。

```bash
cd /Users/administrator/worktrees/cecelia/b13-dbupsert-on-conflict
bash packages/brain/scripts/smoke/b13-dbupsert-idempotent-smoke.sh
```

Expected stdout 末尾 `[B13 smoke] PASS — dbUpsert ON CONFLICT 幂等验证通过`，exit 0。

- [ ] **Step 5: Commit GREEN**

```bash
cd /Users/administrator/worktrees/cecelia/b13-dbupsert-on-conflict
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(brain): harness-initiative dbUpsert ON CONFLICT DO UPDATE 幂等 (B13)

两处 INSERT initiative_contracts (runOnce + dbUpsertNode) 加 ON CONFLICT
(initiative_id, version) DO UPDATE 让 graph restart resume 幂等。

W34/W35 实证：Brain 多次重启后 graph 从 PG checkpoint resume 撞
initiative_contracts_initiative_id_version_key PK violation 致 task failed。"
```

---

### Task 3: Learning 文件 + push

**Files:**
- Create: `docs/learnings/cp-0512172439-b13-dbupsert-on-conflict.md`

- [ ] **Step 1: 写 Learning 文件**

```markdown
# Learning — B13 graph restart 不幂等致 task failed

### 根本原因

`harness-initiative.graph.js` 两处 `INSERT INTO initiative_contracts (initiative_id, version=1, ...)` 没 `ON CONFLICT` 子句。LangGraph 从 PG checkpoint resume 时该节点 retry 撞 unique `(initiative_id, version)` PK violation，graph throw → task `failed`。

第一次写时假设"每个 initiative 只 INSERT 一次"，没考虑 graph 节点 restart resume 路径必须幂等。

### 下次预防

- [ ] LangGraph 节点内的 SQL INSERT 必须幂等：要么用 `ON CONFLICT DO UPDATE`，要么用 `ON CONFLICT DO NOTHING`，要么先 SELECT 判断已存在
- [ ] 任何"checkpoint resume"路径上的 side effect 都要假设会重复执行
- [ ] 设计新 graph 节点时把 dbUpsert 当默认模式，不用裸 INSERT
- [ ] integration test 应该模拟 "调用两次同 SQL" 验证幂等，不只验首次成功
```

- [ ] **Step 2: Commit Learning**

```bash
cd /Users/administrator/worktrees/cecelia/b13-dbupsert-on-conflict
git add docs/learnings/cp-0512172439-b13-dbupsert-on-conflict.md
git commit -m "docs(learnings): B13 graph restart 不幂等致 PK violation"
```

---

## Self-Review

- **Spec coverage**：所有 DoD 都有 task 对应。BEHAVIOR ON CONFLICT 出现 ≥2 处 → Task 1 test + Task 2 修改；integration test → Task 1；smoke.sh → Task 1 + Task 2 验证。
- **Placeholder scan**：无 TBD/TODO，所有 code 完整。
- **Type consistency**：SQL 字符串两处对称，列名一致，参数 `$N` 序号一致。

## Execution

Subagent-Driven。
