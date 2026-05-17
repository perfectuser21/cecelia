# fix-progress-ledger-unique-constraint 设计文档

> 写于 2026-05-05

## Goal

修复两个独立但相关的问题：
1. `progress_ledger` 表缺少 UNIQUE 约束 → ON CONFLICT 每次报错，步骤记录永远写不进去
2. 6 个僵尸任务占满所有 slot → dispatch 冻结

## 背景

`packages/brain/migrations/088_progress_ledger.sql` 建了 `progress_ledger` 表，但漏掉了 `UNIQUE(task_id, run_id, step_sequence)` 约束。`progress-ledger.js:84` 使用 `ON CONFLICT (task_id, run_id, step_sequence) DO UPDATE`，PostgreSQL 要求对应 UNIQUE 约束必须存在，否则报错。该错误被 `callback-processor.js:239` 的 catch 块捕获（不 re-throw），所以任务状态 UPDATE 仍能正常 COMMIT，但 progress_ledger 步骤记录永远写失败。

6 个僵尸任务根因：执行超时/容器崩溃后无回调，被 `autoFailTimedOutTasks` 反复触发 quarantine → 释放 → 重新 dispatch 的死锁循环，导致 taskPool 6/6 满，`dispatchAllowed=false`。

## 架构

### Part A：force-release 僵尸任务（不进 migration）

用 Brain PATCH API 将 6 个 in_progress 任务强制标记为 `failed`，防止 quarantine 循环继续。这是一次性运维操作，不应放进 migration 文件（migration 要幂等，不能改任务状态）。

僵尸任务 UUID：
- c7907f00-0065-4ccf-8594-32a872a61876
- d317f033-1a06-4b93-b12f-51c0acca5189
- 013d3d13-76a0-457c-985f-aec82a11378f
- e850eedf-ee2a-46e5-8a3a-d9774f6bd3a8
- 16aa148b-f465-4f23-b5ce-9074c2afb7e0
- eac7e7fe-1038-453c-a5b0-bd3300712d8e

### Part B：migration 263 — 补 UNIQUE 约束

```sql
DO $$ BEGIN
    ALTER TABLE progress_ledger
        ADD CONSTRAINT uk_progress_ledger_step
        UNIQUE (task_id, run_id, step_sequence);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

幂等设计：重复跑 migration 不报错。

## 文件

- 新建：`packages/brain/migrations/263_fix_progress_ledger_unique.sql`
- 新建：`packages/brain/src/__tests__/progress-ledger-constraint.test.js`
- 不改：`callback-processor.js`（catch 块行为不变，但 ON CONFLICT 现在能正常工作了）
- 不改：`progress-ledger.js`（ON CONFLICT 语句本身是正确的）

## 测试策略

**E2E test**：不适用（无跨进程/持久化行为边界需要 E2E 覆盖）

**Integration test**（需真实 DB，放 `src/__tests__/integration/`）：
- 验证 `pg_catalog.pg_constraint` 中存在 `uk_progress_ledger_step`
- 验证插入相同 (task_id, run_id, step_sequence) 时触发 DO UPDATE（不报错，ON CONFLICT 正常工作）

**Unit test**：不适用（约束验证需真实 DB，无法 mock）

**Trivial wrapper**：不适用

## 成功标准

```bash
# [BEHAVIOR] UNIQUE 约束存在
node -e "const {Pool}=require('pg');const p=new Pool({connectionString:'postgresql://cecelia:cecelia@localhost:5432/cecelia'});p.query(\"SELECT COUNT(*)::int cnt FROM pg_constraint WHERE conname='uk_progress_ledger_step'\").then(r=>{if(r.rows[0].cnt===0)process.exit(1);console.log('constraint OK');p.end();}).catch(e=>{console.error(e.message);process.exit(1);})"

# [BEHAVIOR] slot 已释放（dispatch 不冻结）
node -e "const h=require('http');h.get('http://localhost:5221/api/brain/tick/status',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);const avail=j.slot_budget?.taskPool?.available??-1;if(avail<=0){console.error('slots still full:',avail);process.exit(1);}console.log('slots available:',avail);});})"
```
