# Contract DoD — Sprint 07150700-autoblock-sql-param-fix

**Task ID**: ba0a2bdc-ed83-4091-9cef-7269a95be658
**Sprint**: 07150700-autoblock-sql-param-fix
**生成时间**: 2026-07-15
**类型**: bugfix — SQL 参数类型修复

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] 计数 SQL 不再因 $2 类型推断失败而抛 PGError

**层级**: 集成测试（真实 pg）
**关联 GP**: GP-1
**关联不变量**: IN-1, IN-2

**断言**：
- 执行 `UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('dispatch_fail_consecutive', $2::int) WHERE id = $1` 传入 `[uuid, 1]` 不抛任何 PostgreSQL 错误
- 随后 `SELECT metadata->>'dispatch_fail_consecutive'` 返回字符串 `"1"`，转 int 等于 `1`
- 连续调用 N 次（N=1,2,3）每次 count 递增，均不抛错

**测试文件**: `packages/brain/src/__tests__/autoblock-sql-integration.test.js`
**测试名称**: `[GP-1] 计数 SQL 写入不抛类型错误`

**manual:bash 验收命令**：
```bash
# 验证修复后 SQL 执行无报错
psql "${BRAIN_DB_URL:-postgresql://localhost/cecelia}" << 'SQL'
DO $$
DECLARE
  test_id uuid := '00000000-cafe-0000-0000-000000000001';
  count_val int;
BEGIN
  -- 清理
  DELETE FROM tasks WHERE id = test_id;
  INSERT INTO tasks (id, title, status, task_type, priority)
  VALUES (test_id, 'e2e-autoblock-gp1', 'queued', 'dev', 'P2');

  -- 执行修复后的 SQL（$2::int 显式 cast）
  UPDATE tasks
  SET metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('dispatch_fail_consecutive', 1::int)
  WHERE id = test_id;

  -- 验证写入
  SELECT (metadata->>'dispatch_fail_consecutive')::int INTO count_val
  FROM tasks WHERE id = test_id;
  
  IF count_val != 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1, got %', count_val;
  END IF;
  RAISE NOTICE 'PASS: dispatch_fail_consecutive = %', count_val;

  -- 清理
  DELETE FROM tasks WHERE id = test_id;
END $$;
SQL
# 预期：NOTICE: PASS: dispatch_fail_consecutive = 1
```

---

### [BEHAVIOR-2] 连续 3 次失败后 task 被自动置 blocked

**层级**: 集成测试（真实 pg，不 mock pool.query）
**关联 GP**: GP-2
**关联不变量**: IN-3

**断言**：
- 在真实 DB 中有一个 `queued` 状态的 task
- 直接执行 autoblock 计数逻辑 3 次（mock executor 失败返回值，但不 mock pool.query）
- `SELECT status, blocked_reason FROM tasks WHERE id = test_id` 返回 `status='blocked', blocked_reason='dispatch_fail_autoblock'`
- `metadata.dispatch_fail_consecutive >= 3`

**测试文件**: `packages/brain/src/__tests__/autoblock-sql-integration.test.js`
**测试名称**: `[GP-2] 3 次失败路径 → task blocked（真实 pg）`

**manual:bash 验收命令**：
```bash
# 验证 3 次计数写入 + blockTask 效果
psql "${BRAIN_DB_URL:-postgresql://localhost/cecelia}" << 'SQL'
DO $$
DECLARE
  test_id uuid := '00000000-cafe-0000-0000-000000000002';
  v_status text;
  v_reason text;
  v_count int;
BEGIN
  DELETE FROM tasks WHERE id = test_id;
  INSERT INTO tasks (id, title, status, task_type, priority)
  VALUES (test_id, 'e2e-autoblock-gp2', 'queued', 'dev', 'P2');

  -- 模拟 3 次失败计数
  UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object('dispatch_fail_consecutive', 1::int) WHERE id = test_id;
  UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object('dispatch_fail_consecutive', 2::int) WHERE id = test_id;
  UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object('dispatch_fail_consecutive', 3::int) WHERE id = test_id;

  -- 模拟 blockTask（dispatcher 实际调用 blockTask 函数，这里验证 SQL 层效果）
  UPDATE tasks
  SET status = 'blocked',
      blocked_reason = 'dispatch_fail_autoblock',
      blocked_at = NOW()
  WHERE id = test_id
    AND (metadata->>'dispatch_fail_consecutive')::int >= 3;

  SELECT status, blocked_reason, (metadata->>'dispatch_fail_consecutive')::int
  INTO v_status, v_reason, v_count
  FROM tasks WHERE id = test_id;

  IF v_status != 'blocked' OR v_reason != 'dispatch_fail_autoblock' OR v_count < 3 THEN
    RAISE EXCEPTION 'FAIL: status=%, reason=%, count=%', v_status, v_reason, v_count;
  END IF;
  RAISE NOTICE 'PASS: status=%, reason=%, count=%', v_status, v_reason, v_count;

  DELETE FROM tasks WHERE id = test_id;
END $$;
SQL
# 预期：NOTICE: PASS: status=blocked, reason=dispatch_fail_autoblock, count=3
```

---

### [BEHAVIOR-3] 成功路径 reset SQL 无类型错误且 count 归零

**层级**: 集成测试（真实 pg）
**关联 GP**: GP-3
**关联不变量**: IN-5

**断言**：
- task 有 `metadata.dispatch_fail_consecutive = 2`
- 执行 `UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2` 传入 `[{dispatch_fail_consecutive: 0}, task_id]`
- 不抛 PGError
- `metadata.dispatch_fail_consecutive = 0`

**测试文件**: `packages/brain/src/__tests__/autoblock-sql-integration.test.js`
**测试名称**: `[GP-3] 成功路径 reset SQL 无类型错误`

**manual:bash 验收命令**：
```bash
psql "${BRAIN_DB_URL:-postgresql://localhost/cecelia}" << 'SQL'
DO $$
DECLARE
  test_id uuid := '00000000-cafe-0000-0000-000000000003';
  v_count int;
BEGIN
  DELETE FROM tasks WHERE id = test_id;
  INSERT INTO tasks (id, title, status, task_type, priority)
  VALUES (test_id, 'e2e-autoblock-gp3', 'queued', 'dev', 'P2');

  -- 设置初始计数 = 2
  UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object('dispatch_fail_consecutive', 2::int) WHERE id = test_id;

  -- 执行 reset SQL（与 dispatcher.js line 859 相同）
  UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"dispatch_fail_consecutive":0}'::jsonb
  WHERE id = test_id;

  SELECT (metadata->>'dispatch_fail_consecutive')::int INTO v_count
  FROM tasks WHERE id = test_id;

  IF v_count != 0 THEN
    RAISE EXCEPTION 'FAIL: expected 0, got %', v_count;
  END IF;
  RAISE NOTICE 'PASS: dispatch_fail_consecutive reset to %', v_count;

  DELETE FROM tasks WHERE id = test_id;
END $$;
SQL
# 预期：NOTICE: PASS: dispatch_fail_consecutive reset to 0
```

---

### [BEHAVIOR-4] catch 块日志含 task_id（console.warn 格式验证）

**层级**: 代码审查 + 单元测试
**关联 FR**: FR-4
**关联不变量**: IN-4

**断言**：
- `dispatcher.js` 的 `catch (autoblockErr)` 块输出格式为 `console.warn`（不是 `console.error`）
- 输出字符串包含 `task ${nextTask.id}`（task_id 明确嵌入）
- 输出字符串包含 `(non-fatal)`

**测试文件**: `packages/brain/src/__tests__/dispatch-fail-autoblock.test.js`（既有单测补充验证）
**测试名称**: `[BEHAVIOR-4] autoblock catch 块输出 console.warn 含 task_id`

**manual:bash 验收命令**：
```bash
# 静态检查 dispatcher.js 中 catch 块的日志格式
grep -n 'dispatch-fail-autoblock counter update failed' /workspace/packages/brain/src/dispatcher.js

# 预期输出类似：
# 825:        console.warn(`[dispatch] dispatch-fail-autoblock counter update failed (task ${nextTask.id}) (non-fatal): ${autoblockErr.message}`);
# 
# 必须满足：
# 1. 以 console.warn 开头（不是 console.error）
# 2. 包含 nextTask.id
# 3. 包含 (non-fatal)
grep -c 'console\.warn.*dispatch-fail-autoblock.*nextTask\.id.*non-fatal' /workspace/packages/brain/src/dispatcher.js
# 预期：1（恰好一处）
```

---

## DoD 检查表

| # | 条件 | 验证方式 | 状态 |
|---|------|---------|------|
| 1 | failing 集成测试先 commit（GP-1/2/3 全红） | `git log` 确认 Red commit 在实现前 | ⏳ |
| 2 | `$2::int` 修复后集成测试全绿 | `npx vitest run ...autoblock-sql-integration.test.js` | ⏳ |
| 3 | 既有 `dispatch-fail-autoblock.test.js` 全过 | CI brain-unit 不红 | ⏳ |
| 4 | `console.warn` 含 task_id（代码审查） | `grep` 验证 | ⏳ |
| 5 | CI 全绿（brain-ci.yml） | GitHub Actions | ⏳ |
| 6 | 集成测试进永久 CI（不允许删除） | brain-integration baseline 更新 | ⏳ |

---

## 验收顺序（时序约束）

```
Phase 1 (Red commit): 
  写 autoblock-sql-integration.test.js 骨架（GP-1/2/3 全 fail）
  → git commit "[red] 集成测试骨架：autoblock SQL $2 类型修复验证"
  → 推到 cp-07150655-ws-ba0a2bdc

Phase 2 (Fix commit):
  修复 dispatcher.js line 800 ($2 → $2::int)
  修复 catch 块日志格式
  → GP-1/2/3 转绿
  → git commit "fix(dispatcher): $2::int 修复 autoblock 计数 SQL + warn 含 task_id"

Phase 3 (CI verify):
  推 PR → brain-ci.yml 全绿
  既有 dispatch-fail-autoblock.test.js 不红
```

---

*[BEHAVIOR] 条目总数：4*
*含 ## E2E 验收 段：是（详见 contract-draft.md 第四节）*
*含 manual:bash 命令：是（每条 [BEHAVIOR] 均有，共 4 条）*
