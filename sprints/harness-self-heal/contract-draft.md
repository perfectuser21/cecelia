# Sprint Contract Draft (Round 3)

## Golden Path
[Brain tick 30s] → [容器健康检查] → [幂等派发 harness_intervention] → [Skill 读日志+诊断+修复] → [30s 等待验证] → [未恢复→Bark 告警] → [结果写 cecelia_events]

---

### Step 0: harness_intervention 路由配置前置注册
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：harness-container-monitor.js 创建 harness_intervention 任务时 Brain 必须能路由该类型到 executor；若未在 VALID_TASK_TYPES + LOCATION_MAP 预先注册，task 创建会被 Brain 拒绝或路由到错误机器，导致 WS2 实现完成但无法派发。

**可观测行为**: `task-router.js` 的 `VALID_TASK_TYPES` 数组包含 `'harness_intervention'`，`LOCATION_MAP` 映射 `harness_intervention → 'us'`；`packages/brain/.env` 存在 `BARK_TOKEN=...` 行 **且** `FEISHU_WEBHOOK=` 行（飞书中间层降级所需）。

**验证命令**:
```bash
# LOCATION_MAP 注册
node -e "
  const src = require('fs').readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!src.match(/'harness_intervention':\s*'us'/)) { console.error('FAIL: LOCATION_MAP 缺 harness_intervention'); process.exit(1); }
  if (!src.includes(\"'harness_intervention'\")) { console.error('FAIL: VALID_TASK_TYPES 缺 harness_intervention'); process.exit(1); }
  console.log('OK');
"
# BARK_TOKEN + FEISHU_WEBHOOK 行存在
node -e "
  const src = require('fs').readFileSync('packages/brain/.env', 'utf8');
  if (!src.includes('BARK_TOKEN=')) { console.error('FAIL: .env 缺 BARK_TOKEN'); process.exit(1); }
  if (!src.includes('FEISHU_WEBHOOK=')) { console.error('FAIL: .env 缺 FEISHU_WEBHOOK（飞书中间层降级需预留）'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 两个命令均 exit 0（.env 含 BARK_TOKEN= 行 + FEISHU_WEBHOOK= 行）

---

### Step 1: Brain tick 每 30s 调用 harness-container-monitor（MINIMAL_MODE 跳过）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条："Brain tick 每 30s 执行一次 `harness-container-monitor`（MINIMAL_MODE 跳过）"

**可观测行为**: `tick-runner.js` 包含对 `harness-container-monitor` 的动态 import 调用；调用被 `!MINIMAL_MODE` 守护；注册了 30s 间隔的 `tickState.lastContainerMonitorTime` 节拍计数器。

**验证命令**:
```bash
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick-runner.js', 'utf8');
  if (!src.includes('harness-container-monitor')) { console.error('FAIL: tick-runner.js 未注册 monitor'); process.exit(1); }
  if (!src.includes('CONTAINER_MONITOR_INTERVAL_MS') && !src.includes('lastContainerMonitor')) {
    console.error('FAIL: 缺 30s 间隔配置'); process.exit(1);
  }
  console.log('OK');
"
```

**硬阈值**: exit 0，且文件包含 `harness-container-monitor` 字符串

---

### Step 2: 监控检测容器异常（三类异常场景）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条：容器 exited / Claude 进程死但容器活 / 容器活但等待已失败 CI

**可观测行为**: `harness-container-monitor.js` 导出 `checkHarnessContainers` 函数，**函数签名**：`checkHarnessContainers(opts: { pool: Pool, dockerUnavailable?: boolean }): Promise<void>`。该函数：(1) `dockerUnavailable === true` 时跳过 docker 调用，仅 warn 日志 return（测试可注入此 flag）；(2) 正常路径运行 `docker ps --filter name=harness-` 获取容器列表；(3) 检测三类异常；(4) docker CLI 实际不可用时捕获错误，记录 warn 日志并 return（不 throw）

**验证命令**:
```bash
# 函数存在且可导入
node --input-type=module -e "
  const { checkHarnessContainers } = await import('./packages/brain/src/harness-container-monitor.js');
  if (typeof checkHarnessContainers !== 'function') { console.error('FAIL: 导出缺 checkHarnessContainers'); process.exit(1); }
  console.log('OK');
" || { echo "FAIL: 模块导入失败"; exit 1; }
```

**硬阈值**: exit 0，`checkHarnessContainers` 为函数类型

---

### Step 3: Brain 幂等派发 harness_intervention 任务（同一 initiative 防重复）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 边界情况："同一 initiative 已有进行中的 intervention → 跳过重复派发（幂等保护）"

**可观测行为**: `harness-container-monitor.js` 导出 `createInterventionTask(pool, opts)` 函数，向 `tasks` 表写入 `task_type='harness_intervention'` 记录；写入前检查同 initiative_id 是否已有 `status IN ('queued','in_progress')` 的 intervention task。

**验证命令**:
```bash
DB=${DB_URL:-postgresql://localhost/cecelia}
# 注入测试 initiative
TEST_INIT=$(psql $DB -t -c "
  INSERT INTO initiative_runs (initiative_id, phase, started_at, deadline_at)
  VALUES (gen_random_uuid(), 'B_task_loop', NOW(), NOW() + interval '2 hours')
  RETURNING initiative_id" | tr -d ' \n')

# 调用 createInterventionTask
node --input-type=module -e "
  const { createInterventionTask } = await import('./packages/brain/src/harness-container-monitor.js');
  const pool = (await import('./packages/brain/src/db.js')).default;
  await createInterventionTask(pool, { initiativeId: '${TEST_INIT}', reason: 'test_container_exited', anomalyType: 'exited' });
  console.log('OK');
" || { echo "FAIL: createInterventionTask 调用失败"; exit 1; }

# 验证 DB 写入（带时间窗口）
COUNT=$(psql $DB -t -c "
  SELECT count(*) FROM tasks
  WHERE task_type='harness_intervention'
    AND payload::text LIKE '%${TEST_INIT}%'
    AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无 intervention 记录"; exit 1; }

# 幂等：再次调用应 skip
node --input-type=module -e "
  const { createInterventionTask } = await import('./packages/brain/src/harness-container-monitor.js');
  const pool = (await import('./packages/brain/src/db.js')).default;
  const result = await createInterventionTask(pool, { initiativeId: '${TEST_INIT}', reason: 'duplicate', anomalyType: 'exited' });
  if (result && result.skipped !== true) { process.exit(1); }
  console.log('OK idempotent');
" || { echo "FAIL: 幂等保护未生效"; exit 1; }
```

**硬阈值**: 第一次写入 count ≥ 1，第二次 `result.skipped === true`

---

### Step 4: Intervention Skill 读日志 + checkpoint + 合同文件
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条："Intervention Skill 读容器最后 200 行日志 + Brain checkpoint + sprint 合同文件"

**可观测行为**: `packages/engine/skills/harness-intervention/SKILL.md` 存在，包含 `docker logs --tail 200`、`checkpoint`、`contract` 三个关键词，并描述 Brain API 不可达时的降级策略。

**验证命令**:
```bash
SKILL_MD="packages/engine/skills/harness-intervention/SKILL.md"
node -e "
  const src = require('fs').readFileSync('${SKILL_MD}', 'utf8');
  const required = ['docker logs', 'checkpoint', 'contract', 'BARK_TOKEN'];
  for (const kw of required) {
    if (!src.includes(kw)) { console.error('FAIL: SKILL.md 缺关键词:', kw); process.exit(1); }
  }
  console.log('OK');
"
```

**硬阈值**: 4 个关键词均存在，exit 0

---

### Step 5: 执行对应修复操作（CI 未触发 / PR 未推 / Brain 状态错误）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条："识别卡死类型：CI 未触发 / PR 未推 / Brain 状态错误 → 执行对应外部操作"

**可观测行为**: SKILL.md 包含三类卡死类型的识别逻辑描述，以及对应操作（gh pr create / git push / curl Brain API）

**验证命令**:
```bash
SKILL_MD="packages/engine/skills/harness-intervention/SKILL.md"
node -e "
  const src = require('fs').readFileSync('${SKILL_MD}', 'utf8');
  const patterns = ['CI 未触发', 'PR 未推', 'Brain 状态'];
  const missing = patterns.filter(p => !src.includes(p));
  if (missing.length > 0) { console.error('FAIL: SKILL.md 缺卡死类型描述:', missing); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 三类卡死描述均存在

---

### Step 6: 等 30s 验证恢复（容器重新有日志输出）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条："等 30s 验证 pipeline 是否恢复（容器重新有日志输出）"

**可观测行为**: SKILL.md 包含 `30s` 等待描述和 `docker logs` 重新检查步骤。

**验证命令**:
```bash
SKILL_MD="packages/engine/skills/harness-intervention/SKILL.md"
node -e "
  const src = require('fs').readFileSync('${SKILL_MD}', 'utf8');
  if (!src.match(/30s|30 秒|30 second/i)) { console.error('FAIL: SKILL.md 缺 30s 等待描述'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 7: 未恢复 → Bark 告警（降级：Bark → 飞书 → cecelia_events）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 条 + 边界情况："未恢复 → 发送 Bark 告警；Bark token 未配置 → 降级到飞书告警，都无则写 DB cecelia_events"

**可观测行为**: `harness-container-monitor.js` 在确认未恢复后执行降级告警链：(1) 读取 `process.env.BARK_TOKEN`，有值则 `curl` 推送 Bark 通知；(2) Bark 失败或 token 不存在，尝试飞书 webhook；(3) 两者都无/都失败，向 `cecelia_events` 写 `event_type='intervention_alert_fallback'`。SKILL.md 亦描述此三级降级策略。

**验证命令**:
```bash
node -e "
  const src = require('fs').readFileSync('packages/brain/src/harness-container-monitor.js', 'utf8');
  // 三级降级链：Bark → 飞书 → cecelia_events，三处均须有实现证据
  if (!src.match(/BARK_TOKEN|bark|sendBark/i)) { console.error('FAIL: 缺 Bark 告警集成（第1级）'); process.exit(1); }
  if (!src.match(/FEISHU_WEBHOOK|feishu|lark/i)) { console.error('FAIL: 缺飞书中间层集成（第2级，Bark→飞书→cecelia_events 三级链）'); process.exit(1); }
  if (!src.includes('cecelia_events')) { console.error('FAIL: 缺 cecelia_events 降级兜底（第3级）'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: monitor 文件包含 BARK_TOKEN + FEISHU_WEBHOOK/feishu/lark + cecelia_events 三处引用（对应完整三级降级链）

---

### Step 8: 结果写入 cecelia_events（intervention_result）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 8 条："每次介入结果写入 Brain `cecelia_events`（intervention_result）"

**可观测行为**: `harness-container-monitor.js` 在介入结束后向 `cecelia_events` 写入 `event_type='intervention_result'`，`source='harness_container_monitor'`，`payload` 含 `{ initiativeId, anomalyType, recovered, alertSent }`

**验证命令**:
```bash
node -e "
  const src = require('fs').readFileSync('packages/brain/src/harness-container-monitor.js', 'utf8');
  if (!src.includes('cecelia_events')) { console.error('FAIL: 未写 cecelia_events'); process.exit(1); }
  if (!src.includes('intervention_result')) { console.error('FAIL: 缺 event_type intervention_result'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 两个关键词均存在

---

## E2E 验收（final-e2e — local_api + autonomous）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e
DB=${DB_URL:-postgresql://localhost/cecelia}

echo "=== Harness Pipeline 自愈监控 E2E 验收 ==="

# === 1. 静态验证：路由配置已注册 ===
echo "[1/6] 验证 LOCATION_MAP + VALID_TASK_TYPES..."
node -e "
  const src = require('fs').readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!src.match(/'harness_intervention':\s*'us'/)) process.exit(1);
  console.log('OK');
" || { echo "FAIL: harness_intervention 未注册到 LOCATION_MAP(us)"; exit 1; }

# === 2. 静态验证：.env 有 BARK_TOKEN + FEISHU_WEBHOOK ===
echo "[2/6] 验证 BARK_TOKEN + FEISHU_WEBHOOK 配置..."
node -e "
  const src = require('fs').readFileSync('packages/brain/.env', 'utf8');
  if (!src.includes('BARK_TOKEN=')) { console.error('FAIL: .env 缺 BARK_TOKEN'); process.exit(1); }
  if (!src.includes('FEISHU_WEBHOOK=')) { console.error('FAIL: .env 缺 FEISHU_WEBHOOK'); process.exit(1); }
  console.log('OK');
" || { echo "FAIL: .env 缺 BARK_TOKEN 或 FEISHU_WEBHOOK"; exit 1; }

# === 3. 静态验证：容器监控文件存在且导出正确 ===
echo "[3/6] 验证 harness-container-monitor 模块..."
node --input-type=module -e "
  const m = await import('./packages/brain/src/harness-container-monitor.js');
  if (typeof m.checkHarnessContainers !== 'function') process.exit(1);
  if (typeof m.createInterventionTask !== 'function') process.exit(1);
  console.log('OK');
" || { echo "FAIL: container-monitor 模块导出不完整"; exit 1; }

# === 4. 静态验证：Intervention Skill 存在且包含必要段落 ===
echo "[4/6] 验证 Intervention Skill SKILL.md..."
SKILL_MD="packages/engine/skills/harness-intervention/SKILL.md"
node -e "
  const src = require('fs').readFileSync('${SKILL_MD}', 'utf8');
  for (const kw of ['docker logs', 'checkpoint', 'contract', 'BARK_TOKEN', '30s']) {
    if (!src.includes(kw)) { console.error('FAIL: 缺', kw); process.exit(1); }
  }
  console.log('OK');
" || { echo "FAIL: SKILL.md 内容不完整"; exit 1; }

# === 5. 动态验证：注入测试 initiative，验证 intervention dispatch ===
echo "[5/6] 验证 intervention task dispatch..."
TEST_INIT=$(psql $DB -t -c "
  INSERT INTO initiative_runs (initiative_id, phase, started_at, deadline_at)
  VALUES (gen_random_uuid(), 'B_task_loop', NOW(), NOW() + interval '2 hours')
  RETURNING initiative_id" | tr -d ' \n')
[ -n "$TEST_INIT" ] || { echo "FAIL: 无法创建测试 initiative_run"; exit 1; }

node --input-type=module -e "
  const { createInterventionTask } = await import('./packages/brain/src/harness-container-monitor.js');
  const pool = (await import('./packages/brain/src/db.js')).default;
  const res = await createInterventionTask(pool, { initiativeId: '${TEST_INIT}', reason: 'e2e_test', anomalyType: 'container_exited' });
  if (!res || res.skipped) { console.error('FAIL: task 未创建'); process.exit(1); }
  console.log('OK taskId=' + res.taskId);
" || { echo "FAIL: createInterventionTask 执行失败"; exit 1; }

COUNT=$(psql $DB -t -c "
  SELECT count(*) FROM tasks
  WHERE task_type='harness_intervention'
    AND payload::text LIKE '%${TEST_INIT}%'
    AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: DB tasks 无 intervention 记录"; exit 1; }

# === 6. 动态验证：幂等保护（重复调用 skip） ===
echo "[6/6] 验证幂等保护..."
node --input-type=module -e "
  const { createInterventionTask } = await import('./packages/brain/src/harness-container-monitor.js');
  const pool = (await import('./packages/brain/src/db.js')).default;
  const res = await createInterventionTask(pool, { initiativeId: '${TEST_INIT}', reason: 'duplicate', anomalyType: 'container_exited' });
  if (!res || res.skipped !== true) { console.error('FAIL: 幂等未生效 skipped=' + res?.skipped); process.exit(1); }
  console.log('OK skipped=true');
" || { echo "FAIL: 幂等保护未生效"; exit 1; }

echo ""
echo "✅ Harness Pipeline 自愈监控 E2E 验收通过（6/6）"
```

---

## Workstreams

workstream_count: 3

---

### Workstream 1: 路由配置前置注册（LOCATION_MAP + .env）

**范围**: `task-router.js` 新增 `harness_intervention` 到 VALID_TASK_TYPES 和 LOCATION_MAP(us)；`packages/brain/.env` 写入 BARK_TOKEN + FEISHU_WEBHOOK=（飞书中间层预留）
**大小**: S（<15 行净增，2 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/task-router-routing.test.ts`

---

### Workstream 2: harness-container-monitor.js + tick-runner.js 注册

**范围**: 新建 `packages/brain/src/harness-container-monitor.js`（容器健康检查 + dispatch + 幂等 + Bark + cecelia_events）；`tick-runner.js` 注册 30s 节拍（MINIMAL_MODE 守护）
**大小**: M（~170 行净增，2 文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/container-monitor.test.ts`

---

### Workstream 3: Intervention Skill SKILL.md

**范围**: 新建 `packages/engine/skills/harness-intervention/SKILL.md`（日志读取 + checkpoint + 卡死类型识别 + 修复操作 + 30s 验证 + Bark 降级告警）
**大小**: M（~120 行净增，1 文件）
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/skill-md-structure.test.ts`

---

## Workstreams 切分检查

| WS | 文件数 | 预期净增行数 | 超限？ |
|---|---|---|---|
| WS1 | 2 | ~15 | 否 |
| WS2 | 2 | ~170 | 否（≤200） |
| WS3 | 1 | ~120 | 否 |

## Risks

| # | 风险 | 概率 | 影响 | Mitigation |
|---|---|---|---|---|
| R1 | docker CLI 不可用（容器环境权限/未安装） | Medium | Medium | `checkHarnessContainers` 捕获 `ENOENT`/spawn 错误，记录 `warn` 日志并提前 return（不 throw），tick loop 继续正常运行；`dockerUnavailable: true` 注入 flag 可在单测中模拟此路径 |
| R2 | Brain DB 写入失败（`cecelia_events` INSERT 超时/连接断） | Low | Low | `cecelia_events` 写入用独立 `try/catch` 包裹，写失败不阻塞主告警流程（Bark 仍发），仅在 stderr 输出 error 日志；避免单点故障扩散 |
| R3 | 幂等竞争——两个 tick 并发 dispatch 同一 initiative | Low | Medium | `createInterventionTask` 使用内联 SQL 字面量查询（非参数化）+ `INSERT ... SELECT ... WHERE NOT EXISTS` 或 application-level SELECT-before-INSERT，确保 mock 可拦截且逻辑可测试；PRD 要求"同一 initiative 已有 in_progress intervention → 跳过"，函数返回 `{ skipped: true }` |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/task-router-routing.test.ts` | LOCATION_MAP 含 harness_intervention + BARK_TOKEN 写入 | 修改前 → 2 failures |
| WS2 | `tests/ws2/container-monitor.test.ts` | dispatch + 幂等 + docker失败降级 + cecelia_events写入 | 文件不存在 → 4 failures |
| WS3 | `tests/ws3/skill-md-structure.test.ts` | SKILL.md 结构完整性 + 必要关键词 | 文件不存在 → 4 failures |
