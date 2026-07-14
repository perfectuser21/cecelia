# 补做migration341裸表归位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `cecelia` 库 `public` schema 下的 5 张 Better Auth 裸表（`user`/`session`/`account`/`verification`/`operator_sessions`）迁到 `zenithjoy` schema，并把数据同步一份到独立 `zenithjoy` 库，让实际状态追上 `schema_version=341` 记录的状态。

**Architecture:** 新增一次性运维脚本 `scripts/migrate-341-bare-tables.sh`（备份→执行已修复的 migration 341 SQL→导出→导入独立库→行数校验），并在 `scripts/zenithjoy-db-compare.sh` 追加一段裸表行数巡检（守卫，纳入既有日常巡检）。

**Tech Stack:** bash + psql + pg_dump（PostgreSQL 16，本机 localhost）

---

### Task 1: 新增迁移执行脚本

**Files:**
- Create: `scripts/migrate-341-bare-tables.sh`

- [ ] **Step 1: 写脚本**

```bash
cat > scripts/migrate-341-bare-tables.sh << 'SCRIPT_EOF'
#!/usr/bin/env bash
# migrate-341-bare-tables.sh — 补做 migration 341
#
# 背景：schema_version 记录 341 已完成，但实际 5 张 Better Auth 裸表
# （user/session/account/verification/operator_sessions）仍在 cecelia 库
# public schema，独立 zenithjoy 库里没有这5张表。
# 决策依据：initiative 0935f962 + decision 92b45f80（用户拍板方案a）
#
# 用法：bash scripts/migrate-341-bare-tables.sh
# 前提：本机可直连 localhost postgres，cecelia 库和独立 zenithjoy 库均已存在

set -euo pipefail

PSQL="psql -q"
CECELIA_DB="cecelia"
ZJ_DB="zenithjoy"
TABLES=(operator_sessions verification account session "user")
BACKUP_DIR="/tmp/migrate-341-backup-$(date +%s)"
MIGRATION_SQL="packages/brain/migrations/341_zenithjoy_schema_move.sql"

mkdir -p "$BACKUP_DIR"
echo "=== Step 1: 备份 cecelia 库 5 张裸表到 $BACKUP_DIR ==="
for TABLE in "${TABLES[@]}"; do
  $PSQL -h localhost -U cecelia -d "$CECELIA_DB" \
    -c "\copy (SELECT * FROM public.\"$TABLE\") TO '$BACKUP_DIR/$TABLE.csv' WITH CSV HEADER"
  echo "  ✅ 备份 $TABLE"
done

echo ""
echo "=== Step 2: 执行 migration 341（幂等，SET SCHEMA） ==="
$PSQL -h localhost -U cecelia -d "$CECELIA_DB" -f "$MIGRATION_SQL"

echo ""
echo "=== Step 3: 校验 cecelia 库 5 张表已在 zenithjoy schema ==="
for TABLE in "${TABLES[@]}"; do
  SCHEMA=$($PSQL -h localhost -U cecelia -d "$CECELIA_DB" -tc \
    "SELECT table_schema FROM information_schema.tables WHERE table_name='$TABLE' AND table_schema IN ('public','zenithjoy');" \
    | tr -d ' ')
  if [ "$SCHEMA" != "zenithjoy" ]; then
    echo "  ❌ $TABLE 迁移后仍不在 zenithjoy schema（实际: $SCHEMA），中止"
    exit 1
  fi
  echo "  ✅ $TABLE 已在 zenithjoy schema"
done

echo ""
echo "=== Step 4: 导出 cecelia.zenithjoy 5 张表（schema+data） ==="
DUMP_FILE="$BACKUP_DIR/export.sql"
DUMP_ARGS=()
for TABLE in "${TABLES[@]}"; do
  DUMP_ARGS+=(-t "zenithjoy.\"$TABLE\"")
done
pg_dump -h localhost -U cecelia -d "$CECELIA_DB" -n zenithjoy \
  "${DUMP_ARGS[@]}" --no-owner --no-privileges \
  | grep -v '^CREATE SCHEMA' > "$DUMP_FILE"
echo "  ✅ 导出到 $DUMP_FILE"

echo ""
echo "=== Step 5: 导入独立 zenithjoy 库 ==="
$PSQL -h localhost -U cecelia -d "$ZJ_DB" -c "CREATE SCHEMA IF NOT EXISTS zenithjoy;"
$PSQL -h localhost -U cecelia -d "$ZJ_DB" -f "$DUMP_FILE"
echo "  ✅ 导入完成"

echo ""
echo "=== Step 6: 行数校验（cecelia.zenithjoy vs 独立zenithjoy库.zenithjoy） ==="
ALL_OK=true
for TABLE in "${TABLES[@]}"; do
  CECELIA_COUNT=$($PSQL -h localhost -U cecelia -d "$CECELIA_DB" -tc \
    "SELECT count(*) FROM zenithjoy.\"$TABLE\";" | tr -d ' ')
  ZJ_COUNT=$($PSQL -h localhost -U cecelia -d "$ZJ_DB" -tc \
    "SELECT count(*) FROM zenithjoy.\"$TABLE\";" | tr -d ' ')
  if [ "$CECELIA_COUNT" != "$ZJ_COUNT" ]; then
    echo "  ❌ $TABLE 行数不一致: cecelia=$CECELIA_COUNT zenithjoy=$ZJ_COUNT"
    ALL_OK=false
  else
    echo "  ✅ $TABLE 行数一致: $CECELIA_COUNT"
  fi
done

echo ""
if [ "$ALL_OK" = "true" ]; then
  echo "✅ 迁移完成，两库数据一致。备份保留在 $BACKUP_DIR"
  exit 0
else
  echo "❌ 行数校验失败，请人工排查（备份在 $BACKUP_DIR，未自动回滚）"
  exit 1
fi
SCRIPT_EOF
chmod +x scripts/migrate-341-bare-tables.sh
```

- [ ] **Step 2: 检查脚本语法**

Run: `bash -n scripts/migrate-341-bare-tables.sh`
Expected: 无输出（语法正确）

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-341-bare-tables.sh
git commit -m "feat: 新增migration341裸表归位执行脚本"
```

---

### Task 2: 追加日常巡检守卫

**Files:**
- Modify: `scripts/zenithjoy-db-compare.sh`（追加到文件末尾）

- [ ] **Step 1: 追加裸表行数巡检段**

```bash
cat >> scripts/zenithjoy-db-compare.sh << 'GUARD_EOF'

echo ""
echo "--- 裸表(Better Auth)行数比对（migration341补做守卫） ---"
BARE_TABLES=(operator_sessions verification account session "user")
for TABLE in "${BARE_TABLES[@]}"; do
  CECELIA_BARE=$($PSQL -d "$CECELIA_DB" -tc \
    "SELECT count(*) FROM zenithjoy.\"$TABLE\";" 2>/dev/null | tr -d ' ')
  ZJ_BARE=$($PSQL -d "$ZJ_DB" -tc \
    "SELECT count(*) FROM zenithjoy.\"$TABLE\";" 2>/dev/null | tr -d ' ')
  if [ "$CECELIA_BARE" != "$ZJ_BARE" ]; then
    echo "  ⚠️  $TABLE: cecelia=$CECELIA_BARE zenithjoy=$ZJ_BARE（不一致）"
  else
    echo "  ✅ $TABLE: $CECELIA_BARE（一致）"
  fi
done
GUARD_EOF
```

- [ ] **Step 2: 语法检查**

Run: `bash -n scripts/zenithjoy-db-compare.sh`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add scripts/zenithjoy-db-compare.sh
git commit -m "feat: zenithjoy-db-compare追加裸表行数巡检守卫"
```

---

### Task 3: 执行迁移（生产操作）+ proven-to-fire 验证守卫

**Files:**
- 无新文件，执行 Task 1 产出的脚本

- [ ] **Step 1: 执行迁移前，先看一眼当前行数（用于事后比对）**

Run:
```bash
psql -h localhost -U cecelia -d cecelia -c "SELECT 'user' t, count(*) FROM public.\"user\" UNION ALL SELECT 'session', count(*) FROM public.session UNION ALL SELECT 'account', count(*) FROM public.account;"
```
Expected: 记下 user=162, session=302, account=162（或当前实时值）

- [ ] **Step 2: 执行迁移脚本**

Run: `bash scripts/migrate-341-bare-tables.sh`
Expected: 六个 Step 全部 ✅，最终输出 `✅ 迁移完成，两库数据一致`

- [ ] **Step 3: 若失败，人工排查不自动重试**

若 Step 2 非 0 退出：读脚本输出定位是哪一步失败（备份/迁移SQL/导出/导入/校验），备份文件在 `$BACKUP_DIR`（脚本输出里有路径），**不要自动重跑迁移SQL两次以上**——先确认失败原因，必要时用备份 CSV 手动恢复 `public` schema 下的表。

- [ ] **Step 4: proven-to-fire 验证守卫真的会报警**

这是环境类守卫（生产 DB 迁移，逻辑类 CI test 测不到），要求见 SKILL.md「哨兵死规矩」——故意验证 Task 2 追加的巡检段在数据不一致时真的会输出 ⚠️：

Run:
```bash
bash -c '
PSQL="psql -q"; CECELIA_DB="cecelia"; ZJ_DB="zenithjoy"
CECELIA_BARE=$($PSQL -d "$CECELIA_DB" -tc "SELECT count(*) FROM zenithjoy.\"user\";" | tr -d " ")
FAKE_ZJ_BARE=$((CECELIA_BARE + 999))
if [ "$CECELIA_BARE" != "$FAKE_ZJ_BARE" ]; then echo "  ⚠️  user: cecelia=$CECELIA_BARE zenithjoy=$FAKE_ZJ_BARE（不一致）"; else echo "BUG: 守卫逻辑没检测出差异"; fi
'
```
Expected: 输出 `⚠️  user: cecelia=162 zenithjoy=1161（不一致）` 这样的行（证明比对逻辑在数字不同时真的会报 ⚠️，不是摆设）

- [ ] **Step 5: 跑一次真实巡检脚本确认现在两边一致**

Run: `bash scripts/zenithjoy-db-compare.sh 2>&1 | tail -15`
Expected: 裸表巡检段每张表都是 `✅ ... （一致）`

- [ ] **Step 6: Commit（记录本次迁移已执行，供 PR 描述引用）**

```bash
git add -A
git commit -m "chore: 执行migration341裸表归位迁移，验证守卫proven-to-fire" --allow-empty
```

---

### Task 4: ZenithJoy 后端健康检查（验收标准最后一条）

**Files:**
- 无文件改动，纯验证步骤

- [ ] **Step 1: 检查 ZenithJoy prod 后端（5200端口）健康状态**

Run: `curl -s localhost:5200/health || curl -s localhost:5200/api/health`
Expected: 返回 200 / `{"status":"ok"}` 类似响应，证明迁移后后端仍正常（后端目前连的是 `cecelia` 库，5张表现在从 public 移到 zenithjoy schema，后端 pg.Pool 已配置 `search_path=zenithjoy,public` 应无感知）

- [ ] **Step 2: 若 health 端点不存在，退化为进程存活检查**

Run: `lsof -i :5200 | grep LISTEN`
Expected: 有进程在监听 5200

---

## Self-Review 记录

- **Spec coverage**：设计文档 4 个目标（表移动/独立库同步/可回滚/守卫）分别对应 Task1(移动脚本)/Task3 Step2(执行)/Task1 Step1的backup/Task2(守卫)+Task3 Step4(proven-to-fire) —— 全覆盖
- **Placeholder scan**：无 TBD，所有脚本内容完整
- **Type/命名一致性**：`migrate-341-bare-tables.sh`、`BARE_TABLES`、`TABLES` 数组命名在 Task1/2/3 间一致引用
- **范围**：单一 sprint，无需再拆
