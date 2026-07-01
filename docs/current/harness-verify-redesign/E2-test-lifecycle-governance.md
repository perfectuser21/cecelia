# E2：Test 生命周期治理

> harness 验证模型重构 · 工作项 E2
> 目标：给"删+维护"这一侧补机制——功能删了，它的 test 要能被识别、标记、告警、剪除，不再让孤儿 test 无限攒。
> 本文只做设计，不改代码、不 commit。

---

## 问题现状

### CI 只管"加"，不管"删"

现有 CI 与 registry 体系在"新增测试"侧是健全的（DoD 强制 `[BEHAVIOR]` test、feat PR 必带 `*.test.ts`、scanner 自动索引）。但**删除/维护侧是空白**：

- 功能被删（代码删除、`journey_features` 行删除），它对应的 test 文件、`test_registry` 行、`regression-contract.yaml` 条目**没有任何机制跟着清理**。
- 结果：孤儿 test 越攒越多，CI 里跑着一批"测一个已经不存在的功能"的僵尸 test，既拖慢 CI、又给出虚假的"覆盖率"安全感。

### `test_registry` 的真实结构（已查库确认）

- 表：`test_registry`，当前 **1037 条**记录。
- 列（8 个）：`id, file_path, test_count, covered_behaviors, area, test_type, scanned_at, created_at, updated_at`。
- **没有 `status` 列**（无法标 active/orphan/deprecated）。
- **没有指向能力表 `journey_features` 的外键/关联字段**（test 与它验证的能力之间没有连线）。
- **grep 全仓库找不到任何 delete / deprecate / orphan / 清理逻辑**。

### 它是怎么被填的（`scripts/scan/scan-test-registry.js`）

- scanner 递归扫 `packages / apps / sprints` 下所有 `*.test.(ts|js)` / `*.spec.(ts|js)` 文件。
- 每个文件抽出 `it()/test()` 标题作为 `covered_behaviors`，`INSERT ... ON CONFLICT (file_path) DO UPDATE` 刷新 `scanned_at`。
- **纯 upsert，只增不减**：文件从磁盘删了，scanner 根本不会遍历到它，于是那条 registry 行**永远留着**（`scanned_at` 停在最后一次扫到的时间，成为化石）。这正是孤儿累积的机制。

### 对比：能力表是活台账，test 表不是

`journey_features`（kind=ability/feature）是能力的活台账——功能删了，那一行会被删。而 `test_registry` 与它**完全脱钩**：既不知道自己在验证哪个能力，也不知道那个能力还活不活。两张表之间缺一条"test → 能力"的边。

---

## 目标

1. 给 `test_registry` 增加**生命周期状态**（`active / orphan / deprecated`）和**与能力的关联**，让每条 test 记录知道"我验证谁 / 我还该不该存在"。
2. Brain tick 挂一个**定期巡检**：交叉比对 test ↔ 磁盘文件 ↔ 活 `journey_features` / `golden_path`，识别三类僵尸：
   - **文件已删**（磁盘上没有了，registry 还在）；
   - **能力已删**（关联的 `journey_features` 已不存在/已归档）；
   - **长期未被扫到**（`scanned_at` 陈旧，疑似 stale）。
3. 识别出的僵尸 → 标 `orphan` + **告警**（飞书/Notion Issue）+ 生成**剪除建议**；剪除动作**默认告警等人确认，不自动删 test 文件**（见下"告警 vs 自动剪"）。

非目标：本工作项不重写 scanner 的新增逻辑、不动 `regression-contract.yaml` 的格式（只在建议里列出需同步清理的条目）。

---

## 具体改动

### 1. Migration：加列 + 加索引（新建 `311_test_registry_lifecycle.sql`）

沿用仓库既有 migration 风格（幂等 `IF NOT EXISTS`，参考 `301_skill_drift_alerts.sql`）。**全部 additive，不动存量数据、不删列**：

```sql
-- Migration 311: test_registry 生命周期治理
-- 给 test_registry 加 status + 与能力(journey_features)的关联 + 巡检审计字段。
-- 全 additive：不改存量行语义，存量默认 active。
-- 运行: psql $DATABASE_URL < packages/brain/migrations/311_test_registry_lifecycle.sql

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','orphan','deprecated'));

-- test → 能力 的软关联。用 nullable FK（ON DELETE SET NULL），
-- 能力被删时 test 不级联消失、只是 feature_id 变 NULL，交给巡检去判 orphan。
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS feature_id INTEGER
    REFERENCES journey_features(id) ON DELETE SET NULL;

-- 巡检审计：为什么被标 orphan / 何时标的 / 谁标的
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS orphan_reason TEXT;      -- file_missing | feature_deleted | stale_scan
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS lifecycle_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_test_registry_status
  ON test_registry (status);
CREATE INDEX IF NOT EXISTS idx_test_registry_feature_id
  ON test_registry (feature_id);
```

要点：
- `status` 默认 `active`，存量 1037 行迁移后语义不变。
- `feature_id` 用 `ON DELETE SET NULL`（**不是 CASCADE**）——能力删了绝不连带删 test 行，避免"删能力顺手灭证据"。是否 orphan 由巡检判定，人保留裁量。
- `orphan_reason` 记录判定依据，供告警/审计追溯。

关联怎么补（`feature_id` 从哪来）：存量 1037 行的 `feature_id` 初始为 NULL。回填分两条路，**都不在本 migration 里做**（migration 只加空列）：
- 优先：`golden_path` 表已有 `owner_task_id → task → tasks.ability_id → journey_features`，巡检可顺这条链把 test 文件所属能力推断出来（test 文件常与 sprint/task 同目录）。
- 兜底：scanner 后续增强时，从 test 文件路径/所在 sprint 目录解析出 initiative/task，再映射到能力；无法解析的保持 NULL，巡检对 NULL 的处理见下。

### 2. 巡检逻辑：挂 Brain tick（新建 `packages/brain/src/test-lifecycle-patrol.js`）

**挂点**：`packages/brain/src/tick-runner.js` 的 `10.x 自动调度` 区块，紧跟 `10.23 skill-drift 巡检`（约 line 1697）新增 `10.24`，完全复刻 skill-drift 的 `isInPatrolWindow(now)` + `Promise.resolve().then(...)` fire-and-forget 模式：

```js
// 10.24 test 生命周期巡检（每天 UTC 02:00 = 北京 10:00，孤儿 test → orphan + 告警，fire-and-forget）
if (isInPatrolWindow(now)) {
  Promise.resolve().then(() => runTestLifecyclePatrol(pool))
    .catch(e => console.warn('[tick] test 生命周期巡检失败:', e.message));
}
```

选每日一次而非每 tick：全仓 test 交叉比对是重活，且 test 集合变化慢，日频足够。带**内存 24h 去重 + DB 幂等 sentinel**（复用 credentials-health / skill-drift 的既有 pattern），避免同一天重复告警。

**巡检算法**（每次运行）：

1. 拉 `test_registry` 全量（`file_path, status, feature_id, scanned_at`）。
2. 对每行判定：
   - **file_missing**：`fs.existsSync(REPO_ROOT/file_path) === false` → 磁盘已删。这是最硬、最无歧义的僵尸信号（scanner 只增不减留下的化石）。
   - **feature_deleted**：`feature_id IS NOT NULL` 且该 id 在 `journey_features` 中已不存在，或对应能力已 archived。
   - **stale_scan**：`scanned_at < NOW() - INTERVAL '30 days'` 且文件仍在——疑似 scanner 没扫到（路径变更/被排除），列**弱告警**，不直接标 orphan（避免误伤）。
   - `feature_id IS NULL`（未回填关联）：**不判 feature_deleted**（无关联≠能力被删），只走 file_missing 与 stale_scan 两条硬信号，防止大面积误标。
3. 命中 file_missing 或 feature_deleted → `UPDATE test_registry SET status='orphan', orphan_reason=$reason, lifecycle_checked_at=NOW()`。
4. 汇总本轮新增 orphan 列表 → 写 `test_lifecycle_alerts`（或复用 issues）+ 飞书通知 + 生成剪除建议清单（含：待删 test 文件、待删 registry 行、疑似需同步清理的 `regression-contract.yaml` 条目）。
5. **自愈反向**：若一条此前被标 `orphan` 的记录，本轮发现文件又回来了 / 能力又活了 → 复位 `status='active', orphan_reason=NULL`（避免误标永久钉死，参考 probe/rumination self-heal grace 的教训）。

**告警落库表**（可选，新建 `test_lifecycle_alerts`，或直接建 Notion Issue）：仿 `skill_drift_alerts`，按 `file_path + patrol_date` 去重：

```sql
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

### 3. 告警 vs 自动剪除（分级，默认不自动删）

剪除 = 删 test 文件 + 删 registry 行 + 删 `regression-contract.yaml` 条目，属**破坏性、跨 SSOT** 动作。采用**分级策略**：

| 信号 | 置信度 | 动作 |
|------|--------|------|
| `file_missing`（磁盘已无此文件） | 极高（文件本来就没了） | **自动收敛**：直接把 registry 行标 `orphan` 并可安全物理删该行（行指向的文件已不存在，删行不损失任何 test）。**不涉及删文件**，零风险。 |
| `feature_deleted`（能力删了、test 文件还在） | 中 | **只告警 + 建议，不自动删文件**。生成 Notion Issue + 飞书，附剪除清单；由人/后续 `/dev` 任务确认后走正式删除流程（删 test 是改代码 = 走 `/dev`，修 test 必须 commit 的规则同样约束"删 test"）。 |
| `stale_scan` | 低 | **弱告警**（汇总进日报），不改 status。 |

**为什么 `feature_deleted` 不自动删文件**：
- 能力从 `journey_features` 删掉，不等于那段代码/那个 test 一定无用（可能只是台账重组、能力合并、`feature_id` 关联本身回填得不准）。
- 删 test 是不可逆的证据销毁；`golden_path` scope 反复掉坑（把多能力误当一条 path）的历史说明关联判定本身有出错空间。
- 全局规则：改代码走 `/dev`、bug-fix 的 test 必须永久留 CI。删 test 同样应过 `/dev` + 人确认，绝不由 tick 后台静默 `rm`。

Brain 的角色是**发现 + 标记 + 建议**，把"该不该真删"这一刀留给人/`/dev`。唯一自动收敛的是 file_missing 那种"文件早没了、行是纯化石"的零风险清理。

---

## DoD

- [ ] Migration `311_test_registry_lifecycle.sql` 幂等（重复跑不报错），`test_registry` 新增 `status / feature_id / orphan_reason / lifecycle_checked_at` 四列 + 两个索引；存量 1037 行 `status` 全为 `active`。
  - `manual: node -e "..."` 连库校验列存在（CI 兼容写法）。
- [ ] `test-lifecycle-patrol.js` 单测（mock pool + mock fs）：覆盖 file_missing → orphan、feature_deleted → orphan、stale_scan → 弱告警、feature_id IS NULL 不误标、orphan→active 自愈复位、24h 去重 6 个场景。含 `[BEHAVIOR]` 条目。
- [ ] tick-runner.js `10.24` 挂载点存在，`isInPatrolWindow` 复用，fire-and-forget catch 不阻塞 tick。
- [ ] 巡检对 file_missing 行执行安全物理删/标记；对 feature_deleted 行只标 orphan + 建 Notion Issue（不删文件）——用一个能构造出"磁盘无此文件 + 能力已删"的 fixture 断言两条路径行为不同。
- [ ] 告警去重：同一 `file_path` 同一天不重复告警（`test_lifecycle_alerts` UNIQUE 或内存 sentinel）。
- [ ] 造一个"删掉一个 `journey_features` + 它的 test 文件"的端到端 fixture，跑一轮巡检，DB 查到该 test 行 `status='orphan'`、`orphan_reason` 正确、Notion Issue 已建。

## 依赖

- **`journey_features` 是能力唯一活台账**（`abilities` 表已删，2026-06-09）；`feature_id` FK 必须指向 `journey_features(id)`，不得指向 legacy `journey_steps`。
- **`golden_path.owner_task_id → tasks.ability_id → journey_features`** 这条链是 `feature_id` 回填的主路径（`303_golden_path_owner_task_model.sql` 已建）。
- scanner `scripts/scan/scan-test-registry.js`：巡检与它是"读/判"与"写/增"的分工；后续若要让 scanner 主动标记消失文件（而非等巡检），是本设计的可选增强，但**不改 scanner 是本工作项的边界**。
- Brain tick 既有巡检 pattern（`skill-drift` / `credentials-health`）：直接复用 `isInPatrolWindow`、fire-and-forget、内存去重 + DB sentinel 幂等，不重新发明调度。
- 通知：复用 `notifier.js`（飞书）+ `scripts/notion-create-issue.js`（sub-area = engine/brain）。

## 风险与注意

- **DB migration = 核心任务**：`311` 改的是 1037 行的生产表，必须本机 `/dev`、禁派 Codex。生产迁移需 `hk-vps` + `mmv` 两台各自独立 postgres 都跑（见全局规则），本机 + 生产分别执行。migration 严格 additive + `IF NOT EXISTS`，不动存量列、不删数据。
- **绝不误删有效 test**：这是本设计第一红线。
  - 只有 `file_missing`（文件本就不在磁盘）才允许自动收敛，且删的是 registry 行不是文件——零证据损失。
  - `feature_deleted` 永远只告警 + 建议，删文件走 `/dev` + 人确认；bug-fix regression test 必须永久留 CI 的规则对"删 test"同样生效。
  - `feature_id IS NULL` 一律不判 feature_deleted，防止"关联没回填"被误当"能力已删"造成大面积误标。
- **误标要能自愈**：文件/能力回归后 status 必须能复位 active（参考 probe/rumination self-heal 的 grace period 教训，避免一次误判永久钉死一条 test）。
- **关联回填的准确性是软肋**：`golden_path` scope 反复被误解（把一条 line 下多个 ability 排序当成一条 path）的历史提醒——`feature_id` 推断错会导致误判 feature_deleted。故回填不准时宁可留 NULL（走保守分支），也不硬猜。
- **`regression-contract.yaml` 只列建议不自动改**：它是另一处 SSOT，同步清理由人/`/dev` 完成，巡检只在剪除建议里点名待清条目，不后台改文件。
- **别和 scanner 打架**：scanner 只增不减、巡检负责减。若未来让 scanner 也标记消失文件，两者的 status 写入要约定唯一 owner（建议：scanner 只写 active/刷新 scanned_at，status 的 orphan 判定唯一 owner 是巡检），避免互相覆盖。
