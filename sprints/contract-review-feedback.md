# Contract Review Feedback (Round 4)

> reviewer_task_id: f8eb432f-6def-4ded-bf52-4f6807e982fd
> propose_round: 4
> verdict: REVISION

---

## 必须修改项

### 1. [命令假失败] Feature 4 — `uptime > 60s` 阈值低于实际 tick 间隔（120s），会导致正确实现假失败

**问题**:

Feature 4 的边界验证命令：

```bash
if (uptime > 60 && ts && ts.total_executions === 0) {
  console.error('FAIL: Brain uptime=... 超过 60s，但 total_executions 仍为 0，tick 可能未正常运行');
  process.exit(1);
}
```

**实际 tick 间隔**（SSOT `packages/brain/src/tick.js` 第 76 行）：
```js
const TICK_INTERVAL_MINUTES = 2;  // → 120 秒
```

Brain 在 `uptime = 70-119s` 时完全正常，tick 尚未到执行时间，但此命令会返回 `FAIL` 并退出 1。  
这是**正确实现被合同假判为失败**的命令漏洞，不是测试环境约束。

**影响**: Evaluator 执行时若 Brain 刚重启不到 2 分钟，整个 Feature 4 验证失败，但实现完全正确。

**修改方案**:

将阈值改为 tick 间隔的 1.5 倍（180s），并在注释中写明依据：

```bash
# 阈值 = TICK_INTERVAL_MINUTES(2min) × 60 × 1.5 = 180s，给一次完整 tick 充足时间
if (uptime > 180 && ts && ts.total_executions === 0) {
  console.error('FAIL: Brain uptime=' + uptime + 's 超过 180s（约 1.5 个 tick 间隔），但 total_executions 仍为 0，tick 可能未正常运行');
  process.exit(1);
}
```

---

## 其余功能确认通过

| Feature | 状态 | 说明 |
|---------|------|------|
| Feature 1 — tick_stats 字段结构验证 | ✅ PASS | 三条命令：类型检查 + 字段完整性 + 时区一致性，逻辑严格 |
| Feature 1 — 时区验证（R4 新增） | ✅ PASS | `parsed_as_UTC+8 vs now vs uptime` 逻辑正确，覆盖时区错误场景 |
| Feature 2 — 初始状态一致性 | ✅ PASS | null/null 对一致 + total_executions=0/last_executed_at=null 对一致，两层验证 |
| Feature 3 — 向后兼容 | ✅ PASS | 验证 status/uptime 字段存在 + HTTP 200，合理范围 |
| Feature 4 — 已执行状态验证 | ✅ PASS（uptime>0 分支）| `total_executions>0` 时的字段非 null 检查 + 年份合理性检查，逻辑正确 |
| Feature 4 — uptime 侧面验证 | ❌ FAIL | 阈值 60s < tick 间隔 120s，见上 |

---

## 修改范围

**仅需修改 Feature 4 边界验证命令中的一个数字**：`uptime > 60` → `uptime > 180`，并更新注释说明阈值依据（引用 `TICK_INTERVAL_MINUTES = 2`）。其余四个 Feature 的所有命令无需改动。
