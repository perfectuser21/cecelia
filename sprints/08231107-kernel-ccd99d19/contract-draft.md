# Sprint Contract Draft (Round 1) — 投影物化两阶段原子化（capability 节点全部写完再翻转 active）[r54]

**锚定父路声明**: 独立小路（无父路）—— kernel 内部投影引擎（`packages/brain/src/map/`）时序修复，无用户可见父 Golden Path；影响 capability = F1（开发闭环，map_scope=["F1"]，map_repo=null → radius must_run 未配置，标 [MAP_NOT_CONFIGURED]）。
**journey_type**: autonomous
**target_environment**: local_api（改动仅 `packages/brain/src/map/` 纯后端；本 attempt `postgres:false`，评估器 oracle 走 vitest 单测真跑，无需活库）

## Response Schema（推导来源: PRD 明确 — N/A）

N/A — 任务无 HTTP 响应（纯 kernel 内部投影物化时序 + DB 写路径 + 读谓词语义锁定，无新增/变更端点）。Reviewer 第 6 维按 N/A 满分。

---

## Golden Path

[rescan 触发某 scope 投影换代] → [projector 以 materializing 中间态写新 run + 全量物化节点/边] → [单事务翻转 new=active + old=superseded] → [读取侧只见完整投影：旧全量或新全量，materializing 残行永不可见]

### Step 1: rescan 触发投影换代，projector 开始生成新 run
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条（scheduler rescan 触发某 scope 投影换代，projector 开始生成新 run）。

**可观测行为**: `runProjection({ client, manifestId, scopeKey, manifest, ... })` 在既有事务连接上开始写投影；旧 active run 在整个物化期间保持 active 可读。

**验证命令**（单测录制 client 捕获真实发往 DB 的 SQL 序列）:
```bash
(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "materializes all nodes and edges before the active flip" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: 全部 `map_projection_nodes`/`map_projection_edges` 的 INSERT 索引 < `UPDATE ... status='active'` 索引（物化在翻转前完成）。

---

### Step 2: 新 run 以 `status='materializing'` 中间态写入，全量物化后单事务原子翻转
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 假设 1/2（新 run 以 `status='materializing'` 写入 → 物化全部节点/边 → 单事务内翻转 `new='active'` + 旧 active `='superseded'`）。

**可观测行为**:
1. `runProjection` 的 run 行 INSERT 使用 `status='materializing'`（替换现行 `'building'`；不新增第三种并存中间态）。
2. schema 侧：新增 migration 把 `map_projection_runs.status` 的 `CHECK (status IN (...))` 扩展纳入 `'materializing'`，并把 `map_projection_run_activation_shape` CHECK 的「`activated_at IS NULL`」分支纳入 `'materializing'`（当前分支为 `status IN ('building','failed')`）。
3. 翻转在同一事务内：`UPDATE ... status='superseded' WHERE scope_key=$ AND status='active'` + `UPDATE ... status='active', activated_at=NOW() WHERE id=$newRun`，均发生在全部节点/边写入之后。唯一部分索引 `idx_map_projection_one_active_per_scope (scope_key) WHERE status='active'` 天然保证「每 scope 至多一个 active」。

**验证命令**:
```bash
# 2a. run 写入使用 materializing（当前实现为 'building' → RED；实现后 GREEN）
(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "writes the new run with materializing status" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"
# 2b. 单事务翻转：supersede 旧 active + activate 新 run，均在物化之后
(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "supersedes old active and activates new run in one flip" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"
# 2c. migration 把 materializing 纳入 status CHECK（[ARTIFACT] 文件内容断言）
node -e "const fs=require('fs');const g=require('child_process').execSync('ls packages/brain/migrations/*_map_projection*materializing*.sql packages/brain/migrations/*materializing*.sql 2>/dev/null || true').toString().trim();if(!g){console.error('FAIL: 缺 materializing 迁移');process.exit(1)};const c=fs.readFileSync(g.split('\n')[0],'utf8');if(!/materializing/.test(c)){console.error('FAIL: 迁移未含 materializing');process.exit(1)};console.log('OK')"
```
**硬阈值**: 2a/2b vitest 均 `≥1 passed`；2c 迁移文件存在且含 `materializing`。

---

### Step 3: 读取侧只选 active（materializing 残行永不可见），换代任一时刻读到全量旧或全量新
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 + 「边界情况」（读取侧只选 `status='active'`；换代过程中任一读取得到旧全量或新全量，绝不部分集；materializing 残行不参与读取）。

**可观测行为**:
- `getActiveProjection` / active run 选择只命中 `status='active'`（`capabilityNodes(runId)` 依赖的 active run 由此选出，故永远拿到完整节点集）。
- `getProjectionForRevision`（不可变历史合同用）保持 `status IN ('active','superseded')`——**必须继续可读 superseded**（回归约束：radius.test.js「keeps an old contract runnable from its superseded immutable base snapshot」），但**绝不纳入 materializing/building**。
- 物化中途崩溃留下的 `materializing` 残行对两条读路径均不可见；旧 active 继续服务，下轮 rescan 清理残行。

**验证命令**:
```bash
# 3a. active 选择排除 materializing 残行
(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "selects only active runs never materializing residuals" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"
# 3b. revision 查找永不返回 materializing 残行（且仍可读 superseded）
(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "never returns a materializing residual run" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: 3a/3b vitest 均 `≥1 passed`。

---

## 已知约束（来自回归测试 + 累积 FR）

- [radius.test.js] `keeps an old contract runnable from its superseded immutable base snapshot` → `getProjectionForRevision` **必须继续返回 superseded** 投影；本 sprint 只禁 materializing/building 进读路径，不得把该函数收窄为 active-only（否则回退历史合同能力）。
- [radius.test.js] `resolves Structure Gate capability seeds only through the active projection` → capability seed 只经 active 投影解析；active 选择加 materializing 会让部分集泄漏，禁止。
- [projector.test.js] `buildStructuralProjection` 一族纯函数测试不碰 DB，本 sprint 不动其行为（digest 确定性、节点/边计数不变）。
- [migration-405-map-projection.test.js] 断言 405 up SQL 含 `CREATE UNIQUE INDEX ... ON map_projection_runs (scope_key) ... WHERE status='active'`——新增 migration 不得破坏该唯一索引语义（仍是每 scope 一个 active）。
- [累积FR] 本 line（journey e6f803f2）内 ability 均 planned，无 done/working 历史，无额外累积 FR（context-manifest 空）。
- [#5017] 空集瞬态兜底（`projection_capabilities_empty → unknown`）保留不动；本 sprint 只补「部分集」漏洞。
- [MAP_NOT_CONFIGURED] map_repo=null → radius must_run_assertions 未配置，不注入领域硬编码断言。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 投影换代改两阶段：新 run 以 `materializing` 写入并全量物化节点/边后，单事务翻转 new=active + old=superseded；读取侧只选 active（materializing 不可见）。 |
| **NFR（做得多好）** | 性能/可靠性 | 物化中途崩溃不影响读取（旧 active 持续服务），残行下轮 rescan 清理；rescan 周期 ~10min 不改；超时无 PRD 显式阈值（N/A）。 |
| **Invariant（永不违反）** | 不变量 | 任一时刻每 scope 至多一个 active（唯一部分索引已保证）；读取侧看到的永远是完整投影（旧全量或新全量），绝不部分集；materializing/building 中间态对读者不可见。 |
| **判定点（怎么知道）** | 见下方登记表 | 见「判定点登记表」 |
| **保质期（何时过期）** | 失效/退役 | materializing 残行为瞬态，下轮 rescan（~10min）清理；投影本身可重建（405 注释：derived，可删可重建）。 |
| **死亡告警（停了谁知道）** | 告警 | 投影换代属 scheduler 周期任务；换代失败 → 旧 active 继续服务且 materializing 残行可查（`SELECT ... WHERE status='materializing'`），无需静默；N/A 独立新告警（沿用现有 scheduler 失败可观测）。 |
| **失败语义（挂了怎么办）** | 见下方声明 | 见「失败语义声明」 |
| **效果确认（已发≠已生效）** | 回执 | 翻转生效 = 单事务内 new 行 `status='active' AND activated_at IS NOT NULL`；读取侧命中的 run 必可判定 status。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 新投影是否物化完整、可翻转 active | A. 读取侧计数节点数≥期望；B. 中间态 status 标记 + 单事务内全量写完后才翻 active | B. `materializing` 中间态 + 单事务原子翻转 | 事务原子性保证 all-or-nothing，读者只在 active/superseded 边界可见，无需读侧计数猜测 | 部分集被读 → radius 漏 claim 误判 → 确定性杀 run（r43/r44 双死） |
| 换代中读取命中哪张图 | A. 时间戳挑最新；B. 只选 status='active' | B. 只选 `status='active'`（active 选择路径） | 唯一部分索引保证每 scope 一个 active，status 即权威 | 命中 materializing 残行 → 半张图 |

> （示例：本表首行 ⚠️ 判定点误判后果严重（杀 run），但 r43/r44 案卷已确认修复方向为「两阶段原子化」，PrepPRD 阶段方向已定，非需临时请教用户的新歧义；仍标 ⚠️ 供账本保鲜索引。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 物化中途崩溃（事务未提交） | 事务回滚或留 `materializing` 残行；new 未 active，旧 active 保持 | 是（projection_digest 确定性，重跑产同图同 digest） | 读取侧 fail-closed 到旧 active（继续服务）；下轮 rescan 清理残行 |
| 读取遇 materializing 残行 | 读谓词过滤，不返回残行 | 是 | 命中旧 active（若无 active 则空集 → #5017 瞬态兜底 unknown） |

### 输入对抗面

N/A — 纯 kernel 内部投影引擎，非对外暴露 agent/接口，无外部可写输入面。

---

## 禁 mock 边清单

- **projector.js 代码 ↔ `map_projection_runs` 表（status 写路径 + 单事务翻转）**：本单改写路径。冻结 RED/GREEN 单测在**真实 DB 驱动接缝**上断言——`runProjection` 的注入事务 `client`（`recordingClient`）捕获 projector **真实发往 Postgres 的 SQL/status/顺序**，不 mock 相邻业务模块（manifest-store/radius 等）；断言对象是代码真实产出的 INSERT/UPDATE 语句，而非替身返回值。
- **读取谓词 ↔ `map_projection_runs` 表（status 过滤）**：`getActiveProjection`/`getProjectionForRevision` 单测用 **status-aware 假 pool**——按 SQL 里真实的 status 谓词（`status='active'` / `IN(...)`）过滤内存行；改动谓词泄漏 materializing 会让断言真实转红（非硬编码返回值），因此仍锁在被改的那条边上。
- **真 Postgres 补位（本 attempt postgres:false，评估器不跑；brain-integration CI 跑）**：原子交换 + 崩溃残行不可见的真库验证由 generator 交付 `packages/brain/src/__tests__/integration/map-projection-two-phase.pg.integration.test.js`（真 PG、真事务、真 CHECK 约束），见「未覆盖真实链路清单」。

> 说明：本 attempt `runtime_resources.postgres=false` 且仓库 vitest `test.root=packages/brain`、include 不含 `sprints/**`——评估器可跑的 oracle 只能是无 DB 单测（与仓库 brain-unit「vi.mock('db.js') 纯单测」惯例一致）；真 PG 断言按 skill 9.12 escape 落 integration/brain-integration。空清单不适用（本单触及 DB 写路径 + 状态机）。

---

## 未覆盖真实链路清单

- **真 PG 原子交换 + 崩溃残行不可见**｜被 postgres:false（评估器）+ 仓库单测惯例顶替为无 DB 单测｜**补位计划**：generator 交付 `packages/brain/src/__tests__/integration/map-projection-two-phase.pg.integration.test.js`（模型见 `map-manifest-store.integration.test.js`：`TEST_DATABASE_URL` + `_test/_scratch` 库名守卫 + 真 migration），brain-integration CI job 起真 Postgres 跑；覆盖：(a) `runProjection` 后 active 行唯一且 activated_at 非空、节点全量；(b) 直插 `materializing` 残行（依赖新 migration 放开 CHECK）后 `getActiveProjection`/`getProjectionForRevision` 均不返回残行、旧 active 仍服务。
- **judge 机械闸⑤ meta_verification_gap 规避（invariant）**：本合同 DoD/E2E 的每条 oracle 都是 vitest 真跑（真实 exit code + `N passed` stdout），非 meta 自证；无「仅检查文件存在」型顶替业务行为。

---

## E2E 验收（final-e2e — target_environment=local_api，postgres:false → 纯 vitest RED→GREEN）

> 本 attempt `postgres:false`：E2E 不含 psql，只跑冻结单测全量（真实 exit code）。
> **vitest 工作目录死规则（invariant [vitest exit语义]）**：仓库根 `vitest.config.js` 的 `test.root=packages/brain` 且 `include` 不含 `sprints/**`——从仓库根跑 `sprints/.../*.test.js` 必命中「No test files / include 外」→ 假绿或 exit 语义失真。故 E2E 必须 `(cd sprints/<dir> && npx vitest run --root . tests/...)` 子 shell 以本 sprint 目录为 root 走 vitest 默认 include 真实执行（已实测：GREEN→exit 0 且 `5 passed`，RED→exit 1）。

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/08231107-kernel-ccd99d19"
TEST_REL="tests/projection-two-phase.test.js"

# 全量跑冻结 RED→GREEN 单测（子 shell 切进 sprint 目录，--root . 走 vitest 默认 include）
OUT="$( (cd "$SPRINT_DIR" && npx vitest run --root . "$TEST_REL" --reporter=basic) 2>&1 )"
echo "$OUT"

# 真实 exit 语义 + 领域断言：必须有「N passed」且无「failed」（防 include 外假绿）
echo "$OUT" | grep -qE "[1-9][0-9]* passed" || { echo "FAIL: 无 passed 计数（疑似 include 外空跑/假绿）"; exit 1; }
echo "$OUT" | grep -qE "[1-9][0-9]* failed" && { echo "FAIL: 存在失败用例"; exit 1; }
echo "$OUT" | grep -qE "Test Files[[:space:]]+[1-9][0-9]* passed" || { echo "FAIL: 无 Test Files passed 汇总"; exit 1; }

echo "✅ 投影物化两阶段原子化 Golden Path 冻结单测全绿"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `runProjection` 传空 `capabilities`（0 节点）manifest —— materializing 空投影翻 active，读取侧应返回空节点集并触发 #5017 瞬态兜底（unknown），不得抛未捕获异常。
- 重复提交: 同一 scope 连续两次换代（rescan 抖动）—— 唯一部分索引应始终只留一个 active，第二次翻转前旧 active 被 superseded，无双 active 冲突。
- 中途中断: 物化写到一半事务失败/回滚 —— 不得残留可被读取的 active/superseded 半图；只允许留 materializing 残行且读侧不可见。
- 边界值: `getProjectionForRevision` 命中「只有 materializing、无 active/superseded」的 scope —— 应返回 null（而非 materializing 残行）。
发现分级: P0/P1（读到部分集/双 active/半图）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## Contract Gate

contract-gate: present (packages/brain/src/lib/contract-gate.js exists, cecelia worktree)

---

## Test Contract

> **列序死规则（seal 解析链定位，r54 round-2 修）**：Test Contract 表列序由 `scripts/lib/test-contract-paths.cjs::parseTestContract` 按管道分列**位置**解析——`cells[2]`（第 2 列）必须是 `testFile` 完整路径（backtick 包裹），`cells[3]`（第 3 列）是 BEHAVIOR 覆盖名。round-1 曾把两列互换（BEHAVIOR 写第 2 列、路径写第 3 列），导致 `parseTestContract` 把 BEHAVIOR 串当路径、`.test.js` 正则不匹配而丢弃全部行 → 冻结测试 `projection-two-phase.test.js` 判为 `FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED` 拒封印。本轮把路径归位到第 2 列。

| 功能 | `testFile` | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 新 run 以 materializing 写入 | `sprints/08231107-kernel-ccd99d19/tests/projection-two-phase.test.js` | `writes the new run with materializing status` | 当前 INSERT 用 `'building'` → 该 it 红（实测 `1 failed`：`expected 'INSERT ... 'building') ...' to match /'materializing'/`） |
| 物化在翻转前完成 | `sprints/08231107-kernel-ccd99d19/tests/projection-two-phase.test.js` | `materializes all nodes and edges before the active flip` | 顺序锁（现行已满足，实现改 status 时防回退；随文件其余用例一并冻结） |
| 单事务翻转 superseded+active | `sprints/08231107-kernel-ccd99d19/tests/projection-two-phase.test.js` | `supersedes old active and activates new run in one flip` | 翻转锁（同上，随文件冻结） |
| active 选择排除 materializing 残行 | `sprints/08231107-kernel-ccd99d19/tests/projection-two-phase.test.js` | `selects only active runs never materializing residuals` | 读谓词锁（改 active 选择泄漏 materializing 即红） |
| revision 查找不返回 materializing 残行 | `sprints/08231107-kernel-ccd99d19/tests/projection-two-phase.test.js` | `never returns a materializing residual run` | 读谓词锁（同上；且仍须可读 superseded） |

> BEHAVIOR 覆盖名（第 3 列）逐词取自本文件真实 it() 名的子串（`runProjection writes the new run with materializing status` 等，见 tests/projection-two-phase.test.js），与 seal 的双向小写子串匹配语义一致。
> 全文件实测：当前实现 `1 failed | 4 passed`（RED 锚定于 materializing 状态），临时把 projector INSERT 改 `materializing` 后 `5 passed`（GREEN 可达）。`-t` 过滤输出为 `1 passed | M skipped`，故断言用宽松式 `grep -qE "[1-9][0-9]* passed"`（禁精确串 `1 passed (1)`——r45 家族死因）。
