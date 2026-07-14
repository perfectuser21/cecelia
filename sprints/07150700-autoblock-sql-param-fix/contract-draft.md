# Contract Draft — Sprint 07150700-autoblock-sql-param-fix

**Task ID**: ba0a2bdc-ed83-4091-9cef-7269a95be658
**Sprint**: 07150700-autoblock-sql-param-fix
**生成时间**: 2026-07-15
**类型**: bugfix

---

## 一、问题陈述

`dispatcher.js` line 800 的 autoblock 计数 SQL 使用裸 `$2` 参数传给 `jsonb_build_object`：

```sql
UPDATE tasks
SET metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object('dispatch_fail_consecutive', $2)
WHERE id = $1
```

PostgreSQL 无法从 `jsonb_build_object` 的函数签名推断 `$2` 的类型，抛出：

```
could not determine data type of parameter $2
```

由于 catch 块将其标记为 non-fatal，程序不崩溃但计数**从不写入**，autoblock 机制形同虚设。
既有 `dispatch-fail-autoblock.test.js` 全量 mock 了 `pool.query`，导致 SQL 级 bug 完全逃逸。

---

## 二、修复方案

### 修复点 A（主修复）：line 800 加 `$2::int` 显式类型转换

```sql
-- 修复后
UPDATE tasks
SET metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object('dispatch_fail_consecutive', $2::int)
WHERE id = $1
```

选择方案 A 而非方案 B 的理由：
- 改动最小，仅加 `::int` cast，语义不变
- 传入 `newCount`（JS number）→ `int4`，完全对齐 metadata 中的整数语义
- 方案 B 需重构参数传法，增加 JSON 序列化中间层，代价更高

### 修复点 B（日志改进）：catch 块 console.error → console.warn + task_id

```js
// 修复前
console.error(`[dispatch] dispatch-fail-autoblock counter update failed (non-fatal): ${autoblockErr.message}`);

// 修复后
console.warn(`[dispatch] dispatch-fail-autoblock counter update failed (task ${nextTask.id}) (non-fatal): ${autoblockErr.message}`);
```

### 验证点 C：成功重置 SQL（line 859）已有 `$1::jsonb`，无需修改

```sql
UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2
```
JS 对象由 pg 驱动序列化后 `::jsonb` cast，类型推断无歧义——集成测试验证路径正常即可。

---

## 三、Golden Path 说明

### GP-1：计数 SQL 写入不抛类型错误（真实 pg SQL 验证）

```
arrange: 真实 pg 连接 + 测试 DB，tasks 表插入测试行（id=test_uuid, metadata={}）
act:     直接执行修复后的 UPDATE SQL，参数 [test_uuid, 1]
assert:  - 不抛 PGError（尤其不含 "could not determine data type"）
         - SELECT metadata->'dispatch_fail_consecutive' → 1
act:     再执行一次，参数 [test_uuid, 2]
assert:  - dispatch_fail_consecutive = 2
```

### GP-2：连续 3 次失败路径 → task blocked（真实 pg，不 mock SQL）

```
arrange: 真实 pg 连接，tasks 表插入 queued 状态任务
act:     直接调用 3 次 autoblock 计数 SQL + 阈值判断逻辑
         （mock executor 失败，不 mock pool.query）
assert:  - SELECT status, blocked_reason FROM tasks WHERE id=test_id
           → status='blocked', blocked_reason='dispatch_fail_autoblock'
         - metadata.dispatch_fail_consecutive 值 ≥ 3
```

### GP-3：成功重置 SQL 无类型错误（真实 pg）

```
arrange: task metadata.dispatch_fail_consecutive = 2（直接 UPDATE 设置）
act:     执行成功路径 reset SQL（$1::jsonb 参数，传 JS 对象）
assert:  - 不抛 PGError
         - dispatch_fail_consecutive = 0
```

---

## 四、E2E 验收

### E2E-1：SQL 修复直接验证

```bash
# 1. 连接 Brain 测试 DB，执行带 $2::int 的 UPDATE
# 2. 验证写入值为整数类型
psql $BRAIN_DB_URL -c "
  INSERT INTO tasks (id, title, status, task_type) 
  VALUES ('00000000-0000-0000-0000-000000000001', 'e2e-test', 'queued', 'dev')
  ON CONFLICT (id) DO NOTHING;
  
  UPDATE tasks 
  SET metadata = COALESCE(metadata, '{}'::jsonb) 
             || jsonb_build_object('dispatch_fail_consecutive', 1::int)
  WHERE id = '00000000-0000-0000-0000-000000000001';
  
  SELECT 
    (metadata->>'dispatch_fail_consecutive')::int AS count,
    pg_typeof(metadata->'dispatch_fail_consecutive') AS type
  FROM tasks 
  WHERE id = '00000000-0000-0000-0000-000000000001';
"
# 预期输出：count=1, type=jsonb（数值类型）
```

### E2E-2：修复前 SQL 对比（必须失败，证明 bug 真实存在）

```bash
# 执行未修复的 SQL（应该抛 type error）
psql $BRAIN_DB_URL -c "
  PREPARE test_bad(uuid, unknown) AS
    UPDATE tasks 
    SET metadata = COALESCE(metadata, '{}'::jsonb) 
               || jsonb_build_object('dispatch_fail_consecutive', \$2)
    WHERE id = \$1;
" 2>&1 | grep "could not determine data type"
# 预期：应打印 "could not determine data type of parameter \$2"
```

### E2E-3：集成测试套件全绿验证

```bash
# 在 brain 目录下跑新增集成测试（需真实 PG 连接）
cd /workspace/packages/brain
DATABASE_URL=postgresql://localhost/cecelia_test \
  npx vitest run sprints/07150700-autoblock-sql-param-fix/tests/autoblock-sql-integration.test.js \
  --reporter=verbose

# 预期：3 个 GP 测试全绿（GP-1/GP-2/GP-3）
```

### E2E-4：既有单元测试不退化

```bash
cd /workspace/packages/brain
npx vitest run src/__tests__/dispatch-fail-autoblock.test.js --reporter=verbose
# 预期：所有既有测试（BEHAVIOR-1 ~ BEHAVIOR-7）继续全绿
```

---

## 五、不变量（Invariants）

| # | 不变量 | 验证层 |
|---|--------|--------|
| IN-1 | 计数 SQL 执行后不抛 `could not determine data type of parameter` | GP-1 集成测试 |
| IN-2 | `metadata.dispatch_fail_consecutive` 写入值为整数类型（非字符串） | GP-1 SELECT 验证 |
| IN-3 | 连续 3 次失败必然触发 blockTask（status=blocked, reason=dispatch_fail_autoblock） | GP-2 集成测试 |
| IN-4 | catch 块保留，输出 `console.warn` 含 task_id | 代码审查 + 日志验证 |
| IN-5 | 成功重置 SQL（$1::jsonb）保持不变，执行无报错 | GP-3 集成测试 |
| IN-6 | 新集成测试不 mock `pool.query` SQL 执行层 | 代码审查 |

---

## 六、文件变更范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `packages/brain/src/dispatcher.js` | 修复 | line 800: `$2` → `$2::int`；catch 块 console.error → console.warn + task_id |
| `packages/brain/src/__tests__/autoblock-sql-integration.test.js` | 新增 | GP-1/2/3 集成测试（真实 pg，不 mock SQL） |

### 不动文件

- `packages/brain/src/__tests__/dispatch-fail-autoblock.test.js`（既有单测继续运行）
- `circuit-breaker.js`、`dispatch-helpers.js`、`task-updater.js`、`alerting.js`

---

*本合同由 Cecelia Contract Proposer 生成，对应 PRD: sprints/07150700-autoblock-sql-param-fix/sprint-prd.md*
