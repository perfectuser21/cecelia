# Contract DoD：preview 环境瘦克隆

**Task ID**: 62c1be9a-9a86-43ba-9a14-3046550de1a6  
**Sprint**: 08110001-preview-thin-clone  
**日期**: 2026-08-10

---

## 完成定义（Definition of Done）

以下所有条目必须全部满足，PR 方可合并。

### 代码变更

- [ ] **DOD-C1** `[BEHAVIOR]`: `scripts/preview-env-start.sh` 顶部常量区新增 `THIN_CLONE_EXCLUDE` 数组，包含 7 张历史表
- [ ] **DOD-C2** `[BEHAVIOR]`: pg_dump 命令通过循环追加 `--exclude-table-data` 参数，不使用内联硬编码字符串
- [ ] **DOD-C3** `[BEHAVIOR]`: 脚本日志输出排除表名单（log 行含表名列表）
- [ ] **DOD-C4** `[BEHAVIOR]`: 无 `--exclude-table` 参数（保留 schema，只排数据）

### 单元测试

- [ ] **DOD-U1**: `scripts/__tests__/preview-env-start.test.sh` 追加 Case：mock pg_dump 捕获完整 7 张表的 `--exclude-table-data` 参数
- [ ] **DOD-U2**: 断言业务表（tasks、journeys）不出现在排除参数中
- [ ] **DOD-U3**: 单元测试本地 `bash scripts/__tests__/preview-env-start.test.sh` PASS（FAIL=0）

### 集成验证（CI local_api 环境）

- [ ] **DOD-I1**: 克隆后 `information_schema.tables` 查询 7 张排除表，count = 7（schema 存在）
- [ ] **DOD-I2**: 7 张排除表各自 `SELECT count(*) = 0`（数据为空）

### E2E 验证（真实 preview 环境）

- [ ] **DOD-E1** `[BEHAVIOR]` `manual:bash`: `psql -c "SELECT pg_database_size('${DB_NAME}')"` 返回值 < 1073741824，原始数字附入 PR 描述
- [ ] **DOD-E2**: preview Brain health endpoint 返回 200 + `"status":"running"`
- [ ] **DOD-E3**: preview Brain selfcheck 无 schema_version 错误
- [ ] **DOD-E4**: 既有冒烟脚本 exit 0
- [ ] **DOD-E5**: `tasks` 和 `journeys` 行数与主库对比数字附入 PR 描述（preview >= production）

### CI

- [ ] **DOD-CI1**: brain-ci.yml 全绿
- [ ] **DOD-CI2**: engine-ci.yml 全绿

### PR 证据（必须写进 PR 描述）

- [ ] **DOD-PR1**: `pg_database_size` 原始返回数字（bytes）
- [ ] **DOD-PR2**: tasks 行数对比（主库 vs preview）
- [ ] **DOD-PR3**: journeys 行数对比（主库 vs preview）
- [ ] **DOD-PR4**: 克隆耗时（对比原 50s+，目标 <10s）

---

## 棘轮约束

- 现有单元测试 PASS 数不得减少（regression 保护）
- 新增测试 Case 必须永久保留在 CI 里（不得删除）

---

## 回退路径（出现时执行）

若某排除表被 preview 功能真实依赖（Brain 启动失败 / 接口 500）：
1. 从 `THIN_CLONE_EXCLUDE` 数组移除该表
2. PR 描述注明：`[thin-clone] 从排除名单移除 <table_name>，原因：<error>`
3. 重新运行 E2E 验证
