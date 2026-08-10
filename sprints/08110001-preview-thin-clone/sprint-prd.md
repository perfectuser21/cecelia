# Sprint PRD：preview 环境瘦克隆

**任务 ID**: 62c1be9a-9a86-43ba-9a14-3046550de1a6  
**Sprint Dir**: sprints/08110001-preview-thin-clone  
**日期**: 2026-08-10  
**优先级**: P0  
**Golden Path 锚点**: factory/f1_devloop → keep-green

---

## 问题陈述

每个 PR preview 启动时，`scripts/preview-env-start.sh` Step 4 执行全量 `pg_dump|pg_restore` 克隆生产库（4.3GB）。其中约 3.65GB 来自纯历史/运行时表，preview 功能验证根本用不到，但每个 preview 都完整复制一份。

**实测数据（2026-08-10）**：7 个 preview 并发 = 25.6GB，磁盘使用率 83%。reaper/destroyer 回收器已全部修复健康，剩余单位成本问题未解。

---

## 目标

将 preview 克隆改为**瘦克隆**：历史表只建 schema 不拷数据，单 preview 库从 3.65GB 降至 <1GB。

**副收益**：克隆从 50s+ 大幅缩短，缓解 preview 卡 starting 超时抖动。

---

## 不包含

- 主库 memory_stream 保留/归档策略（待主理人拍板，另立任务）
- preview 并发容量阈值调整（capacity-gate 不动）

---

## 实现方案

### 目标文件

`scripts/preview-env-start.sh`，第 230-234 行（pg_dump|pg_restore 管道）

### 当前代码（第 230-234 行）

```bash
if PGPASSWORD="${DB_PASSWORD:-cecelia}" pg_dump \
    -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" -Fc cecelia 2>>"$LOG_FILE" \
    | PGPASSWORD="${DB_PASSWORD:-cecelia}" pg_restore \
      -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
      --no-owner --no-acl -d "$DB_NAME" 2>>"$LOG_FILE"; then
```

### 变更方案

在 `pg_dump` 命令中加入 `--exclude-table-data` 参数，排除以下 7 张历史/运行时表的数据（仅保留 schema）：

| 表名 | 实测大小 | 说明 |
|------|---------|------|
| `memory_stream` | 2160MB | Brain 运行时记忆流 |
| `cecelia_events` | 500MB | 事件历史日志 |
| `alertness_metrics` | 403MB | 报警指标历史 |
| `checkpoint_writes` | 260MB | LangGraph 遗留 checkpoint |
| `checkpoint_blobs` | 158MB | LangGraph 遗留 blob |
| `checkpoints` | 117MB | LangGraph 遗留 checkpoints |
| `captures` | 78MB | 截图/捕获历史 |

**合计排除**: ~3.68GB

**保留全量数据的业务表**：`tasks`、`decisions`、`journeys`、`journey_features`、`golden_paths`、`preview_environments` 等所有业务表照旧。

### 修改后命令结构

```bash
THIN_CLONE_EXCLUDE=(
  memory_stream cecelia_events alertness_metrics
  checkpoint_writes checkpoint_blobs checkpoints captures
)
EXCLUDE_ARGS=()
for t in "${THIN_CLONE_EXCLUDE[@]}"; do
  EXCLUDE_ARGS+=(--exclude-table-data="$t")
done

if PGPASSWORD="${DB_PASSWORD:-cecelia}" pg_dump \
    -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" -Fc cecelia \
    "${EXCLUDE_ARGS[@]}" 2>>"$LOG_FILE" \
    | PGPASSWORD="${DB_PASSWORD:-cecelia}" pg_restore \
      -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
      --no-owner --no-acl -d "$DB_NAME" 2>>"$LOG_FILE"; then
```

---

## 测试计划

### 1. 单测：验证克隆命令含排除参数

**文件**: `scripts/__tests__/preview-env-start.test.sh`（在现有测试文件中追加 Case）

**用例 A：pg_dump 调用含 --exclude-table-data 名单**
- 增强现有 mock `pg_dump`，记录完整调用参数到 marker 文件
- 断言：7 张历史表每张都出现在 `--exclude-table-data=<tablename>` 参数中
- 断言：业务表（tasks、journeys）不在排除参数中

**用例 B：排除表在克隆库中 schema 存在但数据为空**（集成层，需真实 psql）
- 在 CI `local_api` 环境中，克隆完成后查询：
  ```sql
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN
  ('memory_stream','cecelia_events','alertness_metrics',
   'checkpoint_writes','checkpoint_blobs','checkpoints','captures');
  -- 期望：7
  SELECT count(*) FROM memory_stream;
  -- 期望：0（schema 存在，数据为空）
  ```

### 2. E2E：真起一个 preview 验证

执行脚本路径：`packages/brain/scripts/smoke/preview-env-smoke.sh` 或独立验证脚本

**E2E 断言列表（全部必须真验）**：

| 编号 | 断言 | 验证命令 | 通过条件 |
|------|------|---------|---------|
| E1 | preview 库总大小 < 1GB | `psql -c "SELECT pg_database_size('${DB_NAME}')"` | 返回值 < 1073741824（bytes） |
| E2 | 排除表 schema 存在（7张） | `SELECT count(*) FROM information_schema.tables WHERE table_name IN (...)` | count = 7 |
| E3 | 排除表数据为空 | `SELECT count(*) FROM memory_stream` 等 | 每张 count = 0 |
| E4 | 业务表行数与主库一致 | 对比 tasks/journeys 行数 | preview 库行数 >= 主库（允许新增但不得丢失） |
| E5 | preview Brain health | `curl http://localhost:${PORT}/health` | HTTP 200 |
| E6 | Brain selfcheck 通过 | `curl http://localhost:${PORT}/api/brain/selfcheck` | 无 schema 版本错误 |
| E7 | 既有冒烟 PASS | 复用 `preview-environments-smoke.sh` | exit 0 |
| E8 | CI 全绿 | GitHub Actions brain-ci.yml + engine-ci.yml | 所有 checks green |

### 3. 出错回退路径

若排除名单某表被 preview 功能真实依赖（Brain 启动失败 / 接口 500）：
- 从 `THIN_CLONE_EXCLUDE` 数组移除该表
- 在 PR 描述中注明：`[thin-clone] 从排除名单移除 <table_name>，原因：<error>`
- 重新运行 E2E 验证

---

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 排除表是否安全 | 猜测 / preview 起后跑真实冒烟 | 起 preview 后跑既有 health + 冒烟断言 | 空表 ≠ 缺表，schema 完整，应用不崩 | preview 假绿——由既有 assert-deploy-effect 兜底 |
| 库大小是否达标 | 估算 / psql 实测 | psql `pg_database_size()` 实测并记录原始数字 | 必须有真实证据，不能靠推算 | 无法知道是否真正解决磁盘压力 |

---

## 不变量（Invariants）

1. **排除表 schema 必须存在**：pg_dump 不加 `--exclude-table`，只加 `--exclude-table-data`，确保 DDL 完整导出
2. **业务表数据完整性**：tasks、decisions、journeys、journey_features、golden_paths、preview_environments 行数与主库一致
3. **Brain 不崩**：preview Brain 的 selfcheck + migrations 对空的历史表必须无异常
4. **幂等性**：多次执行 preview-env-start.sh 仍产出正确的瘦克隆库
5. **排除名单版本化**：THIN_CLONE_EXCLUDE 数组定义在脚本顶部，不散落在 pg_dump 参数行

---

## 功能需求（FR）

| FR编号 | 需求描述 |
|--------|---------|
| FR-01 | preview-env-start.sh 的 pg_dump 命令加入 --exclude-table-data 参数，覆盖 7 张历史表 |
| FR-02 | 排除表名单以数组变量形式集中管理，位于脚本顶部常量区 |
| FR-03 | 排除操作日志记录：log 输出当前排除表名单（方便回溯）|
| FR-04 | 新增 preview-env-start.test.sh Case：验证 pg_dump 调用含完整排除参数 |
| FR-05 | 新增 E2E 验证断言：psql 实测 pg_database_size < 1GB |
| FR-06 | 新增 E2E 验证断言：排除表 schema 存在且 count=0 |
| FR-07 | 新增 E2E 验证断言：业务表行数与主库一致 |

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `scripts/preview-env-start.sh` | 修改 | Step 4 pg_dump 加 --exclude-table-data 参数组 |
| `scripts/__tests__/preview-env-start.test.sh` | 修改 | 追加 thin-clone 专项 Case |

---

## 验收标准（Final E2E，必须真验）

- [ ] 单测：`preview-env-start.test.sh` 中新增 Case 验证 pg_dump 参数含 7 张历史表的 `--exclude-table-data`，且业务表不在排除参数中
- [ ] 集成：排除表在克隆库中 schema 存在（count=7）、数据为空（每张 count=0）
- [ ] 真起 preview：`psql -c "SELECT pg_database_size('${DB_NAME}')"` 返回值 < 1073741824（bytes），原始数字写进 PR 证据
- [ ] 该 preview 的 Brain health 200 + selfcheck 无 schema 错误
- [ ] 既有冒烟 `preview-environments-smoke.sh` PASS
- [ ] 业务表数据完整：tasks 和 journeys 行数与主库一致（PR 证据附对比数字）
- [ ] CI 全绿（brain-ci.yml + engine-ci.yml）

---

## 统计

- **Invariants**: 5
- **功能需求（FR）**: 7
- **PRD 总行数**: ~140
