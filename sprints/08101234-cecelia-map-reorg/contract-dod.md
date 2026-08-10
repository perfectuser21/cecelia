# Contract DoD：Cecelia 承诺地图归位

**Task ID**: `f491a8dd-b0e3-4352-a5e0-6cb85df73d80`
**Sprint Dir**: `sprints/08101234-cecelia-map-reorg`
**当前分支**: `cp-08101910-ws-f491a8dd`

---

## [BEHAVIOR] 验收断言（≥4 条，机器可核查）

### [BEHAVIOR]-1：2 条 active 价值流存在于 journeys 表

**触发条件**：migration 397+398 执行完毕。

**断言**：
```sql
SELECT COUNT(*) FROM journeys WHERE type='value_stream' AND status='active';
```
结果必须等于 **2**。

**失败条件**：结果为 0、1 或 >2，任务视为未完成。

---

### [BEHAVIOR]-2：11 个 Capability 正确挂载到对应价值流

**触发条件**：migration 398+G3/G5 新立完毕。

**断言**（两个子查询均必须通过）：
```sql
-- 子断言 A：工厂 Capability 数=6
SELECT COUNT(*) FROM journeys c
JOIN journeys j ON j.id = c.parent_journey_id
WHERE j.type='value_stream' AND j.name='工厂'
  AND c.type='capability' AND c.status='active';
-- 期望：6

-- 子断言 B：管家 Capability 数=5
SELECT COUNT(*) FROM journeys c
JOIN journeys j ON j.id = c.parent_journey_id
WHERE j.type='value_stream' AND j.name='管家'
  AND c.type='capability' AND c.status='active';
-- 期望：5
```

**失败条件**：工厂!=6 或管家!=5，任务视为未完成。

---

### [BEHAVIOR]-3：journey_features 孤儿（journey_id=NULL）完全归位或归档

**触发条件**：migration 399 执行完毕。

**断言**：
```sql
SELECT COUNT(*) FROM journey_features
WHERE journey_id IS NULL AND status != 'deprecated';
-- 期望：0
```

**约束**：分拣只允许 UPDATE journey_id（归位）或 UPDATE status='deprecated'（归档），禁止 DELETE。

**失败条件**：结果 >0，任务视为未完成。

---

### [BEHAVIOR]-4：横切件池 7 项登记记录完整且字段合法

**触发条件**：migration 400 执行完毕。

**断言**：
```sql
SELECT COUNT(*) FROM working_memory WHERE key LIKE 'xcut::%';
-- 期望：7

-- 内容完整性：每项必须有 owner_capability_code
SELECT COUNT(*) FROM working_memory
WHERE key LIKE 'xcut::%'
  AND (value->>'owner_capability_code') IS NOT NULL
  AND (value->>'owner_capability_code') != '';
-- 期望：7（与上一查询相同，即每项都有 owner 字段）
```

**7 项 key 必须全部存在**：
`xcut::heartbeat` / `xcut::credential_chain` / `xcut::executor_pool` /
`xcut::skill_dispatch` / `xcut::alert_chain` / `xcut::database` / `xcut::network`

**失败条件**：总数!=7 或任何一项缺少 `owner_capability_code`，任务视为未完成。

---

### [BEHAVIOR]-5：in_progress 任务 journey_id 引用迁移后仍可解析（锚点保护）

**触发条件（前置基线）**：migration 397 执行后、migration 398 执行前。

**前置基线断言（快照锁定）**：
```sql
-- 验证：所有有 journey_id 的 in_progress 任务，其 journey_id 在 journeys 表中均可解析
SELECT COUNT(*) FROM tasks t
WHERE t.status='in_progress'
  AND t.journey_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM journeys j WHERE j.id=t.journey_id);
-- 期望：0（migration 397 执行后锚点基线必须清洁，即：加字段不破坏外键可解析性）
```

此快照作为迁移前的基线锚点，后续断言以此为对照。

**迁移后断言（migration 397-400 全部执行完毕后）**：
```sql
SELECT t.id, t.title, j.name AS journey_name
FROM tasks t
INNER JOIN journeys j ON j.id = t.journey_id
WHERE t.status = 'in_progress';
-- 期望：所有有 journey_id 的 in_progress 任务，journey_name 必须非 NULL
-- （行存在，且 status 不限，未删除即可）
```

**负向断言（无遗孤任务）**：
```sql
SELECT COUNT(*) FROM tasks t
WHERE t.status='in_progress'
  AND t.journey_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM journeys j WHERE j.id=t.journey_id);
-- 期望：0（无悬空 FK）
```

**失败条件**：有任何 in_progress 任务的 journey_id 在 journeys 表中找不到对应行。

---

### [BEHAVIOR]-6：selfcheck.js EXPECTED_SCHEMA_VERSION 同步为 400

**触发条件**：所有 migration 文件合入。

**断言**：
```bash
grep "EXPECTED_SCHEMA_VERSION = '400'" packages/brain/src/selfcheck.js
# 期望：命中 1 行
```

**失败条件**：grep 返回空结果，任务视为未完成。

---

### [BEHAVIOR]-7：分拣 audit 记录可查（F1 ZenithJoy 挂片分拣规则机器可核查）

**触发条件**：migration 399 执行完毕。

**断言**：
```sql
SELECT COUNT(*) FROM working_memory
WHERE key = 'migration_audit:399_orphan_triage';
-- 期望：≥1（audit JSON 记录存在）
```

**内容断言**：audit 记录中必须含有 `triage_log` 数组，每项记录 `feature_id`、`rule_matched`、`before_journey_id`、`after_journey_id`。

**失败条件**：无 audit 记录，或 audit 记录无 `triage_log` 字段。

---

### [BEHAVIOR]-8：迁移前已知的 10 条 journey 行迁移后仍全部存在（INV-1 专项）

**触发条件**：migration 397-400 全部执行完毕。

**断言**：下列 10 个 journey（按 ID 前缀标识）必须在 journeys 表中仍然存在（行不得 DELETE，type/status 允许变更）：

```sql
-- 逐一验证各已知 journey 行存在（共 10 条）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE '743f0e7c%'; -- 期望：1（F0 提案拍板）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE 'e6f803f2%'; -- 期望：1（F1 开发闭环）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE '2fa4d085%'; -- 期望：1（F2 部署闭环）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE 'ec4eb591%'; -- 期望：1（F3 夜间体检）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE '91c17939%'; -- 期望：1（F4 故障自愈）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE '8bb8252f%'; -- 期望：1（F5→G1 指挥舱）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE '824ee0f5%'; -- 期望：1（F6→G2 收件箱）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE 'a824b567%'; -- 期望：1（F7→G4 记忆知识）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE '51754939%'; -- 期望：1（MJ5 承诺地图）
SELECT COUNT(*) FROM journeys WHERE id::text LIKE '0c1f70f1%'; -- 期望：1（西安机群→deprecated）
```

**合并验证查询**（10 条全存在则返回 10）：
```sql
SELECT COUNT(*) FROM journeys
WHERE id::text LIKE ANY(ARRAY[
  '743f0e7c%','e6f803f2%','2fa4d085%','ec4eb591%','91c17939%',
  '8bb8252f%','824ee0f5%','a824b567%','51754939%','0c1f70f1%'
]);
-- 期望：10
```

**约束**：仅验证行存在，type/status 变更（如 F5 改名并重挂管家、西安机群变 deprecated）均为合法迁移行为。

**失败条件**：任意一个已知 ID 前缀在 journeys 表中查不到行（COUNT=0），视为违反 INV-1 禁 DELETE 铁律。

**测试实现**：对应 tests/test-invariants.js inv1（`inv1_no_journey_deleted`）SQL 逻辑。

---

## manual:bash 验收命令

以下命令在 PR 合入后手工执行，确认生产数据库状态：

```bash
#!/usr/bin/env bash
# manual:bash — Cecelia 承诺地图归位验收
# 在 workspace 根目录执行: bash sprints/08101234-cecelia-map-reorg/tests/run-contract-tests.sh

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== 承诺地图归位 E2E 验收 ==="
echo "Brain URL: $BRAIN_URL"
echo ""

# 辅助函数
check_sql() {
  local label="$1"
  local query="$2"
  local expected="$3"
  local result
  result=$(curl -sf "$BRAIN_URL/api/brain/query" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "{\"sql\": \"$query\"}" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
rows=d.get('rows', d) if isinstance(d,dict) else d
if rows: print(list(rows[0].values())[0])
else: print(0)
" 2>/dev/null || echo "ERROR")
  if [ "$result" = "$expected" ]; then
    echo "  [PASS] $label: $result"
    return 0
  else
    echo "  [FAIL] $label: expected=$expected, got=$result"
    return 1
  fi
}

PASS=0; FAIL=0

echo "--- DOD-1: 价值流数量 ---"
if check_sql "active value_stream count" \
  "SELECT COUNT(*)::text FROM journeys WHERE type='value_stream' AND status='active'" \
  "2"; then ((PASS++)); else ((FAIL++)); fi

echo ""
echo "--- DOD-2: 工厂 Capability 数 ---"
if check_sql "工厂 capability count" \
  "SELECT COUNT(*)::text FROM journeys c JOIN journeys j ON j.id=c.parent_journey_id WHERE j.type='value_stream' AND j.name='工厂' AND c.type='capability' AND c.status='active'" \
  "6"; then ((PASS++)); else ((FAIL++)); fi

echo "--- DOD-2: 管家 Capability 数 ---"
if check_sql "管家 capability count" \
  "SELECT COUNT(*)::text FROM journeys c JOIN journeys j ON j.id=c.parent_journey_id WHERE j.type='value_stream' AND j.name='管家' AND c.type='capability' AND c.status='active'" \
  "5"; then ((PASS++)); else ((FAIL++)); fi

echo ""
echo "--- DOD-3: in_progress 任务锚点 ---"
if check_sql "dangling task journey_id count" \
  "SELECT COUNT(*)::text FROM tasks t WHERE t.status='in_progress' AND t.journey_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journeys j WHERE j.id=t.journey_id)" \
  "0"; then ((PASS++)); else ((FAIL++)); fi

echo ""
echo "--- DOD-4: 孤儿 journey_features 清零 ---"
if check_sql "null journey_id features (non-deprecated)" \
  "SELECT COUNT(*)::text FROM journey_features WHERE journey_id IS NULL AND status!='deprecated'" \
  "0"; then ((PASS++)); else ((FAIL++)); fi

echo ""
echo "--- DOD-5: 横切件池 7 项 ---"
if check_sql "xcut working_memory count" \
  "SELECT COUNT(*)::text FROM working_memory WHERE key LIKE 'xcut::%'" \
  "7"; then ((PASS++)); else ((FAIL++)); fi

echo ""
echo "--- DOD-6: F1 audit 记录 ---"
if check_sql "migration audit 399 record" \
  "SELECT COUNT(*)::text FROM working_memory WHERE key='migration_audit:399_orphan_triage'" \
  "1"; then ((PASS++)); else ((FAIL++)); fi

echo ""
echo "--- DOD-7: migration 文件存在 ---"
FILES_OK=true
for f in 397 398 399 400; do
  if ls packages/brain/migrations/${f}_*.sql >/dev/null 2>&1; then
    echo "  [PASS] migration ${f} 文件存在"
    ((PASS++))
  else
    echo "  [FAIL] migration ${f} 文件缺失"
    ((FAIL++))
    FILES_OK=false
  fi
done

echo ""
echo "--- DOD-8: selfcheck EXPECTED_SCHEMA_VERSION=400 ---"
if grep -q "EXPECTED_SCHEMA_VERSION = '400'" packages/brain/src/selfcheck.js; then
  echo "  [PASS] EXPECTED_SCHEMA_VERSION=400"
  ((PASS++))
else
  CURRENT=$(grep "EXPECTED_SCHEMA_VERSION" packages/brain/src/selfcheck.js | head -1)
  echo "  [FAIL] 期望 '400'，实际: $CURRENT"
  ((FAIL++))
fi

echo ""
echo "--- DOD-9: facts-check DevGate ---"
if node scripts/facts-check.mjs >/dev/null 2>&1; then
  echo "  [PASS] facts-check 通过"
  ((PASS++))
else
  echo "  [FAIL] facts-check 失败"
  ((FAIL++))
fi

echo ""
echo "==============================="
echo "结果: PASS=$PASS, FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "全部验收通过 ✓"
  exit 0
else
  echo "存在 $FAIL 项失败，任务未完成"
  exit 1
fi
```

---

## Invariant 覆盖确认

| INV-ID | 约束文字 | 覆盖位置 |
|--------|---------|---------|
| INV-1 | 已有 journey 行不得 DELETE | [BEHAVIOR]-8 专项断言（10 行 ID 前缀逐一核查） |
| INV-2 | in_progress journey_id 迁移后仍可解析 | [BEHAVIOR]-5 前置基线 + 迁移后双断言 |
| INV-3 | 全部 schema 变更走 migration 文件 | [BEHAVIOR]-6 + DOD-7 文件存在性 |
| INV-4 | 23 个孤儿归位或打 deprecated，禁止 DELETE | [BEHAVIOR]-3 清零断言 |
| INV-5 | migration 必须有 rollback SQL | 测试 test-migration-rollback.sh |
| INV-6 | selfcheck EXPECTED_SCHEMA_VERSION 更新至 400 | [BEHAVIOR]-6 + DOD-8 |
| INV-7 | 分拣规则机器可核查 | [BEHAVIOR]-7 audit 记录断言 |
| INV-8 | 横切件 7 项有可查询登记记录 | [BEHAVIOR]-4 双重 SQL 断言 |
| INV-9 | CI 全绿 | DOD-9 facts-check；CI pipeline brain-ci.yml |

**铁律覆盖：9/9**

> [BEHAVIOR] 条目总数：8 条（[BEHAVIOR]-1 至 [BEHAVIOR]-8）
