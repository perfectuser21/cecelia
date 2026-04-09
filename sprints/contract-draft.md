# 合同草案（第 1 轮）

> propose_round: 1
> generated_at: 2026-04-09 12:30 CST
> planner_task_id: b26e5c34-88f9-4fa9-b897-ce58df8bf473

## 本次实现的功能

- Feature 1: `/api/brain/health` 响应新增 `tick_stats` 字段（内存级统计，重启清零）

## 验收标准（DoD）

### Feature 1 — tick_stats 字段

**行为描述**：
`GET /api/brain/health` 返回的 JSON 中包含顶层 `tick_stats` 对象，与 `status`、`organs`、`timestamp` 并列。字段含义：
- `total_executions`：整数，Brain 启动以来 executeTick() 成功完成的次数
- `last_executed_at`：字符串，最近一次 tick 执行的上海时区时间（`YYYY-MM-DD HH:mm:ss`），从未执行时为 `null`
- `last_duration_ms`：数字，最近一次 tick 执行耗时（ms），从未执行时为 `null`

**硬阈值**：
- `tick_stats` 字段必须存在于响应根层级（非 organs 内部）
- Brain 启动后、首次 tick 执行前：`total_executions=0`，另两字段为 `null`
- 首次 tick 执行后：`total_executions=1`，`last_executed_at` 为有效时间字符串，`last_duration_ms` 为正整数
- 现有字段（`status`、`organs`、`timestamp`）结构不变

**验证命令**：

```bash
# Happy path — 验证 tick_stats 字段存在且结构正确
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!d.tick_stats) throw new Error('FAIL: 缺少 tick_stats 字段');
    const s = d.tick_stats;
    if (typeof s.total_executions !== 'number') throw new Error('FAIL: total_executions 不是数字，实际: ' + typeof s.total_executions);
    // last_executed_at 和 last_duration_ms 可以是 null（启动后首次 tick 前）
    if (s.last_executed_at !== null && typeof s.last_executed_at !== 'string') throw new Error('FAIL: last_executed_at 类型错误');
    if (s.last_duration_ms !== null && typeof s.last_duration_ms !== 'number') throw new Error('FAIL: last_duration_ms 类型错误');
    console.log('PASS: tick_stats 结构正确 — total_executions=' + s.total_executions + ', last_executed_at=' + s.last_executed_at + ', last_duration_ms=' + s.last_duration_ms);
  "

# 兼容性验证 — 现有字段不被破坏
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!d.status) throw new Error('FAIL: status 字段丢失');
    if (!d.organs) throw new Error('FAIL: organs 字段丢失');
    if (!d.organs.scheduler) throw new Error('FAIL: organs.scheduler 丢失');
    if (!d.timestamp) throw new Error('FAIL: timestamp 字段丢失');
    console.log('PASS: 现有字段结构完整 — status=' + d.status);
  "

# 边界验证 — last_executed_at 格式（若不为 null 则必须是上海时区 YYYY-MM-DD HH:mm:ss）
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const at = d.tick_stats.last_executed_at;
    if (at === null) {
      console.log('PASS: last_executed_at=null（tick 尚未执行，合法）');
    } else {
      const ok = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at);
      if (!ok) throw new Error('FAIL: last_executed_at 格式错误，实际: ' + at);
      console.log('PASS: last_executed_at 格式正确 — ' + at);
    }
  "
```

## 技术实现方向（高层）

1. **`packages/brain/src/tick.js`** — 新增 3 个模块级内存变量：
   ```js
   let _tickTotalExecutions = 0;
   let _tickLastExecutedAt = null;   // Date 对象
   let _tickLastDurationMs = null;   // number
   ```
   在 `executeTick()` 函数主体外层：执行前记 `startMs = Date.now()`，执行成功后更新三个变量。

2. **`getTickStatus()`** — 扩展返回对象，新增 `tick_stats` 子对象，`last_executed_at` 用 `Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' })` 格式化。

3. **`packages/brain/src/routes/goals.js`** — `/health` 路由已经调用 `getTickStatus()`，直接将 `tickStatus.tick_stats` 挂到响应根层级即可，无需额外改动路由逻辑。

4. **无 DB 操作**，无 migration，统计数据仅内存，重启清零。

## 不在本次范围内

- 历史 tick 执行记录持久化到数据库
- tick 统计图表或可视化
- 跨重启保留统计
- 告警或阈值配置
- 其他 API 端点的变更
