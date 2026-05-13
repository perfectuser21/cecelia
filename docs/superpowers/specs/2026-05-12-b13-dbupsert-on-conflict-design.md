# B13 — harness-initiative graph dbUpsert ON CONFLICT DO UPDATE

## 问题

`packages/brain/src/workflows/harness-initiative.graph.js` 第 207 行（`runOnce` 路径）+ 第 673 行（`dbUpsertNode` LangGraph 节点路径）两处独立 SQL：

```sql
INSERT INTO initiative_contracts (
  initiative_id, version, status,
  prd_content, contract_content, review_rounds,
  budget_cap_usd, timeout_sec, branch, approved_at
)
VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
RETURNING id
```

无 `ON CONFLICT` 子句。当 Brain 多次重启、LangGraph 从 PG checkpoint resume 时，该节点 retry 撞 unique 约束 `initiative_contracts_initiative_id_version_key`（migration 236:21 定义为 `UNIQUE (initiative_id, version)`），导致 graph throw → task `failed`。

W34 / W35 两次实证；Brain active decision `35150b79` 中错误信息明确为 `duplicate key value violates unique constraint "initiative_contracts_initiative_id_version_key"`。

## 设计

两处 INSERT 加 `ON CONFLICT (initiative_id, version) DO UPDATE SET ...`：

```sql
INSERT INTO initiative_contracts (
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
RETURNING id
```

**语义**：first run 走 INSERT 路径同前；restart resume 走 UPDATE 路径用最新 GAN 输出覆盖原 row。`RETURNING id` 在两种路径都返回 row id（PG 默认行为）。

**两处必须对称改**：`runOnce` 与 `dbUpsertNode` 都是 propose 节点的真实 SQL 路径，只改一处会留另一半的 hole。

## 不在范围

- 不改 `initiative_runs` INSERT（migration 没有 unique key on (initiative_id, contract_id, phase)，graph restart 不撞 PK）
- 不改 `upsertTaskPlan` 子调用（独立函数，独立改）
- 不改 schema（unique key 已存在）

## 测试策略

按 Cecelia 测试金字塔，本变更跨 PG，归 **integration 档**：

1. **Integration test** (`packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js`)：
   - vitest mock pg pool client
   - 第一次调 query INSERT 返回 `[{id: 'uuid-1'}]`，验证传入 SQL 含 `ON CONFLICT (initiative_id, version) DO UPDATE`
   - 第二次调 query INSERT 同样 SQL 也含 ON CONFLICT 子句（模拟 restart resume）
   - 验证两处 SQL 字符串（runOnce + dbUpsertNode 路径）都含 `ON CONFLICT`

2. **smoke.sh** (`packages/brain/scripts/smoke/b13-dbupsert-idempotent-smoke.sh`)：
   - 起 docker compose（postgres + brain）
   - 用真 PG 客户端跑：先插一行 `(initiative_id=test-uuid, version=1, status='approved')`
   - 再跑同 INSERT（带 ON CONFLICT），第二次必 success（不抛 duplicate key），最后 `SELECT count(*)` 必为 1
   - exit 0 即 PASS

## 风险

- **EXCLUDED.* 覆盖**：UPDATE path 用最新 GAN 输出覆盖原 row，可能丢失第一次 propose 的历史。**评估**：可接受 — graph resume 时 GAN 已重新跑过 propose/review 一轮，新内容更可信；且 review_rounds 也会被新值覆盖（应该是更大的轮数，因为重跑加了轮数）。
- **branch 列覆盖**：propose_branch 可能在 resume 时不同。**评估**：用最新 branch 是正确语义（GAN 结果对应新 branch）。

## DoD

- [BEHAVIOR] harness-initiative.graph.js 两处 INSERT 都含 `ON CONFLICT (initiative_id, version) DO UPDATE`
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/ON CONFLICT \\(initiative_id, version\\) DO UPDATE/g);if(!m||m.length<2)process.exit(1)"`
- [BEHAVIOR] integration test 验证两路径 SQL 含 ON CONFLICT
  - Test: `tests/workflows/__tests__/harness-initiative-idempotent.test.js`
- [BEHAVIOR] smoke.sh 真 PG 验证幂等
  - Test: `manual:bash packages/brain/scripts/smoke/b13-dbupsert-idempotent-smoke.sh`
