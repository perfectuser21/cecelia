# Contract Draft：Cecelia 承诺地图归位

**Task ID**: `f491a8dd-b0e3-4352-a5e0-6cb85df73d80`
**Sprint Dir**: `sprints/08101234-cecelia-map-reorg`
**决策依据**: `decisions.id = 4bc109e9-3b70-4b17-a1b4-bcd01bfae776`
**当前分支**: `cp-08101910-ws-f491a8dd`
**轮次**: 第 1 轮（首轮，无 reviewer feedback）
**生成时间**: 2026-08-10

---

## 一、合同范围

把 Cecelia `journeys` 表从「9 条工厂 journey 混装 + 1 条 infrastructure 独立」的错误结构，
归位为决策 4bc109e9 定死的正确结构：**2 条价值流 + 11 个 Capability + 横切件池 7 项**。

全部变更通过 migration 文件（397–400）落地，禁止手工 ALTER。

---

## 二、前置实测快照（合同基线）

### 2.1 journeys 表 active 行（迁移前）

| 简称 | ID 前缀 | name | biz_area |
|------|---------|------|----------|
| F0 | 743f0e7c | 工厂 · F0 提案拍板闭环 | cecelia |
| F1 | e6f803f2 | 工厂 · F1 开发闭环 | cecelia |
| F2 | 2fa4d085 | 工厂 · F2 部署闭环 | cecelia |
| F3 | ec4eb591 | 工厂 · F3 夜间体检 | cecelia |
| F4 | 91c17939 | 工厂 · F4 故障自愈 | cecelia |
| F5 | 8bb8252f | 工厂 · F5 指挥舱 | cecelia |
| F6 | 824ee0f5 | 工厂 · F6 收件箱归位 | cecelia |
| F7 | a824b567 | 工厂 · F7 记忆与知识 | cecelia |
| MJ5 | 51754939 | 工厂 · MJ5 承诺地图闭环 | cecelia |
| INFRA | 0c1f70f1 | 西安机群CI/RPA基础设施 | infrastructure |

### 2.2 结构性缺陷（迁移目标）

1. `journeys` 表无 `type` / `parent_journey_id` / `capability_code` 字段
2. 无法区分"价值流"与"Capability"——10 行全是同级平铺
3. `journey_features` 有 23 行 `journey_id=NULL`（历史孤儿）
4. F5/F6/F7 命名归"工厂"，但决策将其归入"管家"（需更名+重挂）
5. G3 晨报感知 / G5 战略 OKR 尚未存在（新立）
6. MJ1/[v1] 系列约 11 个 journey_features 无人搬家
7. 横切件 7 项无权威登记记录

---

## 三、目标结构（迁移后）

```
价值流：工厂（type='value_stream'）
  ├── F0  提案打磨（Capability，capability_code='F0'）
  ├── F1  开发闭环（Capability，capability_code='F1'）
  ├── F2  部署闭环（Capability，capability_code='F2'）
  ├── F3  夜间体检（Capability，capability_code='F3'）
  ├── F4  故障自愈（Capability，capability_code='F4'）
  └── MJ5 承诺地图（Capability，capability_code='MJ5'）

价值流：管家（type='value_stream'）
  ├── G1  指挥舱（原 F5，capability_code='G1'）
  ├── G2  收件箱（原 F6，capability_code='G2'）
  ├── G3  晨报感知（新立，capability_code='G3'）
  ├── G4  记忆知识（原 F7，capability_code='G4'）
  └── G5  战略 OKR（新立，capability_code='G5'）

横切件池（working_memory, key LIKE 'xcut::%'，共 7 项）：
  xcut::heartbeat         → owner=F1
  xcut::credential_chain  → owner=F1
  xcut::executor_pool     → owner=F1（含西安机群，原 INFRA）
  xcut::skill_dispatch    → owner=F1
  xcut::alert_chain       → owner=F4
  xcut::database          → owner=F1
  xcut::network           → owner=F1

西安机群（0c1f70f1）：status='deprecated'，type='capability'，并入 executor_pool 横切件
```

---

## 四、Migration 文件清单

| 编号 | 文件 | 内容摘要 |
|------|------|----------|
| 397 | `397_journey_capability_hierarchy.sql` | 新增 `journeys.type`、`parent_journey_id`、`capability_code` 字段 + 唯一索引 |
| 398 | `398_value_stream_seed.sql` | INSERT 工厂/管家价值流；UPDATE F0-MJ5 挂 parent；F5→G1/F6→G2/F7→G4 重命名+重挂管家；INSERT G3/G5；西安机群 deprecated |
| 399 | `399_orphan_features_triage.sql` | 孤儿 journey_features 按关键字分拣归位或打 deprecated；MJ1/[v1] 挂片处理；生成 migration_audit 记录 |
| 400 | `400_xcut_pool_register.sql` | working_memory 写入横切件池 7 项登记记录 |

每个 migration 均有对应 rollback 文件在 `migrations/rollback/` 目录。

---

## E2E 验收

### 5.1 验收查询（可直接粘贴进 psql / Brain API 验证）

**DOD-1：2 条 active 价值流**
```sql
SELECT COUNT(*) AS value_stream_count
FROM journeys
WHERE type = 'value_stream' AND status = 'active';
-- 期望：2
```

**DOD-2：工厂 6 个 Capability + 管家 5 个 Capability**
```sql
SELECT j.name AS value_stream, COUNT(c.id) AS cap_count
FROM journeys j
JOIN journeys c ON c.parent_journey_id = j.id
WHERE j.type = 'value_stream'
  AND c.type = 'capability'
  AND c.status = 'active'
GROUP BY j.name
ORDER BY j.name;
-- 期望：管家=5, 工厂=6（共 11 行）
```

**DOD-3：in_progress 任务锚点完整**
```sql
SELECT t.id, t.title, j.id AS journey_id, j.name AS journey_name
FROM tasks t
LEFT JOIN journeys j ON j.id = t.journey_id
WHERE t.status = 'in_progress';
-- 期望：journey_id 非 NULL 的行，journey_name 必须非 NULL（行存在）
```

**DOD-4：孤儿 journey_features 清零**
```sql
SELECT COUNT(*) AS null_journey_features
FROM journey_features
WHERE journey_id IS NULL AND status != 'deprecated';
-- 期望：0
```

**DOD-5：横切件池 7 项**
```sql
SELECT key, value->>'owner_capability_code' AS owner, value->>'guardian_status' AS status
FROM working_memory
WHERE key LIKE 'xcut::%'
ORDER BY key;
-- 期望：7 行，每行有 owner_capability_code 字段
```

**DOD-6：F1 分拣 audit 可查**
```bash
# migration_audit 记录（working_memory 存储）
curl -s http://localhost:5221/api/brain/memory/search \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"migration_audit feature triage"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('results',[])), 'audit records')"
# 期望：≥1 条 audit 记录，或检查 migration_audit.json 文件
```

**DOD-7：migration 文件存在（非手工 ALTER）**
```bash
ls packages/brain/migrations/397_*.sql \
   packages/brain/migrations/398_*.sql \
   packages/brain/migrations/399_*.sql \
   packages/brain/migrations/400_*.sql
# 期望：4 个文件均存在
```

**DOD-8：selfcheck EXPECTED_SCHEMA_VERSION=400**
```bash
grep "EXPECTED_SCHEMA_VERSION" packages/brain/src/selfcheck.js
# 期望：'400'
```

**DOD-9：CI 全绿**
```bash
gh pr checks --watch
# 期望：facts-check + version-sync + brain-ci 全部通过
```

### 5.2 一键验收脚本

```bash
# 运行合同测试
bash sprints/08101234-cecelia-map-reorg/tests/run-contract-tests.sh
# 期望：所有 9 个 DOD 检查 PASS，exit code 0
```

---

## 六、Invariant 覆盖矩阵

| Invariant | 约束 | 合同覆盖点 |
|-----------|------|-----------|
| INV-1 | 已有 journey 行不得 DELETE | migration 398/399 只用 UPDATE/INSERT，无 DELETE；rollback 对称 |
| INV-2 | in_progress 任务 journey_id 迁移后仍可解析 | DOD-3 SQL 验收；FR-8 锚点保护前置验证 |
| INV-3 | 全部 schema 变更走 migration 文件 | DOD-7 文件存在性检查 |
| INV-4 | 23 个孤儿归位或打 deprecated，禁止 DELETE | DOD-4 清零断言；migration 399 分拣规则 |
| INV-5 | migration 必须有 rollback SQL | 每个 migration 对应 rollback/ 目录下 .down.sql |
| INV-6 | selfcheck EXPECTED_SCHEMA_VERSION 更新至 400 | DOD-8 grep 验证 |
| INV-7 | 分拣规则机器可核查（migration_audit 记录） | DOD-6 audit 记录检查 |
| INV-8 | 横切件 7 项有可查询登记记录 | DOD-5 SQL 验收；7 项 working_memory 记录 |
| INV-9 | CI 全绿 | DOD-9 gh pr checks |

**覆盖率：9/9 铁律全覆盖。**

---

## 七、Out-of-Scope（明确排除）

- Dashboard UI 展示 2 条价值流（独立任务）
- F1 名下 46 个 journey_features 的逐一手工确认（399 脚本生成候选清单，人工复核后固化）
- ZenithJoy 仓库侧 journey 结构调整
- MJ1/[v1] 内容的业务价值判断（不做，只打 deprecated）
