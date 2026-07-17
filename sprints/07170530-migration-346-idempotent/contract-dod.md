# Contract DoD: migration-346-idempotent

task_id: 874c9cc8-8afe-47c5-a3ed-e1dce93abda4
sprint_dir: sprints/07170530-migration-346-idempotent
version: 1.0
status: proposed

---

## DoD 条目

### [BEHAVIOR-1] 路径 A：空旧表改名后重建完整 incidents 表

**触发条件**：数据库中存在 incidents 表，fingerprint 列不存在，表内行数 = 0

**期望行为**：
- 旧 incidents 表被重命名为 incidents_legacy_pre346
- 新 incidents 表含 fingerprint TEXT NOT NULL UNIQUE 列
- incidents_legacy_pre346 行数与原 incidents 相同（无数据丢失）

**自动化验收**：`migration-346.integration.test.js` - 路径 A 测试用例

**manual:bash 验收命令**：
```bash
# 1. 在 brain DB 制造旧结构空表（若不存在）
psql $DATABASE_URL -c "
DROP TABLE IF EXISTS incidents CASCADE;
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"

# 2. 执行迁移（通过 migrate runner）
node -e "
import('./src/migrate.js').then(({runMigrations}) => {
  import('./src/db.js').then(({pool}) => runMigrations(pool));
});
" 2>&1 | tee /tmp/migration-346-pathA.log

# 3. 验证 fingerprint 列存在
psql $DATABASE_URL -c "
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name='incidents' AND column_name='fingerprint';
" | grep -q "fingerprint" && echo "PASS: fingerprint 列存在" || echo "FAIL: fingerprint 列不存在"

# 4. 验证旧表改名
psql $DATABASE_URL -c "SELECT COUNT(*) FROM incidents_legacy_pre346;" \
  && echo "PASS: incidents_legacy_pre346 存在" || echo "FAIL: 旧表未改名"
```

---

### [BEHAVIOR-2] 幂等性：第 2 次运行 346 迁移无错误

**触发条件**：346 迁移已成功执行，incidents 表含完整结构（fingerprint 列存在）

**期望行为**：
- 再次执行 346 迁移函数不抛出任何错误
- incidents 表结构无变化
- incidents_legacy_pre346 仍存在（未被再次操作）

**自动化验收**：`migration-346.integration.test.js` - 幂等重跑测试用例

**manual:bash 验收命令**：
```bash
# 在完整结构 incidents 表上重跑迁移，期望无报错
node -e "
import('./src/migrate.js').then(({runMigrations}) => {
  import('./src/db.js').then(({pool}) => runMigrations(pool).then(() => {
    console.log('PASS: 幂等重跑成功');
    process.exit(0);
  }).catch(err => {
    console.error('FAIL: 幂等重跑报错:', err.message);
    process.exit(1);
  }));
});
" 2>&1
```

---

### [BEHAVIOR-3] 路径 B：非空旧表补 fingerprint 列，回填后加 NOT NULL 约束

**触发条件**：数据库中存在 incidents 表，fingerprint 列不存在，表内行数 > 0

**期望行为**：
- `ALTER TABLE incidents ADD COLUMN fingerprint TEXT` 执行（允许 NULL）
- 现有所有行的 fingerprint 回填占位值（gen_random_uuid()::text），无 NULL 残留
- `ALTER TABLE incidents ALTER COLUMN fingerprint SET NOT NULL` 执行
- 添加 UNIQUE 约束
- 原有行数不变（无数据丢失）

**自动化验收**：`migration-346.integration.test.js` - 路径 B 测试用例（或 manual 如 CI fixture 受限）

**manual:bash 验收命令**：
```bash
# 1. 制造非空旧结构表
psql $DATABASE_URL -c "
DROP TABLE IF EXISTS incidents CASCADE;
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO incidents(probe_id, severity) VALUES ('test-probe', 'warning'), ('test-probe-2', 'critical');
"

# 2. 执行迁移
node -e "
import('./src/migrate.js').then(({runMigrations}) => {
  import('./src/db.js').then(({pool}) => runMigrations(pool));
});
" 2>&1

# 3. 验证无 NULL fingerprint
psql $DATABASE_URL -c "SELECT COUNT(*) FROM incidents WHERE fingerprint IS NULL;" \
  | grep -q "^ 0$" && echo "PASS: 无 NULL fingerprint" || echo "FAIL: 存在 NULL fingerprint"

# 4. 验证行数不变
psql $DATABASE_URL -c "SELECT COUNT(*) FROM incidents;" \
  | grep -q "^ 2$" && echo "PASS: 行数不变(2)" || echo "FAIL: 行数不一致"
```

---

### [BEHAVIOR-4] Brain 迁移失败最多重试 3 次，超限调用 sendBark + process.exit(1)

**触发条件**：runMigrations 连续抛出错误超过 3 次

**期望行为**：
- 最多重试 3 次（attempt 1/2/3），不超过 3 次
- 第 3 次失败后：调用 sendBark，title = `[Brain FATAL]`，body 含错误消息 + 时间戳
- 调用 process.exit(1)
- 不进入无上限循环（禁止 attempt > 3）

**自动化验收**：server.js 单元/集成测试（mock runMigrations 3 次失败）

**manual:bash 验收命令**：
```bash
# 验证 server.js 中重试逻辑的代码存在性
grep -n "attempt === 3\|process.exit(1)\|sendBark\|Brain FATAL" /workspace/packages/brain/server.js

# 期望输出含：
# - "attempt === 3" 或 "attempt < 3" 循环边界
# - "process.exit(1)" 在 attempt 3 失败后
# - "sendBark" 调用
# - "[Brain FATAL]" 或类似 fatal 告警字符串
```

---

### [BEHAVIOR-5] 346 SQL 文件：fingerprint 列 NOT NULL UNIQUE 约束在所有路径下成立

**触发条件**：346 迁移执行完毕（任意路径 A/B/完整表跳过）

**期望行为**：
- `information_schema.columns` 中 incidents.fingerprint 的 is_nullable = 'NO'
- `information_schema.table_constraints` 中存在 incidents 表的 UNIQUE 约束覆盖 fingerprint

**自动化验收**：`migration-346.integration.test.js` 各 describe 块均包含此断言

**manual:bash 验收命令**：
```bash
psql $DATABASE_URL -c "
SELECT
  c.column_name,
  c.is_nullable,
  c.data_type,
  (SELECT COUNT(*) FROM information_schema.key_column_usage kcu
   JOIN information_schema.table_constraints tc
     ON tc.constraint_name = kcu.constraint_name
   WHERE tc.table_name = 'incidents'
     AND kcu.column_name = 'fingerprint'
     AND tc.constraint_type = 'UNIQUE') AS unique_constraints
FROM information_schema.columns c
WHERE c.table_name = 'incidents' AND c.column_name = 'fingerprint';
"
# 期望：is_nullable=NO, data_type=text, unique_constraints=1
```

---

## 铁律核查清单

| Invariant | 覆盖 DoD 条目 | 状态 |
|-----------|-------------|------|
| INV-1：fingerprint TEXT NOT NULL UNIQUE | BEHAVIOR-1, BEHAVIOR-3, BEHAVIOR-5 | proposed |
| INV-2：同库运行两次无错误 | BEHAVIOR-2 | proposed |
| INV-3：空表改名不丢数据 | BEHAVIOR-1 | proposed |
| INV-4：非空表回填后无 NULL fingerprint | BEHAVIOR-3 | proposed |
| INV-5：最多 3 次重试 + exit(1) + Bark | BEHAVIOR-4 | proposed |

---

## CI 门禁

- brain-integration job（PostgreSQL service container）必须包含 `migration-346.integration.test.js`
- 所有 [BEHAVIOR] 自动化用例在 CI 通过才视为 DoD 达成
- manual:bash 验收命令由开发者在 staging 或 CI artifacts 中执行并截图/粘贴输出到 PR 描述

---

## 不在范围内

- incidents 表业务逻辑变更（仅结构修复）
- cecelia_dev / cecelia_preview_* 库的手动修复（PR 描述报告现状，但 migration 本身幂等后可安全重跑）
- 告警去重机制（sendBark dedupeKey 为 open question，本 sprint 不阻塞）
