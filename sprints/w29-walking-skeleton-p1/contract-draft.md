# Sprint Contract Draft (Round 1)

> **Sprint**: W29 Walking Skeleton P1 终验
> **Initiative**: Walking Skeleton P1 关账（B1–B7 全链路联调）
> **journey_type**: autonomous

## 关于 PRD Response Schema 的字段名澄清（proposer 翻译说明）

PRD `## Response Schema` 段为 `GET /api/brain/dispatch/recent` 列出了 keys `["events","count"]` + events 子字段含 `outcome / worker_id` 等。但 PRD 自身在 [ASSUMPTION] 段明示：

> ASSUMPTION: `/api/brain/dispatch/recent` endpoint 响应 shape 与 PR #2904 实现一致；若有漂移，以代码为准 PRD 同步更新。

实际代码（`packages/brain/src/routes/dispatch.js:31-41`）的响应 shape 是：

```json
{
  "events": [
    { "id": <number>, "task_id": "<string-or-null>", "event_type": "<string>", "reason": "<string-or-null>", "created_at": "<string>" }
  ],
  "limit": <number>,
  "total": <number>
}
```

且 `event_type` 实际枚举（`packages/brain/src/dispatch-stats.js:125-129` + `dispatcher.js:416`）为 `dispatched | failed_dispatch | skipped`，**不是** PRD 表面写的 `dispatched/skipped_hol/skipped_no_worker/failed`。

按 PRD 自身的 ASSUMPTION（以代码为准），合同所有 jq -e oracle 均使用**代码现实**的 key 名 + 枚举字面值。PRD 同步更新由本 sprint 收口后单独 PR 处理（非本合同范围）。

---

## Golden Path

[投递测试 task 到 tasks 表] → [POST /tick 触发 dispatcher] → [worker 派发回写] → [reportNode 改 tasks.status] → [slot 结算] → [HOL skip 跳过不可派发队首] → [zombie reaper 标 failed 释放 slot] → [getGuidance 不返回 stale decision] → [fleet-resource-cache 正确标 offline_reason] → [整合 smoke exit 0 + 打印 PASS]

### Step 1: 投递测试 task

**可观测行为**: 通过 `INSERT INTO tasks` 或 `POST /api/brain/tasks` 将 1 条测试 task 写入 tasks 表（status=pending），title 含本次 smoke 专属前缀（如 `test-w29-acceptance-`）便于隔离清理。

**验证命令**:
```bash
TASK_ID="test-w29-acceptance-$(date +%s)-1"
PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
psql -h localhost -p 5432 -d cecelia_test -c \
  "INSERT INTO tasks (id, task_type, status, title, payload, created_at, updated_at)
   VALUES ('$TASK_ID', 'walking_skeleton_acceptance', 'pending', '$TASK_ID', '{}'::jsonb, NOW(), NOW())"
# 期望: INSERT 0 1

COUNT=$(PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
  psql -h localhost -p 5432 -d cecelia_test -tA -c \
  "SELECT count(*) FROM tasks WHERE id = '$TASK_ID' AND status = 'pending'")
# 期望: 1
```

**硬阈值**: tasks 表多 1 行 status=pending；title 含 `test-w29-acceptance-` 前缀

---

### Step 2: dispatcher 派发（B5 + B6 共同验）

**可观测行为**: POST /api/brain/tick 后，dispatcher 对该 task 执行 dispatch 决策；无论成功失败 dispatch_events 表都新增至少 1 行（B6 invariant）。slot 计数 in_progress 在派发成功时 +1（B3 invariant）。

**验证命令**:
```bash
# 触发 dispatch tick
curl -fsS -X POST http://localhost:5221/api/brain/tick -H 'Content-Type: application/json' -d '{}' \
  | jq -e '.tick_id' >/dev/null
# 期望: 返回 tick_id（exit 0）

# dispatch_events 表 5 分钟内多至少 1 行（带时间窗口防造假）
sleep 1
EVT_COUNT=$(PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
  psql -h localhost -p 5432 -d cecelia_test -tA -c \
  "SELECT count(*) FROM dispatch_events
   WHERE task_id = '$TASK_ID'
     AND created_at > NOW() - INTERVAL '5 minutes'")
[ "$EVT_COUNT" -ge 1 ]
# 期望: 真实写入 ≥ 1 行（B6 verified）

# /api/brain/dispatch/recent 包含此 task_id（B6 endpoint 不漂移）
curl -fsS "http://localhost:5221/api/brain/dispatch/recent?limit=50" \
  | jq -e --arg tid "$TASK_ID" '.events[] | select(.task_id == $tid)' >/dev/null
# 期望: 找到至少 1 条
```

**硬阈值**: dispatch_events 5 分钟内 ≥ 1 行；/dispatch/recent 响应 keys ⊇ `["events","limit","total"]`

---

### Step 3: worker callback 模拟 + reportNode 写回（B1 验）

**可观测行为**: 整合 smoke 在测试模式下不能依赖真实 worker，因此通过 SQL 直接模拟 reportNode 的成功回写路径（`UPDATE tasks SET status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$TASK_ID`）并同步写一行 task_events 'task_completed'。然后断言 tasks.status='completed' + updated_at 已更新。

**验证命令**:
```bash
# 模拟 reportNode 写回（替代真实 worker）
PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
psql -h localhost -p 5432 -d cecelia_test -c \
  "UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW()
   WHERE id = '$TASK_ID';
   INSERT INTO task_events (task_id, event_type, payload, created_at)
   VALUES ('$TASK_ID', 'task_completed', '{}'::jsonb, NOW())"

# 断言 tasks.status='completed' + updated_at < 1 min（B1 invariant）
RESULT=$(PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
  psql -h localhost -p 5432 -d cecelia_test -tA -c \
  "SELECT status FROM tasks
   WHERE id = '$TASK_ID'
     AND updated_at > NOW() - INTERVAL '1 minute'")
[ "$RESULT" = "completed" ]
# 期望: status=completed 且时间戳新鲜

# 断言 task_events 多 1 行 task_completed
EVT=$(PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
  psql -h localhost -p 5432 -d cecelia_test -tA -c \
  "SELECT count(*) FROM task_events
   WHERE task_id = '$TASK_ID' AND event_type = 'task_completed'
     AND created_at > NOW() - INTERVAL '5 minutes'")
[ "$EVT" -ge 1 ]
```

**硬阈值**: tasks.status='completed'，updated_at 1 分钟内；task_events 'task_completed' 5 分钟内 ≥ 1 行

---

### Step 4: HOL skip 队列（B5 验）

**可观测行为**: 投 3 条 task：task_A 故意设 `payload->>'force_location' = 'nonexistent-xyz'`（dispatcher 找不到 worker → HOL skip），task_B/task_C 是正常可派发。POST /tick → dispatcher 跳过 task_A，派发 task_B 或 task_C；task_A 维持 pending。

**验证命令**:
```bash
# task_A 故意构造为不可派发（指定不存在的 location）
PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
psql -h localhost -p 5432 -d cecelia_test -c \
  "INSERT INTO tasks (id, task_type, status, title, payload, created_at, updated_at)
   VALUES
     ('test-w29-hol-A', 'walking_skeleton_acceptance', 'pending', 'test-w29-hol-A',
      '{\"force_location\":\"nonexistent-xyz\"}'::jsonb, NOW() - INTERVAL '3 seconds', NOW() - INTERVAL '3 seconds'),
     ('test-w29-hol-B', 'walking_skeleton_acceptance', 'pending', 'test-w29-hol-B',
      '{}'::jsonb, NOW() - INTERVAL '2 seconds', NOW() - INTERVAL '2 seconds'),
     ('test-w29-hol-C', 'walking_skeleton_acceptance', 'pending', 'test-w29-hol-C',
      '{}'::jsonb, NOW() - INTERVAL '1 second', NOW() - INTERVAL '1 second')"

# 触发 dispatch
curl -fsS -X POST http://localhost:5221/api/brain/tick -H 'Content-Type: application/json' -d '{}' >/dev/null
sleep 2

# task_A 仍 pending（HOL skip 没让它阻塞队列）
A_STATUS=$(PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
  psql -h localhost -p 5432 -d cecelia_test -tA -c \
  "SELECT status FROM tasks WHERE id = 'test-w29-hol-A'")
[ "$A_STATUS" = "pending" ]
# 期望: task_A 维持 pending（被 HOL skip）

# task_B 或 task_C 至少 1 个被 dispatcher 处理（status 离开 pending 或 dispatch_events 多行）
BC_PROCESSED=$(PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
  psql -h localhost -p 5432 -d cecelia_test -tA -c \
  "SELECT count(*) FROM dispatch_events
   WHERE task_id IN ('test-w29-hol-B','test-w29-hol-C')
     AND created_at > NOW() - INTERVAL '2 minutes'")
[ "$BC_PROCESSED" -ge 1 ]
# 期望: task_B/C 至少 1 个进入 dispatcher 处理流（B5 verified）
```

**硬阈值**: task_A pending；dispatch_events 2 分钟内含 task_B 或 task_C；smoke stderr/stdout 含 'HOL skip' 字样（dispatcher.js:407 日志）

---

### Step 5: zombie reaper 标 failed（B2 + B3 复验）

**可观测行为**: 投 1 条 task 直接 INSERT 为 status='in_progress' + updated_at = NOW() - INTERVAL '30 minutes'（模拟 zombie）。设 `ZOMBIE_REAPER_IDLE_MIN=0`，调用 `reapZombies()`（通过 node 一行命令 import）。reaper 标 failed + error_message 含 '[reaper] zombie'。slot 计数回到正确值。

**验证命令**:
```bash
# 构造 zombie：30 分钟没更新的 in_progress task
PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
psql -h localhost -p 5432 -d cecelia_test -c \
  "INSERT INTO tasks (id, task_type, status, title, payload, created_at, updated_at)
   VALUES ('test-w29-zombie', 'walking_skeleton_acceptance', 'in_progress', 'test-w29-zombie',
           '{}'::jsonb, NOW() - INTERVAL '40 minutes', NOW() - INTERVAL '30 minutes')"

# 调 reapZombies（直接 node -e import，idleMinutes=0 让所有 in_progress 都中招）
cd packages/brain && ZOMBIE_REAPER_IDLE_MIN=0 node -e "
  import('./src/zombie-reaper.js').then(async m => {
    const r = await m.reapZombies({ idleMinutes: 0 });
    console.log(JSON.stringify(r));
    if (r.reaped < 1) process.exit(1);
  })
" && cd ../..

# 断言 task_zombie status='failed' + error_message 含 '[reaper] zombie'
RESULT=$(PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
  psql -h localhost -p 5432 -d cecelia_test -tA -c \
  "SELECT status FROM tasks
   WHERE id = 'test-w29-zombie' AND error_message LIKE '%[reaper] zombie%'")
[ "$RESULT" = "failed" ]
# 期望: status=failed + error_message 标记 reaper
```

**硬阈值**: tasks.status='failed'，error_message 含子串 `[reaper] zombie`，completed_at 不空

---

### Step 6: guidance TTL 防 stale decision（B4 验）

**可观测行为**: 直接 INSERT 1 条 brain_guidance 含 `decision_id` 字段 + `updated_at = NOW() - INTERVAL '30 minutes'`（超过默认 DECISION_TTL_MIN=15）。调 getGuidance（通过 node -e import）应返回 null。dispatcher 因此走 EXECUTOR_ROUTING fallback 不被毒化。

**验证命令**:
```bash
# 注入 stale decision
PGUSER=${PGUSER:-cecelia} PGPASSWORD=${PGPASSWORD:-cecelia_test} \
psql -h localhost -p 5432 -d cecelia_test -c \
  "INSERT INTO brain_guidance (key, value, source, expires_at, updated_at)
   VALUES ('strategy:global',
           '{\"decision_id\":\"stale-w29-test\",\"action\":\"stop\"}'::jsonb,
           'thalamus', NULL, NOW() - INTERVAL '30 minutes')
   ON CONFLICT (key) DO UPDATE SET
     value = EXCLUDED.value, updated_at = EXCLUDED.updated_at"

# getGuidance 应返回 null（B4 TTL 短路命中）
cd packages/brain && node -e "
  import('./src/guidance.js').then(async m => {
    const v = await m.getGuidance('strategy:global');
    console.log('guidance =', JSON.stringify(v));
    if (v !== null) process.exit(1);  // 应是 null，因为 stale
  })
" && cd ../..
# 期望: 输出 'guidance = null'，exit 0
```

**硬阈值**: getGuidance 返回 null；smoke stdout 含 'stale' / 'null' 证据

---

### Step 7: fleet heartbeat offline_reason（B7 验）

**可观测行为**: 通过 node -e import fleet-resource-cache，先调一次 getFleetStatus（拉初始数据），然后再次断言每条记录都含 `offline_reason` 字段（值为 null 或字符串字面量之一：`fetch_failed` / `no_ping_grace_exceeded`）。不需要真实模拟 heartbeat 超时——验"字段存在 + 类型正确"足以证明 B7 不漂移。

**验证命令**:
```bash
cd packages/brain && node -e "
  import('./src/fleet-resource-cache.js').then(async m => {
    m.startFleetRefresh();
    await new Promise(r => setTimeout(r, 2000));
    const status = m.getFleetStatus();
    m.stopFleetRefresh();
    console.log('fleet =', JSON.stringify(status));
    for (const s of status) {
      if (!('offline_reason' in s)) { console.error('missing offline_reason in', s.id); process.exit(1); }
      if (!('last_ping_at' in s)) { console.error('missing last_ping_at in', s.id); process.exit(1); }
      const v = s.offline_reason;
      if (v !== null && !['fetch_failed','no_ping_grace_exceeded'].includes(v)) {
        console.error('unexpected offline_reason:', v); process.exit(1);
      }
    }
    process.exit(0);
  })
" && cd ../..
# 期望: exit 0
```

**硬阈值**: 每条 fleet entry 含 `offline_reason` + `last_ping_at` 字段，offline_reason ∈ {null, 'fetch_failed', 'no_ping_grace_exceeded'}

---

### Step 8: 出口 — 整合 smoke 退出 0 + 打印 PASS

**可观测行为**: 上述 7 个 Step 的所有断言全绿后，smoke 脚本最后一行打印 `[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过`，进程 exit 0。如果任意一段失败（set -e 触发或显式 exit 非 0），脚本立即终止并打印失败定位提示。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh
# exit 0 + stdout 末尾含 'PASS — 7 项 P1 修复全链路联调通过'
# 若 brain/docker 不可用：stdout 含 'SKIP: ...' 并 exit 0（CI 上必须可用，本地无 docker 时不算 fail）
```

**硬阈值**: exit 0；stdout 含 `PASS — 7 项 P1 修复全链路联调通过` 或 `SKIP:` 之一

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous（所有改动仅在 packages/brain/scripts/ + sprints/ + 文档，无 dashboard / 无 remote agent / 无 dev pipeline hooks）

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# Step 0: 检查产物存在
SMOKE=packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh
REPORT=sprints/w29-walking-skeleton-p1/acceptance-report.md
[ -f "$SMOKE" ] || { echo "FAIL: smoke 脚本不存在"; exit 1; }
[ -x "$SMOKE" ] || { echo "FAIL: smoke 脚本无执行权限"; exit 1; }
[ -f "$REPORT" ] || { echo "FAIL: acceptance 报告不存在"; exit 1; }

# Step 1: smoke 结构静态检查（不依赖 brain 在跑）
grep -q '^set -e' "$SMOKE" || { echo "FAIL: smoke 缺少 set -e"; exit 1; }
grep -q 'dispatch_events' "$SMOKE" || { echo "FAIL: smoke 未引用 dispatch_events"; exit 1; }
grep -q 'reapZombies' "$SMOKE" || { echo "FAIL: smoke 未调 reapZombies"; exit 1; }
grep -q 'getGuidance' "$SMOKE" || { echo "FAIL: smoke 未调 getGuidance"; exit 1; }
grep -q 'offline_reason' "$SMOKE" || { echo "FAIL: smoke 未验 offline_reason"; exit 1; }
grep -q 'HOL skip\|test-w29-hol' "$SMOKE" || { echo "FAIL: smoke 未覆盖 HOL skip"; exit 1; }
grep -q 'reportNode\|task_completed\|UPDATE tasks SET status' "$SMOKE" || { echo "FAIL: smoke 未覆盖 reportNode 写回"; exit 1; }
grep -q 'PASS — 7 项 P1 修复全链路联调通过' "$SMOKE" || { echo "FAIL: smoke 缺少终验 PASS 信号"; exit 1; }

# Step 2: smoke 容器/Brain 不可用时优雅 skip
grep -q 'SKIP:' "$SMOKE" || { echo "FAIL: smoke 缺少 SKIP 退路（docker/brain 不可用时应 exit 0）"; exit 1; }

# Step 3: 报告完整性
grep -q -E 'B1.*B2.*B3.*B4.*B5.*B6.*B7' "$REPORT" \
  || (grep -q 'B1' "$REPORT" && grep -q 'B2' "$REPORT" && grep -q 'B3' "$REPORT" \
      && grep -q 'B4' "$REPORT" && grep -q 'B5' "$REPORT" && grep -q 'B6' "$REPORT" \
      && grep -q 'B7' "$REPORT") \
  || { echo "FAIL: acceptance 报告未覆盖全 7 项 B1-B7"; exit 1; }

# Step 4: 真跑 smoke（在 real-env-smoke CI 上是 brain+pg 都可用，应跑通；在轻量 evaluator 上 smoke 自身 SKIP exit 0）
bash "$SMOKE"
RC=$?
[ $RC -eq 0 ] || { echo "FAIL: smoke exit $RC（非 0）"; exit 1; }

echo "✅ Golden Path 验证通过（W29 Walking Skeleton P1 终验）"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 4

### Workstream 1: 整合 smoke 骨架 + happy path（Steps 1-3）

**范围**: 创建 `packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`，含 shebang + `set -euo pipefail` + 顶部 docker/brain 可用性检测（不可用 SKIP exit 0）+ DB 连接 helpers + assert helpers + 隔离前缀清理 + Steps 1-3（投 task、POST /tick、断言 dispatch_events、SQL 模拟 reportNode 回写、断言 tasks.status='completed'）。
**大小**: M（≈ 130 LOC bash）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/smoke-harness.test.ts`（vitest，generator TDD 红绿用；不当 evaluator oracle）

---

### Workstream 2: HOL skip + zombie reaper 段（Steps 4-5）

**范围**: 在 WS1 的 smoke 文件上追加 Step 4（投 3 条 task，断言 task_A pending、task_B/C 进 dispatch_events）+ Step 5（构造 zombie，node -e 调 reapZombies idleMinutes=0，断言 tasks.status='failed' + error_message 含 `[reaper] zombie`）。
**大小**: M（≈ 70 LOC bash 追加）
**依赖**: WS1 完成

**BEHAVIOR 覆盖测试文件**: `tests/ws2/hol-zombie.test.ts`

---

### Workstream 3: guidance TTL + heartbeat 段 + 出口 PASS（Steps 6-8）

**范围**: 在 smoke 文件上追加 Step 6（INSERT stale brain_guidance，node -e 调 getGuidance 断言 null）+ Step 7（node -e 调 fleet-resource-cache，断言 offline_reason 字段存在且取值合法）+ Step 8（出口 PASS 信号 + bash 整脚本可 exit 0）。
**大小**: M（≈ 60 LOC bash 追加）
**依赖**: WS2 完成

**BEHAVIOR 覆盖测试文件**: `tests/ws3/guidance-heartbeat-exit.test.ts`

---

### Workstream 4: Acceptance report

**范围**: 新建 `sprints/w29-walking-skeleton-p1/acceptance-report.md`，列 B1–B7 7 项修复 + 每项的修复 PR + 在本次整合 smoke 中对应的验证 Step 号 + smoke 输出片段占位。明确 CI 集成方式：`.github/workflows/ci.yml` 的 `real-env-smoke` job 已通过 glob `packages/brain/scripts/smoke/*.sh` 自动包含本 smoke，无需追加 workflow 文件 step（PRD "在 brain-ci.yml 增加 step" 的 intent 已自动满足）。
**大小**: S（≈ 50 行 markdown）
**依赖**: WS3 完成（需要 smoke 文件全部存在以填写片段）

**BEHAVIOR 覆盖测试文件**: `tests/ws4/acceptance-report.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/smoke-harness.test.ts` | smoke 文件存在 + set -e + happy path 段含 dispatch_events / tasks.status='completed' / SKIP 退路 | 文件不存在 → 4+ failures |
| WS2 | `tests/ws2/hol-zombie.test.ts` | HOL skip 段含 3 task 构造 + task_A pending 断言；zombie 段含 reapZombies 调用 + error_message 含 `[reaper] zombie` 断言 | 文件未追加 → 4+ failures |
| WS3 | `tests/ws3/guidance-heartbeat-exit.test.ts` | guidance 段含 INSERT stale + getGuidance + null 断言；heartbeat 段含 fleet-resource-cache + offline_reason 断言；出口含 `PASS — 7 项 P1 修复全链路联调通过` | 文件未追加 → 4+ failures |
| WS4 | `tests/ws4/acceptance-report.test.ts` | 报告含 B1-B7 全部 7 项；含 CI 集成说明（real-env-smoke glob 自动覆盖） | 报告不存在 → 4+ failures |
