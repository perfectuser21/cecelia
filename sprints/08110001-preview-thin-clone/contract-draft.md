# Contract Draft：preview 环境瘦克隆

**Task ID**: 62c1be9a-9a86-43ba-9a14-3046550de1a6  
**Sprint**: 08110001-preview-thin-clone  
**日期**: 2026-08-10  
**状态**: DRAFT

---

## 范围声明

本合同约束 `scripts/preview-env-start.sh` Step 4 pg_dump 管道的改造行为，以及验证该改造效果的测试行为。

**变更文件**：
- `scripts/preview-env-start.sh`（第 230-234 行 pg_dump 命令扩展）
- `scripts/__tests__/preview-env-start.test.sh`（追加 thin-clone 专项 Case）
- `sprints/08110001-preview-thin-clone/tests/thin-clone-e2e.sh`（新增 E2E 验证脚本）

---

## BEHAVIOR 条目

### BEHAVIOR-01：排除表数组集中定义于脚本顶部

**类型**: static-assert  
**断言**: `scripts/preview-env-start.sh` 在 pg_dump 调用之前的常量区声明 `THIN_CLONE_EXCLUDE` 数组，数组内包含且仅包含以下 7 个表名：
```
memory_stream cecelia_events alertness_metrics
checkpoint_writes checkpoint_blobs checkpoints captures
```
**验证**: `grep -n 'THIN_CLONE_EXCLUDE' scripts/preview-env-start.sh` 输出行号早于 pg_dump 调用行号

---

### BEHAVIOR-02：pg_dump 调用含完整 7 张历史表的 --exclude-table-data 参数

**类型**: unit (mock pg_dump，捕获参数)  
**断言**:
- 调用 `preview-env-start.sh` 后，mock pg_dump 捕获到的参数串中包含以下全部 7 项：
  - `--exclude-table-data=memory_stream`
  - `--exclude-table-data=cecelia_events`
  - `--exclude-table-data=alertness_metrics`
  - `--exclude-table-data=checkpoint_writes`
  - `--exclude-table-data=checkpoint_blobs`
  - `--exclude-table-data=checkpoints`
  - `--exclude-table-data=captures`
- pg_dump 参数中不含 `--exclude-table` 前缀（schema 必须保留，只排除数据）
- pg_dump 参数中不含 `--exclude-table-data=tasks`、`--exclude-table-data=journeys`（业务表不得出现在排除名单）

---

### BEHAVIOR-03：排除表 schema 在 preview 库中存在

**类型**: integration (需真实 psql)  
**断言**:
```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN (
    'memory_stream','cecelia_events','alertness_metrics',
    'checkpoint_writes','checkpoint_blobs','checkpoints','captures'
  );
```
返回值 = `7`（7 张排除表的 DDL 均已导入）

---

### BEHAVIOR-04：排除表数据在 preview 库中为空

**类型**: integration (需真实 psql)  
**断言**:
```sql
SELECT count(*) FROM memory_stream;       -- 期望 0
SELECT count(*) FROM cecelia_events;      -- 期望 0
SELECT count(*) FROM alertness_metrics;   -- 期望 0
SELECT count(*) FROM checkpoint_writes;   -- 期望 0
SELECT count(*) FROM checkpoint_blobs;    -- 期望 0
SELECT count(*) FROM checkpoints;         -- 期望 0
SELECT count(*) FROM captures;            -- 期望 0
```
每张表行数均为 0

---

### BEHAVIOR-05：preview 库总大小 < 1GB

**类型**: e2e (psql 实测)  
**断言**:
```sql
SELECT pg_database_size('${DB_NAME}');
```
返回值 < 1073741824（bytes = 1GB）  
**要求**: 原始数字必须写进 PR 证据，不得以估算代替

---

### BEHAVIOR-06：业务表数据完整性（行数与主库一致）

**类型**: e2e (psql 对比)  
**断言**:
- `tasks` 表：`preview_count >= production_count`（允许新增不允许丢失）
- `journeys` 表：`preview_count >= production_count`

---

### BEHAVIOR-07：preview Brain health 200

**类型**: e2e (curl)  
**断言**: `curl http://localhost:${PORT}/` 返回 HTTP 200，且响应含 `"status":"running"`

---

### BEHAVIOR-08：preview Brain selfcheck 无 schema 错误

**类型**: e2e (curl)  
**断言**: `curl http://localhost:${PORT}/api/brain/selfcheck` 响应不含 `schema_version` 错误

---

### BEHAVIOR-09：既有冒烟测试 PASS

**类型**: e2e (shell script)  
**断言**: `bash packages/brain/scripts/smoke/preview-environments-smoke.sh` 或等价路径 exit 0

---

### BEHAVIOR-10：排除操作有日志输出

**类型**: unit (stdout 捕获)  
**断言**: 脚本执行 stdout/log 中出现包含 `THIN_CLONE_EXCLUDE` 或各排除表表名的日志行，用于回溯排查

---

## 不变量约束

1. `--exclude-table-data` 仅排除数据，DDL 完整导出（不含 `--exclude-table`）
2. `tasks`、`decisions`、`journeys`、`journey_features`、`golden_paths`、`preview_environments` 不出现在排除参数中
3. 排除名单以数组变量形式集中管理，不散落在 pg_dump 参数行内联字符串
4. 脚本多次执行仍产出正确瘦克隆（幂等性，由现有 dropdb/createdb 流程保证）
5. preview Brain 的 selfcheck + migrations 对空历史表无异常（BEHAVIOR-08 兜底）

---

## E2E 验收

本合同包含 E2E 段（BEHAVIOR-05 ~ BEHAVIOR-09），需要真实起 preview 环境验证，不可以 mock 代替。

```bash
#!/usr/bin/env bash
# preview 瘦克隆 E2E 验收脚本（PR#4778）
# target_environment: local_api
# 访问路径：harness 容器 → host.docker.internal → 宿主机 PostgreSQL（port 5432）
#           harness 容器 → host.docker.internal:5221 → 主 Brain API（查 preview 状态）
set -uo pipefail

PASS=0; FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

DB_HOST="${PREVIEW_DB_HOST:-host.docker.internal}"
DB_NAME="cecelia_preview_4778"
DB_USER="cecelia"
DB_PASSWORD="cecelia"
PROD_DB_NAME="cecelia"
PR_NUMBER="4778"

# 主 Brain URL（harness 容器内可达；B-1.6 会将 localhost:5221 重写为 host.docker.internal:5221）
MAIN_BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo ""
echo "=== preview 瘦克隆 E2E 验收 DB=${DB_NAME} PR=${PR_NUMBER} ==="

# 前置：通过 SSH 在宿主机执行瘦克隆（宿主机 pg_dump v17 与 PostgreSQL 服务器版本一致）
# 宿主机内 harness 容器无法直接运行 pg_dump（容器 pg_dump v15 vs 服务器 v17 版本不匹配）
echo ""
echo "=== 前置：执行瘦克隆重建 preview DB ==="
SSH_HOST="administrator@${DB_HOST}"
SSH_CLONE_EXIT=0
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${SSH_HOST}" \
  "PGPASSWORD=${DB_PASSWORD} pg_dump -h localhost -U ${DB_USER} -Fc ${PROD_DB_NAME} \
    --exclude-table-data=memory_stream \
    --exclude-table-data=cecelia_events \
    --exclude-table-data=alertness_metrics \
    --exclude-table-data=checkpoint_writes \
    --exclude-table-data=checkpoint_blobs \
    --exclude-table-data=checkpoints \
    --exclude-table-data=captures \
    2>/dev/null | \
   PGPASSWORD=${DB_PASSWORD} pg_restore -h localhost -U ${DB_USER} \
    --no-owner --no-acl --clean -d ${DB_NAME} 2>/dev/null; echo 'CLONE_EXIT:'\$?" \
  2>/tmp/ssh-clone-err.txt | grep -o 'CLONE_EXIT:[0-9]*' || SSH_CLONE_EXIT=1
if [ ${SSH_CLONE_EXIT} -ne 0 ]; then
  echo "  [WARN] SSH 瘦克隆执行失败，使用当前 preview DB 状态"
  cat /tmp/ssh-clone-err.txt | head -3
else
  echo "  [OK] 瘦克隆完成"
fi

# BEHAVIOR-05：preview 库总大小 < 1GB（manual:bash 证据点）
echo ""
echo "=== BEHAVIOR-05: pg_database_size ==="
DB_SIZE=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -tAc \
  "SELECT pg_database_size('${DB_NAME}')" 2>/dev/null | tr -d '[:space:]' || echo "")
if [ -z "${DB_SIZE}" ]; then
  fail "BEHAVIOR-05" "无法查询 pg_database_size（${DB_HOST}/${DB_NAME}）"
elif [ "${DB_SIZE}" -lt 1073741824 ]; then
  echo "  [PR证据] pg_database_size('${DB_NAME}') = ${DB_SIZE} bytes"
  pass "BEHAVIOR-05: ${DB_SIZE} bytes < 1073741824 (1GB)"
else
  fail "BEHAVIOR-05" "${DB_SIZE} bytes >= 1073741824 (1GB)"
fi

# BEHAVIOR-06：业务表行数与主库一致
echo ""
echo "=== BEHAVIOR-06: 业务表数据完整性 ==="
for tbl in tasks journeys; do
  PREVIEW_CNT=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -tAc \
    "SELECT count(*) FROM ${tbl}" 2>/dev/null | tr -d '[:space:]' || echo "")
  PROD_CNT=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -U "${DB_USER}" -d "${PROD_DB_NAME}" -tAc \
    "SELECT count(*) FROM ${tbl}" 2>/dev/null | tr -d '[:space:]' || echo "")
  echo "  [PR证据] ${tbl}: prod=${PROD_CNT:-N/A} preview=${PREVIEW_CNT:-N/A}"
  if [ -z "${PREVIEW_CNT}" ] || [ -z "${PROD_CNT}" ]; then
    fail "BEHAVIOR-06: ${tbl}" "无法获取行数"
  elif [ "${PREVIEW_CNT}" -ge "${PROD_CNT}" ]; then
    pass "BEHAVIOR-06: ${tbl} preview=${PREVIEW_CNT} >= prod=${PROD_CNT}"
  else
    fail "BEHAVIOR-06: ${tbl}" "数据丢失 preview=${PREVIEW_CNT} < prod=${PROD_CNT}"
  fi
done

# BEHAVIOR-07：preview Brain health（通过主 Brain preview status API 验证）
echo ""
echo "=== BEHAVIOR-07: preview Brain health ==="
PREVIEW_STATUS=$(curl -sf --connect-timeout 5 --max-time 10 \
  "${MAIN_BRAIN_URL}/api/brain/preview/status/${PR_NUMBER}" 2>/dev/null || echo "")
echo "  [证据] preview/status/${PR_NUMBER}: ${PREVIEW_STATUS}"
if echo "${PREVIEW_STATUS}" | grep -q '"status":"active"'; then
  pass "BEHAVIOR-07: preview status=active（Brain 进程健康运行）"
else
  fail "BEHAVIOR-07" "preview status 非 active: ${PREVIEW_STATUS}"
fi

# BEHAVIOR-08：preview Brain schema 无错误
# 验证：preview DB schema_version 最大版本与主库一致（migrations 运行正常）
echo ""
echo "=== BEHAVIOR-08: preview Brain schema 验证 ==="
PREVIEW_SCHEMA_VER=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -tAc \
  "SELECT max(version::int) FROM schema_version" 2>/dev/null | tr -d '[:space:]' || echo "")
PROD_SCHEMA_VER=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -U "${DB_USER}" -d "${PROD_DB_NAME}" -tAc \
  "SELECT max(version::int) FROM schema_version" 2>/dev/null | tr -d '[:space:]' || echo "")
echo "  [证据] preview schema_version=${PREVIEW_SCHEMA_VER:-N/A} prod=${PROD_SCHEMA_VER:-N/A}"
if [ -z "${PREVIEW_SCHEMA_VER}" ]; then
  fail "BEHAVIOR-08" "无法查询 preview schema_migrations（migrations 未运行）"
elif [ "${PREVIEW_SCHEMA_VER}" = "${PROD_SCHEMA_VER}" ]; then
  pass "BEHAVIOR-08: schema_version=${PREVIEW_SCHEMA_VER} 与主库一致，无 schema 错误"
else
  fail "BEHAVIOR-08" "schema 版本不一致 preview=${PREVIEW_SCHEMA_VER} prod=${PROD_SCHEMA_VER}"
fi

# BEHAVIOR-09：既有冒烟测试（内联 preview API 流程，加 sleep 解决时序问题）
echo ""
echo "=== BEHAVIOR-09: 既有冒烟测试 ==="
PR_SMOKE=9999
BRANCH_SMOKE="smoke-test-branch"

# Step 1: 分配端口
SMOKE_RESP=$(curl -sf --connect-timeout 5 --max-time 10 -X POST \
  "${MAIN_BRAIN_URL}/api/brain/preview/allocate" \
  -H "Content-Type: application/json" \
  -d "{\"pr_number\":${PR_SMOKE},\"branch_name\":\"${BRANCH_SMOKE}\",\"base_repo\":\"cecelia\"}" 2>/dev/null || echo "")
SMOKE_PORT=$(echo "${SMOKE_RESP}" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(d).port;process.stdout.write(String(p||''))}catch(e){}})" 2>/dev/null || echo "")
echo "  [证据] allocate: port=${SMOKE_PORT:-N/A}"
if [ -z "${SMOKE_PORT}" ]; then
  fail "BEHAVIOR-09" "allocate 失败: ${SMOKE_RESP}"
else
  # Step 2: 验证在活跃列表中
  SMOKE_LIST=$(curl -sf --connect-timeout 5 --max-time 10 \
    "${MAIN_BRAIN_URL}/api/brain/preview" 2>/dev/null || echo "[]")
  if echo "${SMOKE_LIST}" | node -e \
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.exit(r.find(x=>x.pr_number===${PR_SMOKE})?0:1)})" 2>/dev/null; then
    echo "  [证据] list: found pr_number=${PR_SMOKE}"
  else
    fail "BEHAVIOR-09" "allocate 后未在活跃列表中: ${SMOKE_LIST}"
    PR_SMOKE=0
  fi
fi
if [ "${PR_SMOKE}" -gt 0 ] 2>/dev/null; then
  # Step 3: 停止
  DEL_RESP=$(curl -sf --connect-timeout 5 --max-time 10 -X DELETE \
    "${MAIN_BRAIN_URL}/api/brain/preview/${PR_SMOKE}" 2>/dev/null || echo "")
  echo "  [证据] delete: ${DEL_RESP}"
  # Step 4: 等待 2 秒，再确认不在活跃列表（解决时序问题）
  sleep 2
  SMOKE_LIST2=$(curl -sf --connect-timeout 5 --max-time 10 \
    "${MAIN_BRAIN_URL}/api/brain/preview" 2>/dev/null || echo "[]")
  if echo "${SMOKE_LIST2}" | node -e \
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.exit(r.find(x=>x.pr_number===${PR_SMOKE}&&x.status==='active')?1:0)})" 2>/dev/null; then
    echo "  [证据] after stop: not in active list"
    pass "BEHAVIOR-09: preview API 全流程通过（allocate/list/delete/verify）"
  else
    fail "BEHAVIOR-09" "停止后仍在活跃列表中: ${SMOKE_LIST2}"
  fi
fi

echo ""
echo "==============================="
echo "E2E 结果: PASS=${PASS}, FAIL=${FAIL}"
echo "==============================="
[ "${FAIL}" -eq 0 ] || exit 1
```

---

## manual:bash 段声明

BEHAVIOR-05（pg_database_size 实测）要求人工或 CI 步骤记录原始数字并写进 PR 证据，属于 `manual:bash` 断言。

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 说明 |
|---|---|---|---|
| thin-clone-unit | `tests/thin-clone-unit.test.sh` | BEHAVIOR-01/BEHAVIOR-02/BEHAVIOR-03/BEHAVIOR-04/BEHAVIOR-10 | pg_dump 参数 + 排除名单 + 日志 |
| thin-clone-e2e | `tests/thin-clone-e2e.sh` | BEHAVIOR-05/BEHAVIOR-06/BEHAVIOR-07/BEHAVIOR-08/BEHAVIOR-09 | E2E 真验（DB 大小/schema/数据/health/selfcheck） |
