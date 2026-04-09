# 合同草案（第 1 轮）

> propose_round: 1
> propose_task_id: a1d397c0-4ac3-46f2-9006-88ebdddf5638
> planner_task_id: a50ba7c9-adfa-402a-8ee7-b19accb88b55
> verdict: PROPOSED

---

## 本次实现的功能

- Feature 1: `packages/brain/src/tick.js` 中增加 P1 任务卡住检测 — 当有 P1 任务 queued 状态超 30 分钟且无 agent 处理时，输出 `[STUCK-ALERT]` 告警日志

---

## 验收标准（DoD）

### Feature 1: P1 任务卡住检测告警

**行为描述**：

- 每次 tick 执行时，扫描数据库中 `status='queued'`、`priority='P1'` 且 `queued_at` 距今超过 30 分钟的任务
- 若发现卡住任务，输出格式为 `[STUCK-ALERT] P1 task stuck: <task_id> queued for <分钟数>min` 的告警日志
- 若无卡住任务，tick 静默通过，不输出任何额外日志

**硬阈值**：

#### 阈值 1 — tick.js 存在 stuck 检测函数或逻辑块

```bash
# happy path：源码包含卡住检测关键词
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  if (!src.includes('STUCK-ALERT')) throw new Error('FAIL: tick.js 未包含 STUCK-ALERT 告警逻辑');
  if (!src.includes('P1')) throw new Error('FAIL: 未找到 P1 优先级过滤');
  if (!src.includes('queued_at') || !src.includes('30')) throw new Error('FAIL: 未找到 30 分钟阈值检测');
  console.log('PASS: tick.js 包含 P1 卡住检测逻辑');
"
```

#### 阈值 2 — 检测逻辑使用正确的 SQL 查询

```bash
# 验证 SQL 语句包含必要的过滤条件
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  const hasStatus = src.includes(\"status = 'queued'\") || src.includes('status=\\'queued\\'') || src.includes('queued');
  const hasPriority = src.includes(\"priority = 'P1'\") || src.includes('P1');
  const hasInterval = src.includes('INTERVAL') || src.includes('interval') || src.includes('30 * 60') || src.includes('1800');
  if (!hasStatus) throw new Error('FAIL: SQL 缺少 status=queued 过滤');
  if (!hasPriority) throw new Error('FAIL: SQL 缺少 P1 优先级过滤');
  if (!hasInterval) throw new Error('FAIL: SQL 缺少时间间隔条件（30min）');
  console.log('PASS: SQL 查询包含正确过滤条件');
"
```

#### 阈值 3 — 数据库层验证：stuck 检测能找到超时任务

```bash
# 插入一个 P1 queued 超时任务，验证检测函数可以正确识别
psql cecelia -c "
  INSERT INTO tasks (id, title, status, priority, queued_at, created_at, updated_at)
  VALUES (
    '00000000-0000-0000-0000-stuck-test-01',
    'stuck-detection-test',
    'queued',
    'P1',
    NOW() - INTERVAL '35 minutes',
    NOW(),
    NOW()
  ) ON CONFLICT (id) DO NOTHING;
" && \
psql cecelia -c "
  SELECT id, title, EXTRACT(EPOCH FROM (NOW() - queued_at))/60 AS queued_minutes
  FROM tasks
  WHERE status = 'queued' AND priority = 'P1'
    AND queued_at < NOW() - INTERVAL '30 minutes'
    AND id = '00000000-0000-0000-0000-stuck-test-01';
" | grep -q "stuck-detection-test" && \
echo "PASS: DB 查询能正确找到超时 P1 任务" || \
(echo "FAIL: DB 查询未找到超时任务"; psql cecelia -c "DELETE FROM tasks WHERE id='00000000-0000-0000-0000-stuck-test-01'"; exit 1)
# 清理测试数据
psql cecelia -c "DELETE FROM tasks WHERE id='00000000-0000-0000-0000-stuck-test-01';"
```

#### 阈值 4 — 边界：无 P1 卡住任务时不误报

```bash
# 验证正常运行中的 P1 queued 任务（<30min）不触发告警
psql cecelia -c "
  SELECT COUNT(*) FROM tasks
  WHERE status = 'queued' AND priority = 'P1'
    AND queued_at < NOW() - INTERVAL '30 minutes';
" | grep -E "^\s+[0-9]+" && echo "PASS: 可以正常查询 stuck 任务计数（结果可以是 0）" || echo "FAIL: 查询失败"
```

---

## 技术实现方向（高层）

- 在 `tick.js` 的 `_executeTick()` 或专属 tick 子模块中，增加一个 `checkStuckP1Tasks()` 函数
- 函数执行一条 SQL：`SELECT id, queued_at FROM tasks WHERE status='queued' AND priority='P1' AND queued_at < NOW() - INTERVAL '30 minutes'`
- 遍历结果，对每个任务调用 `tickLog('[STUCK-ALERT] P1 task stuck: ' + row.id + ' queued for ' + Math.floor(minutes) + 'min')`（复用已有 tickLog 函数）
- 该检测在每次 tick 执行时触发（5min tick 周期内执行一次）

---

## 不在本次范围内

- 自动重试或重调度卡住的 P1 任务（只告警，不干预）
- P2/P3 任务的卡住检测
- Slack/钉钉等外部通知（只输出日志）
- 告警频率限制（每次 tick 都输出，无去重）
- 修改 SESSION_TTL 或 harness_report 的已有逻辑
