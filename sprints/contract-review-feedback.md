# 合同审查反馈（第 1 轮）

**审查者**: Evaluator  
**审查轮次**: Round 1  
**判决**: REVISION

---

## 必须修改

### 1. [命令太弱] 三条命令全部对静态假实现免疫

**问题**：

假设 Generator 实现了如下代码：
```js
// tick.js getTickStatus() 返回
tick_stats: { total_executions: 0, last_executed_at: null, last_duration_ms: null }
```
这是一个从不更新的假实现，Brain 跑多久计数永远是 0。但三条验证命令全部 PASS：
- Command 1：`typeof 0 === 'number'` ✅，`null === null` ✅
- Command 2：检查现有字段，与 tick_stats 无关 ✅
- Command 3：`at === null → console.log('PASS')` ✅

合同对最关键的行为（计数确实在递增）毫无约束。

**修复方式**：新增一条一致性断言命令，在 Brain 已持续运行时（通常 5 分钟内有过 tick），要求 `total_executions > 0`，并且 `total_executions > 0` 时 `last_executed_at` 必须不为 null：

```bash
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const s = d.tick_stats;
    // Brain 正常运行时 tick 已经执行过，计数应 > 0
    if (s.total_executions === 0) {
      // 可能刚启动，检查一致性：0 时另两字段必须都是 null
      if (s.last_executed_at !== null || s.last_duration_ms !== null) {
        throw new Error('FAIL: total_executions=0 但 last_executed_at/last_duration_ms 不为 null，数据不一致');
      }
      console.log('WARN: total_executions=0，Brain 可能刚启动，跳过增量验证');
    } else {
      // total_executions > 0，last_executed_at 和 last_duration_ms 必须有值
      if (s.last_executed_at === null) throw new Error('FAIL: total_executions=' + s.total_executions + ' 但 last_executed_at 为 null');
      if (s.last_duration_ms === null) throw new Error('FAIL: total_executions=' + s.total_executions + ' 但 last_duration_ms 为 null');
      if (s.last_duration_ms <= 0) throw new Error('FAIL: last_duration_ms 不合法: ' + s.last_duration_ms);
      console.log('PASS: 计数=' + s.total_executions + ', 最近执行=' + s.last_executed_at + ', 耗时=' + s.last_duration_ms + 'ms');
    }
  "
```

---

### 2. [值域缺失] `last_duration_ms` 不为 null 时未验证 > 0

**问题**：

Command 1 只验证 `typeof s.last_duration_ms !== 'number'`，以下错误实现全部通过：
- `last_duration_ms: 0`（耗时不可能为零）
- `last_duration_ms: -1`（负数耗时无意义）
- `last_duration_ms: NaN`（`typeof NaN === 'number'` 为 true！）

**修复方式**：在 Command 1 中将 null 分支之外的数值检查改为：
```js
if (s.last_duration_ms !== null) {
  if (!Number.isFinite(s.last_duration_ms) || s.last_duration_ms <= 0) {
    throw new Error('FAIL: last_duration_ms 值不合法: ' + s.last_duration_ms);
  }
}
```

---

### 3. [类型精度] `total_executions` 未验证为整数，小数和 NaN 可通过

**问题**：

PRD 明确要求 `total_executions` 为"整数"，但当前检查仅 `typeof s.total_executions !== 'number'`：
- `total_executions: 0.5` → `typeof 0.5 === 'number'` ✅ 误通过
- `total_executions: NaN` → `typeof NaN === 'number'` ✅ 误通过
- `total_executions: -1` → 通过（负数不合法）

**修复方式**：
```js
if (!Number.isInteger(s.total_executions) || s.total_executions < 0) {
  throw new Error('FAIL: total_executions 不是非负整数: ' + s.total_executions);
}
```

---

### 4. [边界命令逻辑缺陷] Command 3 在 Brain 运行时将 null 视为合法状态

**问题**：

Command 3 逻辑：
```js
if (at === null) {
  console.log('PASS: last_executed_at=null（tick 尚未执行，合法）');
}
```

Brain 正常运行时 tick 早已执行，`last_executed_at` 理应有值。如果实现有 bug 导致时间戳始终为 null（计数已增但时间没更新），Command 3 会报 PASS。

这与问题 1 重叠——核心缺陷是所有边界验证都有"null=PASS"的逃跑通道，无法检测"计数更新了但时间戳/耗时字段忘记更新"的 partial 错误实现。

**修复方式**：将 Command 3 改为依赖 `total_executions` 的条件一致性断言（已合并在问题 1 的修复中）。

---

## 可选改进

### 5. [格式验证不足] last_executed_at 仅验证格式，不验证时区

Command 3 用正则 `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/` 验证格式，但如果实现返回 UTC 时间（如 `2026-04-09 06:30:00`），格式相同但不是上海时区，命令无法区分。时区验证较难做自动化，可在技术实现说明中强调用 `Asia/Shanghai` 格式化，验证命令中补注释说明人工观察时区合理性。

---

## 已确认通过

- Feature 1 字段定义 ✅：`tick_stats` 三字段名称、类型（数字/字符串/null）在 Command 1 中有基本验证
- 兼容性验证 ✅：Command 2 覆盖 `status`、`organs`、`organs.scheduler`、`timestamp` 字段完整性
- 不在范围内的功能边界 ✅：合同明确排除了 DB 持久化、历史记录、图表等
- 技术路线可行 ✅：`tick.js` 内存变量 + `getTickStatus()` 扩展 + 现有 health 路由复用，方向正确

---

## 修复后可直接 APPROVE 的条件

1. 新增一条一致性断言命令（问题 1），验证 `total_executions > 0` 时 `last_executed_at` 和 `last_duration_ms` 均不为 null 且值合法
2. Command 1 中 `total_executions` 改用 `Number.isInteger` + `>= 0` 校验（问题 3）
3. Command 1 中 `last_duration_ms` 改用 `Number.isFinite && > 0` 校验（问题 2）
4. Command 3 合并进一致性断言或删除（问题 4，由问题 1 修复覆盖）
