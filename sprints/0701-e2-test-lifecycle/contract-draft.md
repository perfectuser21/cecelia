# Sprint Contract Draft (Round 4)

## Response Schema（推导来源: N/A）

本 Sprint 无 HTTP 端点，不产出 API Response。
所有验证通过 psql 直查 DB 行状态 + patrol 函数返回值进行。

**N/A — 任务无 HTTP 响应**

---

## ⚠️ Assumption 澄清（proposer 确认）

PRD 假设 "[ASSUMPTION: journey_features 表 active 状态通过 status='active' 或 deleted_at IS NULL 判断]" **经查不正确**。

实际 journey_features 表结构（migrations/282_dev_management_tables.sql）：
- `status CHECK (status IN ('planned','building','done','deprecated'))`
- 无 `deleted_at` 列，无 `status='active'` 值

**合同采用修正后的判断**：`feature 已删 = journey_features.status = 'deprecated'`（即 `status = 'deprecated'` 时视为能力已删除）。Generator 实现必须使用此约定。

---

## 已知约束（来自回归测试）

- [harness-initiative-patrol.test.js] → patrol 防重：同一 initiative 已有 queued/in_progress 任务则跳过
- [tick-watchdog-quarantine.test.js] → tick 内任何 patrol 异常必须 non-fatal（catch warn 不抛出）
- [harness-initiative-patrol.test.js] → vi.mock('../db.js', ...) 为 Brain 单测标准 mock 写法（pool mock）

---

## 接缝清单（共 2 条）

| 接缝 | 真实世界接触点 | 真目标验证方式 |
|------|--------------|--------------|
| **fs.access(file_path)** | 磁盘文件系统（file_path 是否存在） | local_api E2E：插入指向 /nonexistent/path 的行，patrol 后验 DB |
| **pool.query(journey_features)** | cecelia DB 中 journey_features 表状态 | local_api E2E：插入 deprecated feature，patrol 后验 test_registry 行未删 |

两个接缝均可在 local_api 环境（本机 DB + 文件系统）完整验证，无需真机/生产 env。全部标 **逻辑断言**（CI + 集成测试均可验绿即 done）。

---

## Golden Path

**入口**：Brain tick 触发 test-lifecycle-patrol →
**步骤**：migration 311 字段就位 → patrol 检查 24h 窗口 →
遍历 test_registry 每行 → 按文件/能力状态判定 → 分级动作 →
**出口**：孤儿行 status='orphan'，告警清单可见，无误删

---

### Step 1: Migration 311 additive 就位

**来源**: `[FROM_PRD]` — PRD "Migration 311 就位" 段，列出所有新增列与索引

**可观测行为**: test_registry 表新增 status / feature_id / orphan_reason / lifecycle_checked_at 四列及对应索引；存量行 status='active'（DEFAULT 生效）

**验证命令**:
```bash
# 验证四列存在
psql $DATABASE_URL -c "\d test_registry" | grep -E "status|feature_id|orphan_reason|lifecycle_checked_at" | wc -l | grep -E "^[4-9]$" || { echo "FAIL: 列数不足"; exit 1; }

# 验证存量行 DEFAULT 已生效（status 不为 NULL）
NULL_COUNT=$(psql $DATABASE_URL -t -c "SELECT count(*) FROM test_registry WHERE status IS NULL" | tr -d ' ')
[ "$NULL_COUNT" = "0" ] || { echo "FAIL: 存量行 status IS NULL count=$NULL_COUNT"; exit 1; }

echo "✅ Migration 311 列就位"
```

**硬阈值**:
- 四列全部存在（grep 行数 ≥ 4）
- NULL_COUNT = 0（存量行 status 均已有默认值 'active'）

---

### Step 2: Patrol 24h 窗口判断（跳过重复运行）

**来源**: `[FROM_PRD]` — PRD "tick 集成：24h 去重（lifecycle_checked_at 判窗口）"

**可观测行为**: 若 `MAX(lifecycle_checked_at) > NOW() - interval '24 hours'`，patrol 立即返回（不执行任何 UPDATE），本轮 tick fire-and-forget 结束

**验证命令**:
```bash
# 先用 force:true 跑一次 patrol（更新 lifecycle_checked_at 到 NOW()）
# 再立即调 isInLifecyclePatrolWindow()，此时 24h 内已运行 → 必须返回 false（跳过）
node -e "
process.chdir('/workspace');
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol({ force: true }).then(() => {
  return patrol.isInLifecyclePatrolWindow();
}).then(shouldRun => {
  if (shouldRun !== false) {
    console.error('FAIL: 24h 内 isInLifecyclePatrolWindow() 应返回 false，实际返回', shouldRun);
    process.exit(1);
  }
  console.log('OK: 24h 窗口正确跳过 shouldRun=' + shouldRun);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
" || { echo "FAIL: 24h 去重验证失败"; exit 1; }
```

**硬阈值**: `runTestLifecyclePatrol({ force: true })` 执行后，立即调 `isInLifecyclePatrolWindow()` → **必须返回 `false`**（24h 内不重复运行）

---

### Step 3: file_missing 判定 → status='orphan'

**来源**: `[FROM_PRD]` — PRD "判定规则：file_path 不存在 → file_missing"；"分级动作：file_missing → UPDATE status='orphan', orphan_reason='file_missing'"

**可观测行为**: patrol 扫到 file_path 指向不存在磁盘路径的行 → 将该行 UPDATE 为 status='orphan', orphan_reason='file_missing', lifecycle_checked_at=NOW()

**验证命令**:
```bash
# 插入 file_path 不存在的测试行
TEST_ROW_ID=$(psql $DATABASE_URL -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors)
  VALUES ('/tmp/__e2e_nonexistent_$(date +%s).test.ts', 0, '{}')
  ON CONFLICT (file_path) DO UPDATE SET test_count=0
  RETURNING id
" | tr -d ' ')

# 调用 patrol
node -e "
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol().then(r => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
"

# 验证该行已被标 orphan（带时间窗口防历史数据冒充）
STATUS=$(psql $DATABASE_URL -t -c "
  SELECT status FROM test_registry
  WHERE id='$TEST_ROW_ID'
    AND lifecycle_checked_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$STATUS" = "orphan" ] || { echo "FAIL: status=$STATUS (expected orphan)"; exit 1; }

REASON=$(psql $DATABASE_URL -t -c "
  SELECT orphan_reason FROM test_registry WHERE id='$TEST_ROW_ID'
" | tr -d ' ')
[ "$REASON" = "file_missing" ] || { echo "FAIL: orphan_reason=$REASON"; exit 1; }

echo "✅ file_missing 判定正确"
```

**硬阈值**:
- `status = 'orphan'` 且 `lifecycle_checked_at > NOW() - interval '5 minutes'`
- `orphan_reason = 'file_missing'`

---

### Step 3b: file_missing + feature_deleted 同时成立 → file_missing 优先

**来源**: `[FROM_PRD]` — PRD 边界情况第4条"同一行 file_missing + feature_id 非NULL且能力deleted → 以 file_missing 为准"

**可观测行为**: 若同一行既满足 file_path 不存在（file_missing），又满足 feature_id 指向 status='deprecated' 的能力，patrol 以 file_missing 判定为准：status='orphan', orphan_reason='file_missing'；该行不出现在 featureDeletedList 中

**验证命令**:
```bash
# 插入 deprecated feature
FEAT_ID=$(psql $DATABASE_URL -t -c "
  INSERT INTO journey_features (name, status, thickness)
  VALUES ('__e2e_prio_deprecated', 'deprecated', 'thin')
  RETURNING id
" | tr -d ' ')

# 插入 file_path 不存在 + feature_id 指向 deprecated feature 的行
NONEXIST="/tmp/__e2e_prio_nonexist_$(date +%s).test.ts"
rm -f "$NONEXIST"
ROW_ID=$(psql $DATABASE_URL -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors, feature_id)
  VALUES ('$NONEXIST', 0, '{}', '$FEAT_ID')
  ON CONFLICT (file_path) DO UPDATE SET status='active', orphan_reason=NULL, feature_id='$FEAT_ID'
  RETURNING id
" | tr -d ' ')

# 调用 patrol
node -e "
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol({ force: true }).then(r => {
  const inFeatureList = (r.featureDeletedList || []).some(x => x.id === '$ROW_ID');
  if (inFeatureList) { console.error('FAIL: 行被错误加入 featureDeletedList（file_missing 应优先）'); process.exit(1); }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"

# 断言 status='orphan', orphan_reason='file_missing'（带时间窗口）
STATUS=$(psql $DATABASE_URL -t -c "
  SELECT status FROM test_registry
  WHERE id='$ROW_ID' AND lifecycle_checked_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$STATUS" = "orphan" ] || { echo "FAIL: status=$STATUS (expected orphan)"; exit 1; }

REASON=$(psql $DATABASE_URL -t -c "
  SELECT orphan_reason FROM test_registry WHERE id='$ROW_ID'
" | tr -d ' ')
[ "$REASON" = "file_missing" ] || { echo "FAIL: orphan_reason=$REASON (expected file_missing)"; exit 1; }

echo "✅ file_missing 优先于 feature_deleted"
```

**硬阈值**:
- `status = 'orphan'` 且 `orphan_reason = 'file_missing'`（不是 feature_deleted）
- 该行不出现在 `featureDeletedList`

---

### Step 4: feature_deleted → 只告警，不删行/不删文件

**来源**: `[FROM_PRD]` — PRD "feature_deleted → 只写日志 + 输出建剪除清单，绝不 DELETE 行 / 不删 test 文件"；"feature_id 非 NULL 且 journey_features 对应行 status='deprecated' → feature_deleted"

**可观测行为**: patrol 扫到 feature_id 指向 status='deprecated' 的 journey_features 行 →
1. test_registry 行**保留**（不删除）
2. patrol 日志/返回值含 feature_deleted 清单
3. 任何 .test.ts 文件未被删除

**验证命令**:
```bash
# 插入一个 deprecated feature
FEAT_ID=$(psql $DATABASE_URL -t -c "
  INSERT INTO journey_features (name, status, thickness)
  VALUES ('__e2e_deprecated_feat', 'deprecated', 'thin')
  RETURNING id
" | tr -d ' ')

# 插入 test_registry 行关联此 feature（file_path 使用真实存在的文件）
TEST_FILE="/workspace/packages/brain/src/tick.js"
TEST_ROW_ID=$(psql $DATABASE_URL -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors, feature_id)
  VALUES ('$TEST_FILE', 0, '{}', '$FEAT_ID')
  ON CONFLICT (file_path) DO UPDATE SET feature_id='$FEAT_ID', test_count=0
  RETURNING id
" | tr -d ' ')

# 调用 patrol
node -e "
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol().then(r => {
  const hasFeatDeleted = r.featureDeletedList && r.featureDeletedList.length > 0;
  if (!hasFeatDeleted) { console.error('FAIL: featureDeletedList 为空'); process.exit(1); }
  console.log('featureDeletedList OK:', r.featureDeletedList.length);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"

# 验证行未被删除
ROW_COUNT=$(psql $DATABASE_URL -t -c "
  SELECT count(*) FROM test_registry WHERE id='$TEST_ROW_ID'
" | tr -d ' ')
[ "$ROW_COUNT" = "1" ] || { echo "FAIL: test_registry 行被误删"; exit 1; }

# 验证文件未被删除
[ -f "$TEST_FILE" ] || { echo "FAIL: test 文件被误删 $TEST_FILE"; exit 1; }

echo "✅ feature_deleted 只告警，行和文件均保留"
```

**硬阈值**:
- `test_registry WHERE id='$TEST_ROW_ID'` count = 1（行未删）
- `$TEST_FILE` 文件仍存在
- patrol 返回值 `featureDeletedList.length ≥ 1`

---

### Step 5: feature_id IS NULL → 不被误标 feature_deleted

**来源**: `[FROM_PRD]` — PRD "feature_id IS NULL → 仅判 file_missing，不判 feature_deleted"

**可观测行为**: feature_id 为 NULL 的行，即使文件存在，也不会因无关联能力而被标记 feature_deleted

**验证命令**:
```bash
# 插入 feature_id=NULL 的行（file_path 指向真实存在文件）
TEST_FILE="/workspace/packages/brain/src/tick.js"
NULL_ROW_ID=$(psql $DATABASE_URL -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors, feature_id)
  VALUES ('${TEST_FILE}_null_feat_test', 0, '{}', NULL)
  ON CONFLICT (file_path) DO UPDATE SET feature_id=NULL
  RETURNING id
" | tr -d ' ')

node -e "
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol().then(r => {
  const hasBadEntry = (r.featureDeletedList || []).some(x => x.id === '$NULL_ROW_ID');
  if (hasBadEntry) { console.error('FAIL: feature_id=NULL 行被误加入 featureDeletedList'); process.exit(1); }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"

echo "✅ feature_id IS NULL 不误标 feature_deleted"
```

**硬阈值**: patrol 返回值 `featureDeletedList` 不含 feature_id=NULL 的行

---

### Step 6: 误标自愈 — 文件/能力回来 → status='active'

**来源**: `[FROM_PRD]` — PRD "误标自愈：文件或能力回来 → UPDATE status='active', orphan_reason=NULL, lifecycle_checked_at=NOW()"

**可观测行为**: 原来 status='orphan' 的行，file_path 对应文件再次存在 → patrol 将其恢复为 status='active', orphan_reason=NULL

**验证命令**:
```bash
# 创建临时文件
TMPFILE=$(mktemp /tmp/e2e_revive_XXXXXX.test.ts)

# 插入 status='orphan' 行（file_path 指向刚创建的文件）
REVIVE_ID=$(psql $DATABASE_URL -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors, status, orphan_reason)
  VALUES ('$TMPFILE', 0, '{}', 'orphan', 'file_missing')
  ON CONFLICT (file_path) DO UPDATE SET status='orphan', orphan_reason='file_missing'
  RETURNING id
" | tr -d ' ')

# patrol 运行（文件存在 → 自愈）
node -e "
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
"

# 验证自愈
STATUS=$(psql $DATABASE_URL -t -c "
  SELECT status FROM test_registry
  WHERE id='$REVIVE_ID' AND lifecycle_checked_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$STATUS" = "active" ] || { echo "FAIL: 自愈失败 status=$STATUS"; exit 1; }

REASON=$(psql $DATABASE_URL -t -c "
  SELECT orphan_reason FROM test_registry WHERE id='$REVIVE_ID'
" | tr -d ' ')
[ -z "$REASON" ] || { echo "FAIL: orphan_reason 未清空 reason=$REASON"; exit 1; }

rm -f "$TMPFILE"
echo "✅ 自愈成功"
```

**硬阈值**:
- `status = 'active'` 且 `lifecycle_checked_at > NOW() - interval '5 minutes'`
- `orphan_reason IS NULL`

---

### Step 7: journey_features 查询失败 → patrol 静默跳过（不改行状态）

**来源**: `[AI_ADDED]` — PRD 边界情况"journey_features 查询失败 → patrol 跳过本轮，不抛异常，不改任何行状态"；防止 patrol 在 DB 临时故障时误清行

**可观测行为**: patrol 函数在 pool 抛出错误时 catch 后返回 `{ skipped: true, reason: 'db_error' }`，不抛异常，test_registry 行状态不变

**验证命令**:
```bash
# 用 vitest 单测 mock pool 抛出异常（见 tests/test-lifecycle-patrol.test.js）
node -e "
// 单测层验证（BEHAVIOR 5），此命令检查单测文件存在且含 db_error 覆盖
const fs = require('fs');
const content = fs.readFileSync('sprints/0701-e2-test-lifecycle/tests/test-lifecycle-patrol.test.js', 'utf8');
if (!content.includes('db_error') && !content.includes('query failed')) {
  console.error('FAIL: 单测缺 DB 错误场景覆盖'); process.exit(1);
}
console.log('OK: DB error 场景有单测覆盖');
" || exit 1
```

**硬阈值**: 单测文件存在且含 DB 异常场景覆盖

---

### Step 8: Tick 集成 — fire-and-forget + 24h 去重注册

**来源**: `[FROM_PRD]` — PRD "tick 集成：挂 Brain tick-runner，复用 fire-and-forget 模式 + 24h 去重（lifecycle_checked_at 判窗口）"

**可观测行为**: tick-runner.js 新增 import + `isInLifecyclePatrolWindow` 窗口检查 + fire-and-forget 调用块（格式与 skill-drift-patrol 集成一致）；24h 窗口内重复 tick 不触发 patrol

**验证命令**:
```bash
# 验证 tick-runner.js 已 import test-lifecycle-patrol
grep -q "test-lifecycle-patrol" /workspace/packages/brain/src/tick-runner.js || { echo "FAIL: tick-runner 未 import test-lifecycle-patrol"; exit 1; }

# 验证 24h 窗口检查（isInLifecyclePatrolWindow）— 防止 Generator 绕过去重直接调 patrol
grep -q "isInLifecyclePatrolWindow" /workspace/packages/brain/src/tick-runner.js || { echo "FAIL: tick-runner 未调用 isInLifecyclePatrolWindow 窗口检查"; exit 1; }

# 验证有 fire-and-forget 调用模式
grep -q "runTestLifecyclePatrol\|testLifecyclePatrol" /workspace/packages/brain/src/tick-runner.js || { echo "FAIL: tick-runner 未调用 patrol"; exit 1; }

echo "✅ tick 集成就位"
```

**硬阈值**:
- `grep -q "test-lifecycle-patrol"` 通过
- `grep -q "isInLifecyclePatrolWindow"` 通过（24h 去重窗口检查必须在 tick-runner 显式调用）
- `grep -q "runTestLifecyclePatrol"` 通过

---

## E2E 验收（final-e2e — local_api bash 脚本）

**journey_type**: autonomous
**target_environment**: local_api

<!-- GOLDEN_SMOKE_ABILITY_SLUG: test-lifecycle-patrol -->
<!-- GOLDEN_SMOKE_TARGET_ENV: local_api -->

### Scenario 1: migration-311-columns-exist
<!-- GOLDEN_SMOKE_SCENARIO: migration-311-columns-exist -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e

# 验证 migration 311 列存在（依赖 DATABASE_URL 或 BRAIN_URL 的 DB）
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"

COL_COUNT=$(psql "$DB" -t -c "
  SELECT count(*) FROM information_schema.columns
  WHERE table_name = 'test_registry'
    AND column_name IN ('status','feature_id','orphan_reason','lifecycle_checked_at')
" | tr -d ' ')

[ "$COL_COUNT" = "4" ] || { echo "FAIL: 列数=$COL_COUNT (expected 4)"; exit 1; }

# 验证 status 默认值约束存在
HAS_DEFAULT=$(psql "$DB" -t -c "
  SELECT count(*) FROM information_schema.columns
  WHERE table_name='test_registry' AND column_name='status' AND column_default LIKE '%active%'
" | tr -d ' ')
[ "$HAS_DEFAULT" = "1" ] || { echo "FAIL: status 列无 DEFAULT 'active'"; exit 1; }

echo "✅ Scenario 1 通过"
```

### Scenario 2: file-missing-marks-orphan
<!-- GOLDEN_SMOKE_SCENARIO: file-missing-marks-orphan -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
UNIQUE_PATH="/tmp/__smoke_e2e_$(date +%s)_nonexistent.test.ts"

# 插入指向不存在文件的行（确保文件不存在）
rm -f "$UNIQUE_PATH"
ROW_ID=$(psql "$DB" -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors)
  VALUES ('$UNIQUE_PATH', 0, '{}')
  ON CONFLICT (file_path) DO UPDATE SET status='active', orphan_reason=NULL
  RETURNING id
" | tr -d ' ')

# 触发 patrol
node -e "
process.chdir('/workspace');
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol({ force: true }).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
"

# 验证 status='orphan' 且 orphan_reason='file_missing'（带时间窗口）
STATUS=$(psql "$DB" -t -c "
  SELECT status FROM test_registry
  WHERE id='$ROW_ID' AND lifecycle_checked_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$STATUS" = "orphan" ] || { echo "FAIL: status=$STATUS (expected orphan)"; exit 1; }

REASON=$(psql "$DB" -t -c "SELECT orphan_reason FROM test_registry WHERE id='$ROW_ID'" | tr -d ' ')
[ "$REASON" = "file_missing" ] || { echo "FAIL: orphan_reason=$REASON"; exit 1; }

# 清理
psql "$DB" -c "DELETE FROM test_registry WHERE id='$ROW_ID'" > /dev/null

echo "✅ Scenario 2 通过"
```

### Scenario 3: feature-deleted-no-row-deletion
<!-- GOLDEN_SMOKE_SCENARIO: feature-deleted-no-row-deletion -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
REAL_FILE="/workspace/packages/brain/src/tick.js"

# 插入 deprecated feature
FEAT_ID=$(psql "$DB" -t -c "
  INSERT INTO journey_features (name, status, thickness)
  VALUES ('__e2e_smoke_deprecated', 'deprecated', 'thin')
  RETURNING id
" | tr -d ' ')

# 插入关联 deprecated feature 的 test_registry 行（file_path 指向真实存在文件）
ROW_ID=$(psql "$DB" -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors, feature_id)
  VALUES ('${REAL_FILE}__smoke_feat', 0, '{}', '$FEAT_ID')
  ON CONFLICT (file_path) DO UPDATE SET feature_id='$FEAT_ID', status='active'
  RETURNING id
" | tr -d ' ')

# 触发 patrol
node -e "
process.chdir('/workspace');
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol({ force: true }).then(r => {
  const listed = (r.featureDeletedList || []).length;
  if (listed === 0) { console.error('FAIL: featureDeletedList 为空'); process.exit(1); }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"

# 验证行未被删除
ROW_COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM test_registry WHERE id='$ROW_ID'" | tr -d ' ')
[ "$ROW_COUNT" = "1" ] || { echo "FAIL: test_registry 行被误删"; exit 1; }

# 清理
psql "$DB" -c "DELETE FROM test_registry WHERE id='$ROW_ID'" > /dev/null
psql "$DB" -c "DELETE FROM journey_features WHERE id='$FEAT_ID'" > /dev/null

echo "✅ Scenario 3 通过"
```

### Scenario 4: feature-id-null-not-flagged-feature-deleted
<!-- GOLDEN_SMOKE_SCENARIO: feature-id-null-not-flagged-feature-deleted -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
REAL_FILE="/workspace/packages/brain/src/tick.js"

# 插入 feature_id=NULL 行（文件存在）
ROW_ID=$(psql "$DB" -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors, feature_id)
  VALUES ('${REAL_FILE}__null_feat', 0, '{}', NULL)
  ON CONFLICT (file_path) DO UPDATE SET feature_id=NULL, status='active'
  RETURNING id
" | tr -d ' ')

# 触发 patrol
node -e "
process.chdir('/workspace');
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol({ force: true }).then(r => {
  const badEntry = (r.featureDeletedList || []).find(x => x.id === '$ROW_ID');
  if (badEntry) { console.error('FAIL: feature_id=NULL 行被误加入 featureDeletedList'); process.exit(1); }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"

# 清理
psql "$DB" -c "DELETE FROM test_registry WHERE id='$ROW_ID'" > /dev/null

echo "✅ Scenario 4 通过"
```

### Scenario 5: self-heal-active-when-file-restored
<!-- GOLDEN_SMOKE_SCENARIO: self-heal-active-when-file-restored -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
TMPFILE=$(mktemp /tmp/e2e_revive_XXXXXX.test.ts)

# 插入 status='orphan' 的行（file_path 指向刚创建的真实文件）
ROW_ID=$(psql "$DB" -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors, status, orphan_reason)
  VALUES ('$TMPFILE', 0, '{}', 'orphan', 'file_missing')
  ON CONFLICT (file_path) DO UPDATE SET status='orphan', orphan_reason='file_missing'
  RETURNING id
" | tr -d ' ')

# 触发 patrol（文件现在存在 → 自愈）
node -e "
process.chdir('/workspace');
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol({ force: true }).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
"

# 验证 status='active', orphan_reason=NULL
STATUS=$(psql "$DB" -t -c "
  SELECT status FROM test_registry
  WHERE id='$ROW_ID' AND lifecycle_checked_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$STATUS" = "active" ] || { echo "FAIL: 自愈失败 status=$STATUS"; exit 1; }

REASON=$(psql "$DB" -t -c "SELECT coalesce(orphan_reason, 'NULL') FROM test_registry WHERE id='$ROW_ID'" | tr -d ' ')
[ "$REASON" = "NULL" ] || { echo "FAIL: orphan_reason 未清空 reason=$REASON"; exit 1; }

rm -f "$TMPFILE"
psql "$DB" -c "DELETE FROM test_registry WHERE id='$ROW_ID'" > /dev/null

echo "✅ Scenario 5 通过"
```

### Scenario 6: file-missing-wins-over-feature-deleted
<!-- GOLDEN_SMOKE_SCENARIO: file-missing-wins-over-feature-deleted -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
NONEXIST="/tmp/__smoke_prio_$(date +%s)_nonexistent.test.ts"
rm -f "$NONEXIST"

# 插入 deprecated feature
FEAT_ID=$(psql "$DB" -t -c "
  INSERT INTO journey_features (name, status, thickness)
  VALUES ('__smoke_prio_deprecated', 'deprecated', 'thin')
  RETURNING id
" | tr -d ' ')

# 插入 file_path 不存在 + feature_id → deprecated 的行（双重条件）
ROW_ID=$(psql "$DB" -t -c "
  INSERT INTO test_registry (file_path, test_count, covered_behaviors, feature_id)
  VALUES ('$NONEXIST', 0, '{}', '$FEAT_ID')
  ON CONFLICT (file_path) DO UPDATE SET status='active', orphan_reason=NULL, feature_id='$FEAT_ID'
  RETURNING id
" | tr -d ' ')

# 触发 patrol
node -e "
process.chdir('/workspace');
const patrol = require('./packages/brain/src/test-lifecycle-patrol.js');
patrol.runTestLifecyclePatrol({ force: true }).then(r => {
  const inFeatureList = (r.featureDeletedList || []).some(x => x.id === '$ROW_ID');
  if (inFeatureList) { console.error('FAIL: 行被错误加入 featureDeletedList'); process.exit(1); }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"

# 断言 file_missing 优先：status='orphan', orphan_reason='file_missing'
STATUS=$(psql "$DB" -t -c "
  SELECT status FROM test_registry
  WHERE id='$ROW_ID' AND lifecycle_checked_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$STATUS" = "orphan" ] || { echo "FAIL: status=$STATUS (expected orphan)"; exit 1; }

REASON=$(psql "$DB" -t -c "SELECT orphan_reason FROM test_registry WHERE id='$ROW_ID'" | tr -d ' ')
[ "$REASON" = "file_missing" ] || { echo "FAIL: orphan_reason=$REASON (expected file_missing)"; exit 1; }

# 清理
psql "$DB" -c "DELETE FROM test_registry WHERE id='$ROW_ID'" > /dev/null
psql "$DB" -c "DELETE FROM journey_features WHERE id='$FEAT_ID'" > /dev/null

echo "✅ Scenario 6 通过"
```

---

## Risks

| # | 风险 | 概率 | 影响 | Mitigation |
|---|------|------|------|-----------|
| R1 | **Migration 311 在存量大表上执行超时/部分失败**：test_registry 若已有数万行，`ALTER TABLE ADD COLUMN` + `DEFAULT 'active'` 可能锁表超时，导致 migration 部分成功（新列存在但 DEFAULT 未回填） | 低（本地开发库行数有限，但生产 cecelia 行数未知） | 中（存量行 status=NULL，BEHAVIOR 1 验证直接 FAIL） | 1) Migration SQL 用 `ADD COLUMN ... DEFAULT 'active' NOT NULL`（PostgreSQL 11+ 即时模式，无需回填锁）；2) 上线前先 `SELECT count(*) FROM test_registry` 确认行数；3) 若 > 10 万行，拆为先 `ADD COLUMN ... DEFAULT NULL`、再单独 `UPDATE` 分批回填、最后 `SET NOT NULL` |
| R2 | **patrol 扫描中途 DB 中断 → lifecycle_checked_at 脏污**：patrol 逐行 UPDATE 时 DB 连接断开，部分行 lifecycle_checked_at 已更新但其余行未处理，下次 24h 窗口判断因 MAX(lifecycle_checked_at) 已更新而跳过全量扫描 | 中（pool 超时或网络抖动均可触发） | 低（最多延迟 24h 再次扫描，不造成误判） | 1) patrol 用单事务批量 UPDATE 而非逐行 commit，中断即全量回滚；2) 24h 窗口检查改为"本轮 patrol 完整完成时才 SET lifecycle_checked_at"（完成标记写在 finally 块），中断则不写窗口 |
