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

## E2E 段声明

本合同包含 E2E 段（BEHAVIOR-05 ~ BEHAVIOR-09），需要真实起 preview 环境验证，不可以 mock 代替。

---

## manual:bash 段声明

BEHAVIOR-05（pg_database_size 实测）要求人工或 CI 步骤记录原始数字并写进 PR 证据，属于 `manual:bash` 断言。

---

## 测试文件映射

| BEHAVIOR | 测试文件 | 类型 |
|----------|---------|------|
| BEHAVIOR-01 | `sprints/08110001-preview-thin-clone/tests/thin-clone-unit.test.sh` | static-assert |
| BEHAVIOR-02 | `sprints/08110001-preview-thin-clone/tests/thin-clone-unit.test.sh` | unit |
| BEHAVIOR-03,04 | `sprints/08110001-preview-thin-clone/tests/thin-clone-unit.test.sh` | integration (stub) |
| BEHAVIOR-05~09 | `sprints/08110001-preview-thin-clone/tests/thin-clone-e2e.sh` | e2e |
| BEHAVIOR-10 | `sprints/08110001-preview-thin-clone/tests/thin-clone-unit.test.sh` | unit |
