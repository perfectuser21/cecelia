# Sprint Contract Draft (Round 1)

> 完整继承已 APPROVED 的 R2 合同 `4f181300a29c2f1012a1b2b60f5fa728cc595400` 的行为契约。
> 本轮唯一恢复增量：在 `sprint_dir/tests/` 补齐**可执行薄包装**（加载单一测试实现、不复制断言），
> 让 Kernel `collectApprovedContractArtifacts` 不再 fail-closed，Generator/Evaluator/Judge 可继续。
> **锚定父路声明**：独立小路（无父路）—— PrepPRD `step_id: none`，journey e6f803f2 现有 golden-path 均 planned。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动集中在 orchestrator/watchdog/fleet-worker 脚本 + DB 写路径 + 测试薄包装，
无对外 HTTP 端点新增。验收 oracle 为：真 Postgres 状态断言 + docker 生命周期调用集断言 + 薄包装真实 exit code。
（Reviewer 第 6 维 verification_oracle_completeness 对本项自动满分。）

## Unified Map 半径

[MAP_NOT_CONFIGURED] — task.payload 未提供 map_scope/map_repo（fleet-worker successor 恢复任务，无 Unified Map 投影）。
`must_run_assertions` 为空，不回退领域硬编码；已知回归约束改由下方「## 已知约束」+ Invariant 承载。

---

## Golden Path

[同机多 Worker 并发 + 某 attempt 过期]
→ [实例 namespace 隔离 + 旧无 namespace 容器 fail-closed]
→ [expired fleet-worker attempt 单入口单事务终态化 + resume replacement lineage + 幂等]
→ [postgres 契约→runtime 机械投影 + 真验]
→ [sprint_dir/tests 薄包装被 artifact 收集]
→ [互不互杀、干净 resume lineage、批准合同可继续]

### Step 1: 同机多 Worker 实例隔离（互杀根治）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条 + Invariant [互杀隔离]（第 18/65 行）

**可观测行为**: 同一 Docker daemon、相同 canonical machine_id、不同端口/data root 的 Worker A/B 并发。
A 的容器生命周期管理（stop/rm）**只作用于自身 instance namespace 的容器**，绝不 stop/rm B 的容器。

**验证命令**: 单一测试实现 `instance-fencing.test.cjs` 记录 A 生命周期回收时对 docker CLI 的调用集，
断言其中不含任何指向 B namespace 容器的 `stop`/`rm`。经薄包装真跑（见 ## E2E 验收 step 6）。

**硬阈值**: A 的 docker stop/rm 目标集合 ∩ B namespace 容器集合 == ∅。

---

### Step 2: instance namespace 持久化 + 旧无 namespace 容器 fail-closed
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条 + Invariant [fail-closed]（第 19/66 行）

**可观测行为**: instance namespace 持久化到磁盘，Worker 重启后稳定复用同一 namespace；
升级前遗留的**无 namespace 容器一律 fail-closed**——不被任何实例接管，也不被误杀。

**验证命令**: 单源用例在临时 data root 写 namespace 标识 → 模拟重启重新加载 → 断言 namespace 一致；
再注入一个无 namespace 旧容器 → 断言 Worker 拒绝接管且不发 stop/rm。经薄包装真跑。

**硬阈值**: 重启前后 namespace 相等；无 namespace 容器的 stop/rm 调用数 == 0。

---

### Step 3: expired fleet-worker attempt 单入口单事务终态化 + replacement lineage
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + Invariant [单入口幂等]（第 20/67 行）

**可观测行为**: 过期的 fleet-worker attempt 由 `reconcileExpiredKernelAttempt` **唯一入口**、
**单事务**内把 parent 终态化为 `failed`，并生成 replacement：
`attempt_kind='resume'`、`retry_of_attempt_id` 指向 parent、`restart_reason` 非空。

> ⚠️ 现状差异（TDD Red 依据）：当前 `packages/brain/src/harness-relay-watchdog.js` 对
> `execution_transport === 'fleet-worker'` 直接 `return { ok: false, deferred_to_controller: true }`
> （约第 1481–1499 行），并未终态化。Generator 必须改为单入口单事务终态化，并同步更新
> `src/__tests__/harness-relay-watchdog-kernel-fleet.test.js` 中断言 `deferred_to_controller` 的旧用例。

**验证命令**: 单源用例对真 Postgres（Fleet 注入 `DB_URL`）seed 一个 expired fleet-worker parent，
调 `reconcileExpiredKernelAttempt`，psql 断言 parent 单条 `failed` + replacement 单条
（`attempt_kind='resume'` / `retry_of_attempt_id=parent` / `restart_reason` 非空）。经薄包装真跑。

**硬阈值**: parent `status='failed'` 恰 1 行；replacement 恰 1 行且三字段全部满足。

---

### Step 4: 重复/并发 reconcile 幂等
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + 边界情况（第 28 行）

**可观测行为**: 对同一 expired attempt 重复/并发调 `reconcileExpiredKernelAttempt`：
不产生第二个 replacement，不重复终态化（依赖单事务 + 唯一约束，`23505` 去重）。

**验证命令**: 单源用例连调 reconcile 两次，psql 断言 replacement 计数在二次调用后仍为 1，
parent `failed` 仍为 1 行。经薄包装真跑。

**硬阈值**: 二次 reconcile 后 replacement 计数 == 1（幂等）。

---

### Step 5: contract_requirements.postgres → runtime_resources.postgres 机械投影 + 真验
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条 + NFR（第 59 行）

**可观测行为**: `contract_requirements.postgres=true` 被机械投影为 `runtime_resources.postgres=true`
（现投影点 `packages/brain/src/orchestrator/dispatcher.js` 约 937–945 行），且 postgres **真实可连**（非假绿）。

**验证命令**: (a) 单源用例断言投影逻辑：给 `{ postgres: true }` → `runtime_resources.postgres===true`；
(b) E2E 用 `psql "$DB_URL" -c 'SELECT 1'` 真连库。经薄包装 + E2E 真跑。

**硬阈值**: 投影后 `runtime_resources.postgres===true`；`psql SELECT 1` 返回 1（真连）。

---

### Step 6: sprint_dir/tests 薄包装被 artifact 收集（恢复增量）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条 + 背景（第 11/23 行）

**可观测行为**: `sprints/08132138-fleet-worker-instance-fencing/tests/` 下存在**可执行薄包装**，
`node` 直跑它：加载单一测试实现 `packages/brain/scripts/fleet-worker/instance-fencing.test.cjs`
并**转发真实 exit code**（不复制断言）；Kernel `collectApprovedContractArtifacts` 从 `sprint_dir/tests`
收集到 ≥1 个 blob，批准合同不再 fail-closed。

**验证命令**: `git ls-files sprint_dir/tests` ≥1；`node tests/instance-fencing.wrapper.cjs` 单源缺失时 exit≠0、
存在且全绿时 exit 0；grep 薄包装内无 `expect(`/`it(`/`describe(`（未复制断言）。经 E2E 真跑。

**硬阈值**: `git ls-files` ≥1 blob；薄包装 exit code 与单源真实结果一致；薄包装 0 条复制断言。

---

## 已知约束（来自回归测试 + 历史三源）

来源 `[回归测试]`（`packages/brain/src/__tests__/harness-relay-watchdog-kernel-fleet.test.js`）：
- returns deferred receipt-failure evidence without terminal or alert side effects（deferred 收据路径不得回归）
- terminalizes both claims before preserving an aggregate raised inside resume（resume 失败时 parent+child 双终态先于清理）
- attempts both terminal writes before cleanup P1 when persistence and alert both reject（双写序不变）
- **本 sprint 有意变更**：`execution_transport==='fleet-worker'` 的 **expired** 分支由「deferred_to_controller」
  改为「单入口单事务终态化 + replacement」；Generator 必须同步更新该文件里断言 `deferred_to_controller` 的旧用例，
  不得让其继续锁死旧行为。非 expired / receipt-failure 的 deferred 语义保持不变。

来源 `[累积FR]`：`context-manifest` 未在本 bundle 提供；PRD「累积 FR」段注明本 line 暂无已验收历史。unavailable，不静默跳过。

来源 `[铁律]`：见下方 contract-dod.md `## Invariant 覆盖（INV-N）` 逐条映射。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 实例级容器隔离 + expired attempt 单入口原子终态化+resume lineage+幂等 + postgres 投影真验 + sprint_dir/tests 薄包装 | 见 Golden Path Step 1–6 |
| **NFR（做得多好）** | postgres 必须真实可连；expired 判定沿用现有 kernel lease 阈值；超时/频控 PrepPRD 未指定=待定 | 见 PRD NFR（第 56–60 行） |
| **Invariant（永不违反）** | 互杀隔离 / 旧无 namespace fail-closed / expired 单入口幂等 / 真验非假绿 / canonical 不可变 / 台账不入库 | 见 INV-1..6 |
| **判定点（怎么知道）** | 容器归属判定 / expired 判定 / 旧容器接管判定 | 见判定点登记表 |
| **保质期（何时过期）** | attempt lease 过期由现有 kernel lease 阈值定；replacement 由 controller 后续接管 | lease_expires_at 单一真源 |
| **死亡告警（停了谁知道）** | reconcile 失败经 `onRecoveryAlert` 告警；薄包装失败以非零 exit code 暴露给 evaluator/CI | 现有 recovery alert 通道 |
| **失败语义（挂了怎么办）** | 见失败语义声明 | 见下表 |
| **效果确认（已发≠已生效）** | 终态化+replacement 生成必须留痕（restart_reason 非空、lineage 可查）；psql 回执确认 | 见 Golden Path Step 3/4 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 容器是否属于本实例 | A. 读容器 label `cecelia.fleet.instance_namespace`; B. 按端口/data root 推断 | A. 读 namespace label | label 持久稳定、重启可复现；端口/data root 推断易漂移 | 跨实例误杀他人容器（不可逆） |
| ⚠️ attempt 是否 expired | A. `lease_expires_at < now()`; B. 心跳超时窗口 | A. lease_expires_at | kernel lease 单一真源，与现有阈值一致 | 误终态化仍活跃的 attempt（不可逆） |
| ⚠️ 旧无 namespace 容器是否接管 | A. 一律 fail-closed 不接管; B. 按启发式认领 | A. fail-closed 不接管 | 宁可不动不可误杀（Invariant fail-closed） | 误杀升级前遗留容器（不可逆） |

> 三个判定点误判后果均为**不可逆动作**，标 ⚠️；PrepPRD `step_id: none` 未逐点拍板 →
> `judgment-pending-user: 容器归属判定 / expired 判定 / 旧容器接管判定`（沿用继承合同既定选型，如需改动请主理人确认）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| postgres 不可达 | runtime 真验暴露失败，exit≠0，不放行（不假绿） | 是（幂等键=attempt_id） | 不降级；环境未就绪=FAIL |
| 并发/重复 reconcile | 单事务 + 唯一约束（`23505`）去重，不产生第二 replacement | 是（幂等键=parent attempt_id + hop） | 二次调用 no-op 返回 deduped |
| namespace 文件丢失/损坏 | fail-closed，不跨实例杀 | 是 | 拒绝接管，等待人工/重建 |
| 薄包装单源缺失 | exit≠0（fail-closed） | 是 | 报错退出，不静默 PASS |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent 输入面，改动为纯内部 orchestrator/watchdog + DB 写路径 + docker 生命周期 + 测试薄包装，
无外部用户可写入的接口/prompt 注入面。

---

## 禁 mock 边清单

本单涉及**状态机**（expired→failed 终态迁移）、**DB 写路径**（harness_attempts parent/child 写入）、
**跨模块数据传递**（postgres 契约→runtime 投影）、**生命周期钩子**（Worker 容器回收），故以下边**禁 mock**：

- `reconcileExpiredKernelAttempt` ↔ `harness_attempts` 表（DB 写路径 + 状态机：parent→`failed` / child `resume` lineage / 幂等唯一约束）——测试必须真 Postgres（`DB_URL`），验行落库与列值，禁止用 mock store 顶替终态化与 lineage 断言。
- `fleet-worker.cjs` 实例 namespace 选择逻辑 ↔ docker 容器集合（跨模块 + 生命周期钩子）——namespace 过滤/归属判定逻辑必须真实执行；**仅** docker CLI 子进程外层边界（`runCommand`）可 mock 以记录调用集，禁止 mock 掉 namespace 归属判定本身。
- postgres 契约→`runtime_resources` 投影（跨模块数据传递）——投影逻辑真实执行，断言 `{postgres:true}` → `runtime_resources.postgres===true`。

**允许 mock（更外层无关依赖）**：`resumeAttempt`/实际 spawn 启动（外层 launch 边界）、`onRecoveryAlert` 通知渠道、docker CLI 子进程（`runCommand`，仅记录调用不改归属逻辑）。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `reconcileExpiredKernelAttempt` 传不存在/已 completed 的 attemptId → 应 deduped 返回，不新建 replacement，不抛异常
- 重复提交: 连续 3+ 次并发 reconcile 同一 expired attempt → 始终恰 1 个 replacement（观察是否有竞态多写）
- 中途中断: reconcile 事务中途（parent 已 reclaim、child 未 markStarting）注入失败 → parent 不得停在半终态；无孤儿 child
- 边界值: namespace label 为空串 / 超长 / 含非法字符 → fail-closed 归为"无 namespace"，不误接管；lease_expires_at 恰等 now() 边界
- 环境面: `DB_URL` 缺失 / 指向空库未 migration → 必须 exit≠0 暴露（禁假绿）；docker daemon 不可达 → 隔离逻辑仍以 runCommand mock 记录集判定，不静默 SKIP
发现分级: P0/P1（跨实例误杀 / 误终态化活跃 attempt / 重复 replacement / 假绿）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> autonomous / local_api：evaluator 本地跑 psql（Fleet 注入 `DB_URL`）+ node 直跑薄包装（真实 exit code 语义）。
> 单一代码块，第一块含 shebang / `set`。薄包装承载 docker 互杀隔离 / namespace 持久+fail-closed / expired 闭环 /
> restart_reason lineage / postgres runtime 五项真断言（单源实现），本脚本另做独立真 PG spot-check。

```bash
#!/bin/bash
set -euo pipefail

# ── Fleet 注入的 attempt 级 Postgres（Invariant [真验非假绿]：postgres 必须真实可连，禁假绿）──
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL for postgres runtime verification}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
SPRINT_DIR="sprints/08132138-fleet-worker-instance-fencing"
WRAPPER="$SPRINT_DIR/tests/instance-fencing.wrapper.cjs"
TMP_E2E="$(mktemp -d)"
trap 'rm -rf "$TMP_E2E"' EXIT

# 1) postgres 真实可连（真验非假绿，非只看字段/HTTP 200）
psql "$DB_URL" -tAc 'SELECT 1' | grep -qx 1 || { echo "FAIL: postgres unreachable via DB_URL"; exit 1; }

# 2) 仓库真实 migration/schema bootstrap（Kernel local_api 硬规则：空库先跑仓库现有 migration）
cat > "$TMP_E2E/bootstrap.cjs" <<'BOOT'
(async () => {
  const u = new URL(process.env.DB_URL);
  process.env.DB_HOST = u.hostname;
  process.env.DB_PORT = u.port || '5432';
  if (u.pathname && u.pathname.length > 1) process.env.DB_NAME = decodeURIComponent(u.pathname.slice(1));
  if (u.username) process.env.DB_USER = decodeURIComponent(u.username);
  if (u.password) process.env.DB_PASSWORD = decodeURIComponent(u.password);
  const m = await import('./packages/brain/src/migrate.js');
  await m.runMigrations();
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
BOOT
node "$TMP_E2E/bootstrap.cjs" || { echo "FAIL: repo schema bootstrap failed"; exit 1; }

# 3) lineage 目标表 harness_attempts 存在（空库 bootstrap 后机检）
psql "$DB_URL" -tAc "SELECT to_regclass('public.harness_attempts') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: harness_attempts table missing after migration"; exit 1; }

# 4) lineage 四列存在：attempt_kind / retry_of_attempt_id / restart_reason / execution_transport
for col in attempt_kind retry_of_attempt_id restart_reason execution_transport; do
  CNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='harness_attempts' AND column_name='$col'" | tr -d ' ')
  [ "$CNT" = "1" ] || { echo "FAIL: harness_attempts.$col missing"; exit 1; }
done

# 5) 薄包装单源化 + 未复制断言（加载单一实现，不含 expect/it/describe 断言体）
grep -q "instance-fencing.test.cjs" "$WRAPPER" || { echo "FAIL: wrapper does not load single source"; exit 1; }
if grep -Eq "expect\(|(^|[^A-Za-z])it\(|(^|[^A-Za-z])describe\(" "$WRAPPER"; then
  echo "FAIL: wrapper copies assertion logic (must stay single-sourced)"; exit 1
fi

# 6) 薄包装真跑单源 → 真实 exit code oracle：docker 互杀隔离 / namespace 持久+fail-closed /
#    expired 单入口闭环 / restart_reason lineage / postgres runtime 五项断言（单源实现，真 PG/真归属逻辑）。
#    捕获输出防"no test files found"假绿；RED until Generator 落单源 + 实现。
OUT="$(node "$WRAPPER" 2>&1)"; RC=$?
echo "$OUT" | tail -40
[ "$RC" -eq 0 ] || { echo "FAIL: instance-fencing single-source assertions failed (rc=$RC)"; exit 1; }
echo "$OUT" | grep -qiE "Test Files|Tests[[:space:]]" || { echo "FAIL: no evidence vitest executed tests (false green guard)"; exit 1; }
echo "$OUT" | grep -qi "No test files found" && { echo "FAIL: single source not discovered (false green)"; exit 1; } || true

# 7) artifact 收集兼容：sprint_dir/tests 至少一个 git-tracked blob（collectApprovedContractArtifacts 前提）
BLOBS=$(git ls-files "$SPRINT_DIR/tests" | wc -l | tr -d ' ')
[ "$BLOBS" -ge 1 ] || { echo "FAIL: no blob under sprint_dir/tests for collectApprovedContractArtifacts"; exit 1; }

# 8) Invariant [台账不入库]：.harness/progress.md 不得进入 git 追踪
if git ls-files | grep -q "^\.harness/progress\.md$"; then
  echo "FAIL: .harness/progress.md must NOT be git-tracked (台账不入库)"; exit 1
fi

echo "✅ Golden Path 验证通过 — 实例隔离 + expired 原子闭环 + resume lineage + postgres 真验 + 薄包装 artifact"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（单源实现） | `packages/brain/scripts/fleet-worker/instance-fencing.test.cjs`（Generator 落）经 `sprints/08132138-fleet-worker-instance-fencing/tests/instance-fencing.wrapper.cjs` 加载 | 互杀隔离 / namespace 持久 fail-closed / expired 单入口闭环 / restart_reason lineage / 幂等 / postgres 投影真验 | 单源缺失 → 薄包装 exit≠0；`reconcileExpiredKernelAttempt` 现 defer fleet-worker → expired 闭环用例 FAIL |

> Test Contract「BEHAVIOR 覆盖」名须为单源 `it()` 名字面子串（Generator 写 `it()` 时对齐）。
> 单源实现由 Generator 落地（TDD Red→Green）；proposer 侧交付**薄包装**作为 sprint_dir/tests 的失败测试（单源未落时真红）。

---

## Contract Gate 备注

contract-gate: present (cecelia worktree — packages/brain/src/lib/contract-gate.js 存在，执行代码层 Contract Gate)
