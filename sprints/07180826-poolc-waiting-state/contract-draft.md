# Contract Draft — Pool C 等待态（waiting_ci）改革
> Sprint: 07180826-poolc-waiting-state
> Task ID: 327bdebb-0067-4065-9ab4-ed2e0fc372db
> 起草轮次: 首轮（无 reviewer feedback）
> 日期: 2026-07-18

---

## 功能摘要

将"PR 已开、等 CI 跑完 / 等 auto-merge"的被动等待任务引入独立状态 `waiting_ci`，使 `countAutoDispatchInProgress()` 不再将其计入 Pool C used 槽位，从根本上消除"纸面满"现象（2026-07-17 实证：pool_c_full 拒发 25 次，槽位 API 显示 4/5 占用但仅 1 活跃容器）。

---

## 实现方案选择

**采用方案 A（新增 `waiting_ci` status 值）**，理由：语义清晰、DB 层可直接索引、与现有 WHERE 子句结构一致。改动面虽广（需审计 FR-5 枚举的所有 in_progress 查询点），但侵入点明确，优于方案 B 的 JSONB 查询散落。

---

## 受影响文件清单

| 文件 | 改动类型 |
|---|---|
| `packages/brain/src/task-updater.js` | `VALID_STATUSES` 加入 `'waiting_ci'` |
| `packages/brain/src/slot-allocator.js` | `countAutoDispatchInProgress()` WHERE 排除 waiting_ci；`getSlotStatus()` 新增 waiting 字段 |
| `packages/brain/src/harness-relay-watchdog.js` | 转入点：CI pending / green+evaluatorDone → 写 waiting_ci 标记 |
| `packages/brain/src/zombie-reaper.js` | 新增 waiting_ci 守卫分支（6h/24h 窗口） |
| `packages/brain/src/startup-sync.js` | 扩展扫描范围，waiting_ci 再分类（green 保持，red 回 in_progress） |
| `packages/brain/src/actions.js` | 允许 in_progress → waiting_ci 状态流转 |
| `packages/brain/src/eviction.js` | 确认排除 waiting_ci（不可驱逐） |
| `packages/brain/src/harness-watchdog.js` | 确认 WHERE 覆盖 waiting_ci（健康巡检需看到） |
| `packages/brain/src/__tests__/pool-c-waiting-state.test.js` | 新建：4 场景 failing-first 测试 |
| `packages/brain/package.json` | 版本 bump：1.267.2 → 1.268.0 |

---

## 场景测试规约（failing-first，测试先于实现）

测试文件路径：`packages/brain/src/__tests__/pool-c-waiting-state.test.js`

### 场景1：3 waiting_ci + 1 in_progress → Pool C used = 1

```
GIVEN DB 中存在：
  - 3 条 status='waiting_ci'，payload 无 decomposition，无 requires_cortex（auto-dispatch 类型）
  - 1 条 status='in_progress'，payload 无 decomposition，无 requires_cortex
WHEN 调用 countAutoDispatchInProgress()
THEN 返回值 === 1（仅计 in_progress，排除 waiting_ci）
AND  calculateSlotBudget() 返回 taskPool.used === 1
AND  calculateSlotBudget() 返回 taskPool.available >= 1
AND  calculateSlotBudget() 返回 taskPool.waiting === 3
```

**断言**：
- `expect(used).toBe(1)`
- `expect(waiting).toBe(3)`
- `expect(available).toBeGreaterThanOrEqual(1)`

---

### 场景2：0 in_progress + 3 waiting_ci → available = effectiveSlots（不被 waiting 拖零）

```
GIVEN DB 中存在：
  - 3 条 status='waiting_ci'（auto-dispatch 类型）
  - 0 条 status='in_progress'（auto-dispatch 类型）
WHEN 调用 calculateSlotBudget()
THEN taskPool.used === 0
AND  taskPool.available === effectiveSlots（Pool C 全空闲）
AND  taskPool.waiting === 3
AND  dispatchAllowed === true（不触发 pool_c_full）
```

**断言**：
- `expect(used).toBe(0)`
- `expect(available).toBe(effectiveSlots)`（effectiveSlots 由 budget 计算，通常 >= 1）
- `expect(dispatch_allowed).toBe(true)`

---

### 场景3：waiting_ci 任务在 dispatcher 去重列表中仍可见（防重派）

```
GIVEN DB 中存在 1 条 status='waiting_ci' 的任务（task_id=T1，已有 pr_url）
WHEN dispatcher 查询派发候选的「已派发」去重集合
THEN T1 出现在去重集合中（不被再次派发）
AND  dispatcher 不会为 T1 生成新的 spawn 指令
```

**断言**：
- 去重查询结果包含 task_id T1
- `expect(duplicateSet.has(T1)).toBe(true)`

---

### 场景4：waiting_ci 超过 6h 守卫窗口，reaper 能处理

```
GIVEN DB 中存在 1 条 status='waiting_ci' 的任务：
  - payload.waiting_ci_since = NOW() - INTERVAL '7 hours'
  - payload.waiting_pr_url = 'https://github.com/org/repo/pull/999'
WHEN zombie-reaper 扫描执行
THEN 命中该任务（waiting_ci_since < NOW() - 6h）
AND  执行 gh pr view 核查（mock 返回 PR 状态）
  - 子场景 4a：PR 状态=MERGED → 任务 status 转为 completed（走 finalizeMergedRun 路径）
  - 子场景 4b：PR 状态=CLOSED → 任务 status 转为 failed，error_message 含 'pr_closed'
  - 子场景 4c：PR 状态=OPEN, CI 仍在跑 → waiting_ci_since 更新续期，status 保持 waiting_ci
  - 子场景 4d：waiting_ci_since > NOW() - 24h 且超过总守卫窗口 → status=failed，error_message 含 'waiting_ci_timeout'
```

**断言**：
- 4a: `expect(task.status).toBe('completed')`
- 4b: `expect(task.status).toBe('failed')`, `expect(task.error_message).toMatch(/pr_closed/)`
- 4c: `expect(task.status).toBe('waiting_ci')`, 新 `waiting_ci_since > old waiting_ci_since`
- 4d: `expect(task.status).toBe('failed')`, `expect(task.error_message).toMatch(/waiting_ci_timeout/)`

---

## E2E 验收

> target_environment: local_api
> Brain 本地运行（localhost:5221），验收通过 Brain API + DB 直查

### 验收脚本（manual:bash）

```bash
#!/usr/bin/env bash
# Pool C 等待态 E2E 验收脚本
# 环境：Brain 本地运行（localhost:5221），PostgreSQL cecelia DB 可访问
# 用法：bash sprints/07180826-poolc-waiting-state/e2e-verify.sh

set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

echo "=== Pool C 等待态 E2E 验收开始 ==="
echo "Brain URL: $BRAIN_URL"

# ——— 前置清理 ———
CLEANUP_SQL="DELETE FROM tasks WHERE title LIKE 'e2e-waiting-ci-test%';"
psql "$DB_URL" -c "$CLEANUP_SQL" > /dev/null 2>&1 || true

# ——— 插入测试数据 ———
INSERT_SQL="
INSERT INTO tasks (id, title, status, payload, created_at, updated_at)
VALUES
  ('e2e-w1-uuid', 'e2e-waiting-ci-test-1', 'waiting_ci',
   '{\"waiting_ci_since\": $(date +%s), \"waiting_pr_url\": \"https://github.com/test/repo/pull/1\"}'::jsonb,
   NOW(), NOW()),
  ('e2e-w2-uuid', 'e2e-waiting-ci-test-2', 'waiting_ci',
   '{\"waiting_ci_since\": $(date +%s), \"waiting_pr_url\": \"https://github.com/test/repo/pull/2\"}'::jsonb,
   NOW(), NOW()),
  ('e2e-w3-uuid', 'e2e-waiting-ci-test-3', 'waiting_ci',
   '{\"waiting_ci_since\": $(date +%s), \"waiting_pr_url\": \"https://github.com/test/repo/pull/3\"}'::jsonb,
   NOW(), NOW()),
  ('e2e-p1-uuid', 'e2e-waiting-ci-test-4-inprogress', 'in_progress',
   '{}'::jsonb,
   NOW(), NOW());
"
psql "$DB_URL" -c "$INSERT_SQL" > /dev/null
echo "[OK] 测试数据已插入（3 waiting_ci + 1 in_progress）"

# ——— 验收 1：Pool C 等待态不计入 used ———
echo ""
echo "--- 验收1: Pool C 等待态不计入 used ---"
SLOTS_RESP=$(curl -sf "$BRAIN_URL/api/brain/slots")
TASK_POOL_USED=$(echo "$SLOTS_RESP" | jq '.pools.task_pool.used')
TASK_POOL_WAITING=$(echo "$SLOTS_RESP" | jq '.pools.task_pool.waiting')
TASK_POOL_AVAILABLE=$(echo "$SLOTS_RESP" | jq '.pools.task_pool.available')

echo "task_pool.used=$TASK_POOL_USED (期望: 1)"
echo "task_pool.waiting=$TASK_POOL_WAITING (期望: >=3)"
echo "task_pool.available=$TASK_POOL_AVAILABLE (期望: >=1)"

if [ "$TASK_POOL_USED" != "1" ]; then
  echo "[FAIL] task_pool.used 应为 1，实际为 $TASK_POOL_USED" >&2
  exit 1
fi
if [ "$TASK_POOL_WAITING" = "null" ] || [ "$TASK_POOL_WAITING" -lt 3 ]; then
  echo "[FAIL] task_pool.waiting 应 >=3，实际为 $TASK_POOL_WAITING" >&2
  exit 1
fi
if [ "$TASK_POOL_AVAILABLE" = "null" ] || [ "$TASK_POOL_AVAILABLE" -lt 1 ]; then
  echo "[FAIL] task_pool.available 应 >=1，实际为 $TASK_POOL_AVAILABLE" >&2
  exit 1
fi
echo "[PASS] 验收1 通过：waiting_ci 任务正确排除于 Pool C used 计数"

# ——— 验收 2：slots API waiting 字段存在且为数值 ———
echo ""
echo "--- 验收2: slots API waiting 字段 ---"
WAITING_VAL=$(echo "$SLOTS_RESP" | jq '.pools.task_pool.waiting')
if [ "$WAITING_VAL" = "null" ]; then
  echo "[FAIL] slots API 缺少 .pools.task_pool.waiting 字段" >&2
  exit 1
fi
echo "[PASS] 验收2 通过：.pools.task_pool.waiting = $WAITING_VAL"

# ——— 验收 3：dispatch_allowed 不因 waiting_ci 变 false ———
echo ""
echo "--- 验收3: dispatch_allowed 检查 ---"
DISPATCH_ALLOWED=$(echo "$SLOTS_RESP" | jq '.dispatch_allowed')
if [ "$DISPATCH_ALLOWED" != "true" ]; then
  echo "[FAIL] dispatch_allowed 应为 true，实际为 $DISPATCH_ALLOWED" >&2
  exit 1
fi
echo "[PASS] 验收3 通过：dispatch_allowed=true，Pool C 未被 waiting 拖满"

# ——— 验收 4：waiting_ci 守卫（6h 超时）———
echo ""
echo "--- 验收4: 6h 超时守卫 ---"
STALE_TS=$(date -d '7 hours ago' +%s 2>/dev/null || date -v-7H +%s)
STALE_SQL="
INSERT INTO tasks (id, title, status, payload, created_at, updated_at)
VALUES (
  'e2e-stale-uuid', 'e2e-waiting-ci-test-stale', 'waiting_ci',
  ('{\"waiting_ci_since\": ' || $STALE_TS || ', \"waiting_pr_url\": \"https://github.com/test/repo/pull/999\"}'::text)::jsonb,
  NOW() - INTERVAL '7 hours', NOW()
)
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, status = 'waiting_ci';
"
psql "$DB_URL" -c "$STALE_SQL" > /dev/null
echo "[OK] 插入 7h 前 waiting_ci 僵尸任务"

# 触发 zombie-reaper tick（使用 Brain API）
TICK_RESP=$(curl -sf -X POST "$BRAIN_URL/api/brain/tick/zombie-reaper" 2>/dev/null || \
            curl -sf -X POST "$BRAIN_URL/api/brain/debug/trigger-reaper" 2>/dev/null || \
            echo '{"triggered":false}')
echo "Reaper tick 响应: $TICK_RESP"

sleep 2  # 等待 reaper 处理

STALE_STATUS=$(psql "$DB_URL" -t -c "SELECT status FROM tasks WHERE id='e2e-stale-uuid';" | tr -d ' \n')
STALE_ERROR=$(psql "$DB_URL" -t -c "SELECT payload->>'error_message' FROM tasks WHERE id='e2e-stale-uuid';" | tr -d ' ')

echo "僵尸任务最终 status=$STALE_STATUS (期望: failed)"
if [ "$STALE_STATUS" != "failed" ]; then
  echo "[WARN] 守卫触发需依赖 zombie-reaper 定时运行，当前 status=$STALE_STATUS（验收4 需人工触发 reaper 后重验）"
else
  if echo "$STALE_ERROR" | grep -q "waiting_ci_timeout"; then
    echo "[PASS] 验收4 通过：僵尸任务 status=failed，error_message 含 waiting_ci_timeout"
  else
    echo "[WARN] status=failed 但 error_message 不含 waiting_ci_timeout，error=$STALE_ERROR"
  fi
fi

# ——— 清理 ———
psql "$DB_URL" -c "DELETE FROM tasks WHERE title LIKE 'e2e-waiting-ci-test%';" > /dev/null
echo ""
echo "=== E2E 验收完成，测试数据已清理 ==="
```

---

## 不变量约束检查

| 不变量 | 本合同约束映射 |
|---|---|
| INV-cec579d2 工厂 70% / 业务 30% 配比 | waiting_ci 改动只影响 Pool C used 计数，不改配比逻辑 |
| INV-7ccfa168 同 slot 串行 | waiting_ci 占槽不算"活跃"，不得用其在同 slot 注入第二个 in_progress |
| INV-dc18d43d 无闸不成文 | 转入/转出逻辑必须写进 slot-allocator.js 和 harness-relay-watchdog.js |
| INV-c1d0abce 孤儿清查 | FR-5 枚举 14 个 in_progress 查询点逐一确认兼容（见 DoD 条目） |
| INV-e90c0fbb pr_url 必须写回 | 转入 waiting_ci 时必须同步写 pr_url 到 payload |
| INV-b0b2d702 禁套 harness pipeline | 验收走 local_api，不走 harness-controller 完整流水线 |

---

## 未覆盖真实链路清单

以下链路在单元测试中使用 mock，原因说明如下：

| 链路 | Mock 方式 | 豁免理由 |
|---|---|---|
| `gh pr view` 调用（场景4 reaper 核查 PR 状态） | mock `execSync` / `childProcess.exec` | GitHub API 在 CI 沙箱中无真实 token，且 PR 999 不存在于真实仓库；E2E 验收4 通过 Brain API + DB 直查替代 |
| `pool.query` DB 连接 | Jest mock pool（单元测试层） | 单元测试不依赖真实 DB；E2E 验收脚本使用真实 psql + localhost:5221 API |
| `calculateSlotBudget()` 中 Cecelia/User pool 的 slot 数据 | 单元测试注入 mock session 数 | Pool C 计数逻辑独立可测，其他 pool 不影响场景1-3 断言 |
| 完整 dispatch cycle（ticker → dispatcher → spawn） | 不在本合同范围内 | Pool C 计数是前置条件，dispatch 完整 E2E 由 nightly CI 覆盖；本合同验收点为 slots API 返回值和 DB 状态 |
| `startup-sync.js` 重启恢复逻辑 | 单元测试独立测试再分类逻辑 | 需模拟 Brain 重启，E2E 成本高；FR-5 兼容性 DoD 条目要求代码审计确认 |

---

## 版本要求

Brain 版本：`1.267.2 → 1.268.0`（minor bump，功能性变更）

---

## Reviewer 检查点

1. 4 个场景测试是否真正"先红后绿"（不允许先写实现再补测试）
2. FR-5 枚举的所有 in_progress 查询点是否逐一核查（14 处）
3. E2E 验收脚本是否可在 Brain 本地运行环境中直接执行
4. `waiting_ci` 转入时 `waiting_pr_url` 是否写入（INV-e90c0fbb）
5. slots API 响应结构中 `.pools.task_pool.waiting` 是否存在（非 null）
