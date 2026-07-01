# 设计文档：test_registry 生命周期治理（E2 工作项）

> 来源方案：`docs/current/harness-verify-redesign/E2-test-lifecycle-governance.md`
> harness 验证模型重构 T3=E2。本文档是可直接进入 writing-plans 的固化版本，已核对实际代码后修正一处引用。

## 背景

`test_registry` 表（1037 行）由 `scripts/scan/scan-test-registry.js` 纯 upsert 填充，只增不减：功能/文件删了，对应行永远留着成化石，CI 跑僵尸 test 且给出虚假覆盖率安全感。本设计补齐"识别 + 标记 + 告警"缺口，删除动作留给人/`/dev` 确认，绝不自动删有效 test。

## 架构

```
test_registry (1037行, +4列)
      ↑ 读
test-lifecycle-patrol.js  ──判定──→  file_missing / feature_deleted / stale_scan
      ↑ 挂载                              │
tick-runner.js 10.24                      ├─ file_missing   → UPDATE status='orphan' + 安全物理删该行
(isInPatrolWindow, 每日UTC02:00,          ├─ feature_deleted → UPDATE status='orphan'（不删文件）+ raise() + notion-create-issue.js
 fire-and-forget)                          └─ stale_scan     → 弱告警，不改 status
                                           └─ 自愈：此前 orphan 若信号消失 → 复位 active
```

## 组件

### 1. Migration `packages/brain/migrations/311_test_registry_lifecycle.sql`

Additive，风格对齐 `301_skill_drift_alerts.sql`/`310_preview_environments.sql`（文件头 `-- Migration N: 说明` + `IF NOT EXISTS`）：

```sql
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','orphan','deprecated'));
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS feature_id INTEGER
    REFERENCES journey_features(id) ON DELETE SET NULL;
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS orphan_reason TEXT;
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS lifecycle_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_test_registry_status ON test_registry (status);
CREATE INDEX IF NOT EXISTS idx_test_registry_feature_id ON test_registry (feature_id);

CREATE TABLE IF NOT EXISTS test_lifecycle_alerts (
  id            SERIAL PRIMARY KEY,
  file_path     TEXT NOT NULL,
  orphan_reason TEXT NOT NULL,
  feature_id    INTEGER,
  patrol_date   DATE NOT NULL,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_path, patrol_date)
);
```

`feature_id` 用 `ON DELETE SET NULL`（非 CASCADE）——能力删了不连带删 test 行，是否 orphan 由巡检判定。

### 2. `packages/brain/src/test-lifecycle-patrol.js`

导出 `runTestLifecyclePatrol(pool)`，算法：

1. 拉 `test_registry` 全量（`id, file_path, status, feature_id, scanned_at`）。
2. 逐行判定：
   - **file_missing**：`fs.existsSync(REPO_ROOT/file_path) === false`。
   - **feature_deleted**：`feature_id IS NOT NULL` 且该 id 在 `journey_features` 查不到。
   - **stale_scan**：`scanned_at < NOW() - 30天` 且文件仍在 → 只弱告警，不改 status。
   - `feature_id IS NULL` → 不判 feature_deleted（防误标），只走 file_missing / stale_scan。
3. file_missing → 物理删该行（零风险，文件本就不在磁盘）；feature_deleted → `UPDATE status='orphan', orphan_reason, lifecycle_checked_at=NOW()`，不删文件。
4. 自愈：本轮不再命中任何僵尸信号的既有 `orphan` 行 → 复位 `status='active', orphan_reason=NULL`。
5. 新增 orphan（feature_deleted 类）→ 写 `test_lifecycle_alerts`（`file_path+patrol_date` UNIQUE 去重）+ 调用 `../alerting.js` 的 `raise('P1', 'test_lifecycle_orphan_<reason>', message)`（**修正**：不是 `notifier.js`，与 `skill-drift-patrol.js` 同构）+ `node scripts/notion-create-issue.js --title --priority P1 --sub-area brain --body`。

### 3. 挂载 `packages/brain/src/tick-runner.js`

紧跟 `10.23 skill-drift 巡检`块（第 1701 行后，`} // end !MINIMAL_MODE` 第 1703 行前）插入：

```js
// 10.24 test 生命周期巡检（每天 UTC 02:00，孤儿 test → orphan + 告警，fire-and-forget）
if (isInPatrolWindow(now)) {
  Promise.resolve().then(() => runTestLifecyclePatrol(pool))
    .catch(e => console.warn('[tick] test 生命周期巡检失败:', e.message));
}
```

`isInPatrolWindow` 复用现有导入（来自 `./cron/skill-drift-patrol.js`），不重复实现。

## 实施后修正（与本文档早期草稿的出入，以此节为准）

1. **`feature_id` 不加 FK**：原方案写 `REFERENCES journey_features(id) ON DELETE SET NULL`。实现阶段发现：能力被删的瞬间 Postgres 会自动把 `feature_id` 置 NULL，而 `feature_id IS NULL` 按规则又不判 `feature_deleted`——两条规则叠加导致 `feature_deleted` 分支在正常删除路径下永远触发不到，变成死代码。最终改为**不加 FK 约束的纯 UUID 列**（软引用），巡检自己做存在性 JOIN 判断，能力删除后 `feature_id` 保留原值，巡检才能真正识别。migration 311 内联注释已写明这个决策理由，防止后人"好心"把 FK 加回去。
2. **Notion Issue 创建方式**：原方案写 `node scripts/notion-create-issue.js`。实际实现改为**巡检模块直接 `INSERT INTO issues` 表**（`notion_synced_at` 留 NULL），由既有 `notion-push-sync.js` 的 tick 任务自动同步——因为巡检本身运行在 Brain 同进程内，不必跨进程 shell 出子脚本。
3. **告警优先级**：实现用 `raise('P2', ...)`（非 P1）——孤儿 test 是"需要人确认但不紧急"的信号，不是生产事故级别，P2 更贴切。
4. **同日去重加固**：最终代码审查发现，巡检窗口(UTC 02:00-02:05)内 tick 若触发 2-3 次，会对同一 `feature_deleted` 行重复 `raise()` + 建 issue（`test_lifecycle_alerts` 的按天 UNIQUE 去重只挡住了重复写 alert 行本身，没有拦下后续动作）。修复：`INSERT INTO test_lifecycle_alerts ... RETURNING id`，只有真正插入成功（今天首次发现）才继续 `raise()`+建 issue；`UPDATE test_registry` 本身幂等，每次都执行不受影响。
5. **已知遗留（不阻塞本次交付，后续工作项）**：`staleAlerts`（stale_scan 弱告警）目前只是函数返回值，`tick-runner.js` 的 fire-and-forget 调用没有消费它，暂无出口（不写日志、不建 issue）。后续可在 tick-runner 里把返回值汇总打日志，或攒够阈值再告警。

## 数据流

`test_registry` 行 → 巡检读 → 分三类判定 → file_missing 直接改 DB；feature_deleted 改 DB + 落 `test_lifecycle_alerts` + 飞书(`alerting.raise`) + Notion Issue；stale_scan 只汇总不改库。

## 错误处理

- 巡检整体包在 tick 的 fire-and-forget `.catch` 里，任何异常不阻塞主 tick 循环，只打日志。
- `feature_id IS NULL` 保守分支：宁可漏判也不误标（关联回填不准是已知软肋）。
- 自愈复位避免一次误判永久钉死一条 test。

## 测试策略

- **Unit**（`test-lifecycle-patrol.test.js`，mock pool + mock fs）：file_missing→orphan、feature_deleted→orphan、stale_scan→弱告警不改status、feature_id IS NULL 不误标、orphan→active 自愈复位、24h/同日去重，共 6 个场景，含 `[BEHAVIOR]`。
- **Integration/E2E fixture**：构造"删一个 journey_features 行 + 对应 test 文件"的真实场景，跑一轮巡检，DB 断言该行 `status='orphan'`、`orphan_reason` 正确、`test_lifecycle_alerts` 有记录。
- **挂载点测试**：断言 `10.24` 存在、`isInPatrolWindow` 复用、fire-and-forget catch 生效（mock `runTestLifecyclePatrol` 抛错，断言 tick 循环不中断）。
- Migration 幂等性：`manual: node -e` 连库重复跑两次 migration 断言不报错 + 校验列/索引存在 + 存量行 `status='active'`。

## 风险

- DB migration 改生产核心表：本机 `/dev`、禁派 Codex；生产迁移 hk-vps + mmv 两台各自独立 postgres 都跑；migration 严格 additive。
- 绝不误删有效 test：只有 file_missing 才自动收敛（删的是 registry 行不是源文件本身，零证据损失）；feature_deleted 永远只告警，删文件走人工 `/dev`。
- 不改 scanner 新增逻辑、不改 `regression-contract.yaml` 格式，避免与本工作项范围外的 SSOT 打架。
