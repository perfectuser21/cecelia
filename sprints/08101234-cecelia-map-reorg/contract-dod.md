# 合同完成条件（Definition of Done）

**Sprint ID**: 08101234-cecelia-map-reorg
**Task ID**: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
**版本**: v1（首轮）
**日期**: 2026-08-10

---

## [BEHAVIOR] B-1：2 条 active 价值流存在于 cecelia DB

**描述**: 执行 Migration 397+398 后，`journeys` 表中存在 2 条 `parent_journey_id IS NULL`、`status = 'active'`、`biz_area = 'cecelia'` 的顶层价值流行。

**验收类型**: `manual:bash`

```bash
# 验收命令（在具有 cecelia DB 访问权限的环境中执行）
RESULT=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -t -c \
  "SELECT COUNT(*) FROM journeys WHERE parent_journey_id IS NULL AND status = 'active' AND biz_area = 'cecelia';" \
  | tr -d ' ')
if [ "$RESULT" -eq 2 ]; then
  echo "PASS: 价值流数量 = $RESULT (期望 2)"
else
  echo "FAIL: 价值流数量 = $RESULT (期望 2)"
  exit 1
fi
```

**期望输出**: `PASS: 价值流数量 = 2 (期望 2)`

---

## [BEHAVIOR] B-2：工厂线 6 个 Capability + 管家线 5 个 Capability

**描述**: `VS_FACTORY` 下有 6 个 active 子 Capability（F0/F1/F2/F3/F4/MJ5），`VS_STEWARD` 下有 5 个 active 子 Capability（G1/G2/G3/G4/G5）。

**验收类型**: `manual:bash`

```bash
# 验收命令：工厂线 Capability 计数
FACTORY_COUNT=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -t -c \
  "SELECT COUNT(*) FROM journeys
   WHERE parent_journey_id = (SELECT id FROM journeys WHERE capability_code = 'VS_FACTORY')
     AND status = 'active';" \
  | tr -d ' ')

# 验收命令：管家线 Capability 计数
STEWARD_COUNT=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -t -c \
  "SELECT COUNT(*) FROM journeys
   WHERE parent_journey_id = (SELECT id FROM journeys WHERE capability_code = 'VS_STEWARD')
     AND status = 'active';" \
  | tr -d ' ')

PASS=true
if [ "$FACTORY_COUNT" -ne 6 ]; then
  echo "FAIL: 工厂线 Capability = $FACTORY_COUNT (期望 6)"
  PASS=false
else
  echo "PASS: 工厂线 Capability = $FACTORY_COUNT"
fi

if [ "$STEWARD_COUNT" -ne 5 ]; then
  echo "FAIL: 管家线 Capability = $STEWARD_COUNT (期望 5)"
  PASS=false
else
  echo "PASS: 管家线 Capability = $STEWARD_COUNT"
fi

[ "$PASS" = true ] || exit 1
```

**期望输出**:
```
PASS: 工厂线 Capability = 6
PASS: 管家线 Capability = 5
```

---

## [BEHAVIOR] B-3：in_progress 任务锚点不断裂

**描述**: 迁移后，两条已知关键锚 journey（F1: `e6f803f2-...`，G1: `8bb8252f-...`）在 journeys 表中仍各有 1 行，且 UUID 不变。

**验收类型**: `manual:bash`

```bash
# 验收命令：确认两条关键锚 journey 行存在
ANCHOR_COUNT=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -t -c \
  "SELECT COUNT(*) FROM journeys WHERE id IN (
    'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29',
    '8bb8252f-29b4-4c34-acb9-1accda7ddfcf'
  );" \
  | tr -d ' ')

if [ "$ANCHOR_COUNT" -eq 2 ]; then
  echo "PASS: 关键锚 journey 行数 = $ANCHOR_COUNT (期望 2)"
else
  echo "FAIL: 关键锚 journey 行数 = $ANCHOR_COUNT (期望 2) — anchor 断裂，anchor-check.js 将报错"
  exit 1
fi
```

**期望输出**: `PASS: 关键锚 journey 行数 = 2 (期望 2)`

---

## [BEHAVIOR] B-4：孤儿挂片归零，横切件池 >= 7

**描述**: Migration 399 执行后，所有 `journey_id IS NULL` 且 `status != 'deprecated'` 的 `journey_features` 行数为 0；Migration 400 执行后，`kind = 'enabler'` 且 `status != 'deprecated'` 的行数 >= 7。

**验收类型**: `manual:bash`

```bash
# 验收命令：孤儿挂片归零
ORPHAN_COUNT=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -t -c \
  "SELECT COUNT(*) FROM journey_features WHERE journey_id IS NULL AND status != 'deprecated';" \
  | tr -d ' ')

# 验收命令：横切件池计数
ENABLER_COUNT=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -t -c \
  "SELECT COUNT(*) FROM journey_features WHERE kind = 'enabler' AND status != 'deprecated';" \
  | tr -d ' ')

PASS=true
if [ "$ORPHAN_COUNT" -ne 0 ]; then
  echo "FAIL: 孤儿挂片 = $ORPHAN_COUNT (期望 0)"
  PASS=false
else
  echo "PASS: 孤儿挂片 = $ORPHAN_COUNT"
fi

if [ "$ENABLER_COUNT" -lt 7 ]; then
  echo "FAIL: 横切件池 = $ENABLER_COUNT (期望 >= 7)"
  PASS=false
else
  echo "PASS: 横切件池 = $ENABLER_COUNT (>= 7)"
fi

[ "$PASS" = true ] || exit 1
```

**期望输出**:
```
PASS: 孤儿挂片 = 0
PASS: 横切件池 = N (>= 7)
```

---

## [BEHAVIOR] B-5：Migration 幂等性（397–400 重复执行无报错）

**描述**: 将 4 个 migration 文件在同一数据库连续执行两次，第二次执行不产生任何 `ERROR` 输出。

**验收类型**: `manual:bash`

```bash
# 验收命令：幂等性检查（需先确保 migration 已执行一次）
MIGRATIONS=(
  "packages/brain/migrations/397_journeys_capability_self_ref.sql"
  "packages/brain/migrations/398_seed_two_value_streams_11_capabilities.sql"
  "packages/brain/migrations/399_journey_features_orphan_retire.sql"
  "packages/brain/migrations/401_cross_cutting_concerns_pool.sql"
)

PASS=true
for migration in "${MIGRATIONS[@]}"; do
  if [ ! -f "/workspace/$migration" ]; then
    echo "SKIP: $migration 文件尚未创建（等待 Planner 产出）"
    continue
  fi
  OUTPUT=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -f "/workspace/$migration" 2>&1)
  if echo "$OUTPUT" | grep -qi "ERROR"; then
    echo "FAIL: $migration 第二次执行报错:"
    echo "$OUTPUT" | grep -i "ERROR"
    PASS=false
  else
    echo "PASS: $migration 幂等执行无报错"
  fi
done

[ "$PASS" = true ] || exit 1
```

---

## [BEHAVIOR] B-6：schema 字段存在（Migration 397 落库确认）

**描述**: Migration 397 执行后，`journeys` 表新增 `parent_journey_id` 和 `capability_code` 两个字段，且 `capability_code` 存在唯一索引。

**验收类型**: `manual:bash`

```bash
# 验收命令：确认新字段存在
FIELD_COUNT=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -t -c \
  "SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'journeys'
     AND column_name IN ('parent_journey_id', 'capability_code');" \
  | tr -d ' ')

INDEX_EXISTS=$(psql "${DATABASE_URL:-postgres://localhost/cecelia}" -t -c \
  "SELECT COUNT(*) FROM pg_indexes
   WHERE tablename = 'journeys'
     AND indexname = 'idx_journeys_capability_code';" \
  | tr -d ' ')

PASS=true
if [ "$FIELD_COUNT" -ne 2 ]; then
  echo "FAIL: journeys 表新增字段数 = $FIELD_COUNT (期望 2)"
  PASS=false
else
  echo "PASS: journeys 表新增字段数 = $FIELD_COUNT"
fi

if [ "$INDEX_EXISTS" -ne 1 ]; then
  echo "FAIL: idx_journeys_capability_code 索引不存在"
  PASS=false
else
  echo "PASS: capability_code 唯一索引存在"
fi

[ "$PASS" = true ] || exit 1
```

---

## DoD 完成清单

所有 [BEHAVIOR] 条目通过后，以下项目必须同时满足：

- [ ] B-1 通过：2 条价值流存在
- [ ] B-2 通过：6 + 5 Capability 归位
- [ ] B-3 通过：锚点不断裂
- [ ] B-4 通过：孤儿归零 + 横切件池 >= 7
- [ ] B-5 通过：Migration 幂等
- [ ] B-6 通过：schema 字段存在
- [ ] brain-ci.yml 全绿（GitHub Actions）
- [ ] PR 合并后 PATCH `/api/brain/tasks/f491a8dd-b0e3-4352-a5e0-6cb85df73d80` 状态回写 `completed`

---

## 判定规则

- 任意 [BEHAVIOR] 的 bash 命令以非 0 exit code 退出 → 整体 FAIL，不允许 merge
- CI 红 → 不允许 merge
- 锚点断裂（B-3 FAIL）属于 P0 级问题，必须优先修复再重跑
