# Sprint Contract Draft (Round 5)

> sprint: Harness v4.0 E2E 全链路验证
> planner_task_id: b26e5c34-88f9-4fa9-b897-ce58df8bf473
> propose_round: 5
> revision_note: |
>   R5 修订（针对 Round 4 Review 反馈）：
>   1. Feature 4 边界验证命令：uptime 阈值 60s → 180s
>      依据：TICK_INTERVAL_MINUTES = 2min（见 packages/brain/src/tick.js:76）
>      180s = 2min × 60 × 1.5，给一次完整 tick 留足 1.5 倍缓冲时间
>   2. 同步更新 Feature 4 硬阈值描述中的 uptime 阈值说明

---

## Feature 1: `/api/brain/health` 响应包含 `tick_stats` 字段且结构正确

**行为描述**:

运维人员调用 `GET /api/brain/health`，响应 JSON 中必须存在 `tick_stats` 对象，该对象至少包含以下三个字段：
- `total_executions`：整数（≥ 0），表示 Brain 启动以来 tick 执行总次数
- `last_executed_at`：字符串（格式 `YYYY-MM-DD HH:mm:ss`，上海时区 UTC+8）或 `null`
- `last_duration_ms`：数字（毫秒，≥ 0）或 `null`

**硬阈值**:
- 响应 HTTP 状态码为 200
- 响应 JSON 中 `tick_stats` 字段必须存在（非 `undefined`、非 `null`，类型为 object）
- `tick_stats.total_executions` 类型为 number，值 ≥ 0，为整数
- `tick_stats.last_executed_at` 为 `null` 或符合 `YYYY-MM-DD HH:mm:ss` 格式的字符串，且表示上海时区（UTC+8）时间
- `tick_stats.last_duration_ms` 为 `null` 或类型为 number 且值 ≥ 0

**验证命令**:
```bash
# Happy path：验证 tick_stats 字段存在且结构正确
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));

  // tick_stats 必须存在且为 object
  if (!d.tick_stats || typeof d.tick_stats !== 'object') {
    console.error('FAIL: tick_stats 字段不存在或类型错误，实际值: ' + JSON.stringify(d.tick_stats));
    process.exit(1);
  }
  const ts = d.tick_stats;

  // total_executions 必须为整数且 >= 0
  if (typeof ts.total_executions !== 'number' || !Number.isInteger(ts.total_executions) || ts.total_executions < 0) {
    console.error('FAIL: total_executions 不合法，实际值: ' + JSON.stringify(ts.total_executions));
    process.exit(1);
  }

  // last_executed_at 必须为 null 或符合格式的字符串
  if (ts.last_executed_at !== null) {
    if (typeof ts.last_executed_at !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts.last_executed_at)) {
      console.error('FAIL: last_executed_at 格式不符，实际值: ' + JSON.stringify(ts.last_executed_at));
      process.exit(1);
    }
  }

  // last_duration_ms 必须为 null 或非负数
  if (ts.last_duration_ms !== null) {
    if (typeof ts.last_duration_ms !== 'number' || ts.last_duration_ms < 0) {
      console.error('FAIL: last_duration_ms 不合法，实际值: ' + JSON.stringify(ts.last_duration_ms));
      process.exit(1);
    }
  }

  console.log('PASS: tick_stats 字段存在，结构正确 — total_executions=' + ts.total_executions +
    ', last_executed_at=' + ts.last_executed_at + ', last_duration_ms=' + ts.last_duration_ms);
"

# 边界路径：验证 tick_stats 包含全部三个必要字段
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const ts = d.tick_stats || {};
  const required = ['total_executions', 'last_executed_at', 'last_duration_ms'];
  const missing = required.filter(k => !(k in ts));
  if (missing.length > 0) {
    console.error('FAIL: tick_stats 缺少必要字段: ' + missing.join(', '));
    process.exit(1);
  }
  console.log('PASS: tick_stats 包含全部三个必要字段');
"

# 时区一致性验证：last_executed_at 必须是上海时区（UTC+8）
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const ts = d.tick_stats;
  if (!ts || ts.last_executed_at === null) {
    console.log('INFO: last_executed_at 为 null，跳过时区验证');
    process.exit(0);
  }
  // 把 last_executed_at 解释为 UTC+8（上海时区）
  const reported = new Date(ts.last_executed_at.replace(' ', 'T') + '+08:00');
  const now = new Date();
  const diffMs = now - reported;
  const uptimeSec = d.uptime || 0;

  // 若 diffMs < 0：报告时间在未来 → 时区可能是 UTC（+8 后超过现在）
  if (diffMs < 0) {
    console.error('FAIL: last_executed_at 解析为上海时区后在未来（时区错误？）: ' + ts.last_executed_at + ', diff=' + Math.round(diffMs/1000) + 's');
    process.exit(1);
  }
  // 若 diffMs > (uptime + 60s)：报告时间早于 Brain 启动 → 时区可能不是 UTC+8
  if (diffMs > (uptimeSec + 60) * 1000) {
    console.error('FAIL: last_executed_at 早于 Brain 启动时间（时区错误？）: ' + ts.last_executed_at + ', uptime=' + uptimeSec + 's, diff=' + Math.round(diffMs/1000) + 's');
    process.exit(1);
  }
  console.log('PASS: last_executed_at=' + ts.last_executed_at + ' 时区合理（距今 ' + Math.round(diffMs/1000) + 's，Brain uptime=' + uptimeSec + 's）');
"
```

---

## Feature 2: Brain 刚启动时 `tick_stats` 初始状态为零值

**行为描述**:

Brain 进程启动后、尚未执行任何 tick 循环之前，`/api/brain/health` 响应中的 `tick_stats` 应处于零值初始状态：
- `total_executions` 为 0
- `last_executed_at` 为 `null`
- `last_duration_ms` 为 `null`

此行为可通过检查 Brain 刚启动时（`uptime` 极小时）的 `total_executions` 为 0 来侧面验证；或通过检查当 `last_executed_at` 为 `null` 时 `last_duration_ms` 也必须为 `null` 的一致性规则来验证。

**硬阈值**:
- 若 `last_executed_at` 为 `null`，则 `last_duration_ms` 也必须为 `null`（两者一致，不允许"有耗时但没执行时间"）
- `total_executions` 值为非负整数（初始为 0，随 tick 执行递增）
- 字段值类型在"有值"和"无值"两种状态下均符合规范

**验证命令**:
```bash
# 验证 last_executed_at 与 last_duration_ms 的一致性（同为 null 或同为非 null）
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const ts = d.tick_stats;
  if (!ts) { console.error('FAIL: tick_stats 不存在'); process.exit(1); }

  const atNull = ts.last_executed_at === null;
  const msNull = ts.last_duration_ms === null;

  if (atNull !== msNull) {
    console.error('FAIL: last_executed_at 和 last_duration_ms 状态不一致 — ' +
      'last_executed_at=' + JSON.stringify(ts.last_executed_at) +
      ', last_duration_ms=' + JSON.stringify(ts.last_duration_ms));
    process.exit(1);
  }

  if (atNull) {
    console.log('PASS: 初始状态 — last_executed_at=null, last_duration_ms=null，一致');
  } else {
    console.log('PASS: 已执行状态 — last_executed_at=' + ts.last_executed_at +
      ', last_duration_ms=' + ts.last_duration_ms + '，一致');
  }
"

# 边界验证：total_executions 与 last_executed_at 的一致性
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const ts = d.tick_stats;
  if (!ts) { console.error('FAIL: tick_stats 不存在'); process.exit(1); }

  if (ts.total_executions === 0 && ts.last_executed_at !== null) {
    console.error('FAIL: total_executions=0 但 last_executed_at 非 null: ' + ts.last_executed_at);
    process.exit(1);
  }
  if (ts.total_executions > 0 && ts.last_executed_at === null) {
    console.error('FAIL: total_executions=' + ts.total_executions + ' 但 last_executed_at 为 null');
    process.exit(1);
  }
  console.log('PASS: total_executions=' + ts.total_executions + ' 与 last_executed_at 状态一致');
"
```

---

## Feature 3: 向后兼容 — 现有 `/api/brain/health` 字段不被破坏

**行为描述**:

新增 `tick_stats` 字段后，`/api/brain/health` 原有的 `status`、`uptime` 等字段必须依然存在且正常返回，不允许因新增字段导致现有字段丢失或响应结构变化。

**硬阈值**:
- `status` 字段必须存在（非 `undefined`），值为非空字符串
- `uptime` 字段必须存在（非 `undefined`），值为非负数
- 响应 JSON 可被正常解析（不抛出 JSON parse 错误）
- HTTP 状态码依然为 200（不退化为 500/404）

**验证命令**:
```bash
# Happy path：验证现有字段 status 和 uptime 依然存在
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));

  if (!d.status || typeof d.status !== 'string') {
    console.error('FAIL: status 字段不存在或类型错误，实际值: ' + JSON.stringify(d.status));
    process.exit(1);
  }

  if (typeof d.uptime !== 'number' || d.uptime < 0) {
    console.error('FAIL: uptime 字段不存在或非法，实际值: ' + JSON.stringify(d.uptime));
    process.exit(1);
  }

  console.log('PASS: 现有字段 status=' + d.status + ', uptime=' + d.uptime + ' 均完好');
"

# 失败路径：验证接口在 Brain 运行时可达（非 5xx 错误）
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/health)
if [ "$STATUS_CODE" != "200" ]; then
  echo "FAIL: /api/brain/health 返回非 200 状态码: $STATUS_CODE"
  exit 1
fi
echo "PASS: /api/brain/health 返回 200"
```

---

## Feature 4: `tick_stats` 值在 tick 执行后即时更新（可观测递增）

**行为描述**:

每次 tick 循环执行完成后，下次调用 `/api/brain/health` 应能观察到 `total_executions` 递增、`last_executed_at` 更新为最近执行时间、`last_duration_ms` 更新为最近耗时。此行为确保统计是实时的，而非缓存的静态值。

> **已知测试局限**：由于自动化验证环境无法等待两次 tick 间隔（约 5 分钟），无法直接对比两次调用间的递增量。此处改用 uptime 侧面验证策略：Brain 运行超过 180 秒（约 1.5 个 tick 间隔）后 `total_executions` 应 > 0，否则认为 tick 未正常运行。阈值 180s = TICK_INTERVAL_MINUTES(2) × 60 × 1.5，确保至少经历一次完整 tick 周期。

**硬阈值**:
- 若 Brain 已运行足够长时间（uptime > 180s，约 1.5 个 tick 间隔），`total_executions` 应 > 0（证明 tick 已执行过）
- 若 `total_executions` > 0，则 `last_executed_at` 必须为合法的上海时区时间字符串（非 null）
- 若 `total_executions` > 0，则 `last_duration_ms` 必须为合法的正数（非 null，非负数）
- `last_executed_at` 时间字符串必须表示合理的近期时间（年份 ≥ 2024）

**验证命令**:
```bash
# 验证：若 total_executions > 0，则 last_executed_at 和 last_duration_ms 均已更新
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const ts = d.tick_stats;
  if (!ts) { console.error('FAIL: tick_stats 不存在'); process.exit(1); }

  if (ts.total_executions > 0) {
    if (!ts.last_executed_at || typeof ts.last_executed_at !== 'string') {
      console.error('FAIL: total_executions=' + ts.total_executions + ' 但 last_executed_at 为空或非字符串');
      process.exit(1);
    }
    if (typeof ts.last_duration_ms !== 'number' || ts.last_duration_ms < 0) {
      console.error('FAIL: total_executions=' + ts.total_executions + ' 但 last_duration_ms 不合法: ' + ts.last_duration_ms);
      process.exit(1);
    }
    const year = parseInt(ts.last_executed_at.substring(0, 4));
    if (year < 2024) {
      console.error('FAIL: last_executed_at 年份不合理: ' + ts.last_executed_at);
      process.exit(1);
    }
    console.log('PASS: tick 已执行 ' + ts.total_executions + ' 次，最近执行于 ' + ts.last_executed_at +
      '，耗时 ' + ts.last_duration_ms + 'ms');
  } else {
    console.log('INFO: total_executions=0（Brain 刚启动或 tick 未执行），跳过已执行状态验证');
  }
"

# 边界验证：Brain 运行超过 180s（约 1.5 个 tick 间隔）后，tick 应已执行（uptime 侧面验证）
# 阈值依据：TICK_INTERVAL_MINUTES=2（packages/brain/src/tick.js:76）× 60 × 1.5 = 180s
# 确保至少经历一次完整 tick 周期，避免 70-119s 区间的假失败
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const ts = d.tick_stats;
  const uptime = d.uptime || 0;

  if (uptime > 180 && ts && ts.total_executions === 0) {
    console.error('FAIL: Brain uptime=' + uptime + 's 超过 180s（约 1.5 个 tick 间隔），但 total_executions 仍为 0，tick 可能未正常运行');
    process.exit(1);
  }
  if (uptime > 180 && ts && ts.total_executions > 0) {
    console.log('PASS: Brain uptime=' + uptime + 's，total_executions=' + ts.total_executions + '，tick 正常运行');
  } else {
    console.log('INFO: Brain uptime=' + uptime + 's（<180s），不强制要求 tick 已执行');
  }
"
```
