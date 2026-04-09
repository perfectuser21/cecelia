# Contract Review Feedback (Round 2)

> reviewer_task_id: 48ea0065-b95b-4f11-8a14-9d3421
> propose_task_id: 731cfab1-119e-4953-886a-63d2e2421e61
> planner_task_id: b26e5c34-88f9-4fa9-b897-ce58df8bf473
> verdict: REVISION
> issues_count: 3

---

## 必须修改项

### 1. [P0 合同主题错误] 合同验证的不是 PRD 描述的功能

**问题**: PRD 明确描述的是一个产品功能——为 `/api/brain/health` 接口新增 `tick_stats` 字段（包含 `total_executions`、`last_executed_at`、`last_duration_ms`）。但合同草案的 6 个 Feature 全部在验证 Harness 编排管道本身（Planner→GAN→Generator→Evaluator→Deploy→Report），与 tick_stats 功能毫无关联。

**影响**: 合同 100% 不能检测出 tick_stats 功能是否被正确实现。即使 `/api/brain/health` 完全没有 `tick_stats` 字段，这 6 个 Feature 的命令也全部会 PASS。

**建议**: 合同必须完全重写，专注于验证 tick_stats 功能本身。参考 PRD 验收标准：
- `GET /api/brain/health` 响应 JSON 包含 `tick_stats` 对象（含三个字段）
- Brain 刚启动时 `total_executions=0`，`last_executed_at=null`，`last_duration_ms=null`
- tick 执行后字段即时更新
- 现有 `status`/`uptime` 字段不被破坏（向后兼容）

---

### 2. [P0 PRD 功能点零覆盖] 合同中无任何命令验证 tick_stats

**问题**: PRD 的 Feature 1 有 5 个明确的验收子标准：
1. 响应含 `tick_stats` 对象
2. `total_executions` 为整数且启动时为 0
3. `last_executed_at` 为上海时区字符串格式（`YYYY-MM-DD HH:mm:ss`）或 null
4. `last_duration_ms` 为数字（毫秒）或 null
5. 不破坏现有字段结构

合同草案中没有任何一条命令涉及这 5 个验收标准。Generator 若实现了一个返回 `tick_stats: {}` 空对象的假实现，当前合同所有命令均会通过。

**建议**: 新合同需要覆盖：
```bash
# 示例：验证 tick_stats 字段结构存在且类型正确
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!d.tick_stats) { console.error('FAIL: 无 tick_stats 字段'); process.exit(1); }
  const ts = d.tick_stats;
  if (typeof ts.total_executions !== 'number') { console.error('FAIL: total_executions 非数字'); process.exit(1); }
  if (ts.last_executed_at !== null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts.last_executed_at)) {
    console.error('FAIL: last_executed_at 格式不符'); process.exit(1);
  }
  if (!d.status || !d.uptime) { console.error('FAIL: 现有字段被破坏'); process.exit(1); }
  console.log('PASS: tick_stats 字段结构正确，现有字段未破坏');
"
```

---

### 3. [P0 合同范围超出 PRD] Feature 5（部署触发）不在 PRD 范围内

**问题**: PRD 的"不在范围内"明确列出：无其他 API 端点变更、无 CI/CD 相关内容。但合同 Feature 5 验证"合并后自动触发部署流程"——这是 PRD 从未要求的功能。

**影响**: Generator 会被错误引导去实现或验证部署逻辑，超出 PRD 范围。

**建议**: 删除 Feature 5，合同范围限定为 PRD 明确描述的功能。

---

## 根因分析（供 Generator 参考）

Generator 在第 2 轮修改中仍然将合同主题指向了"Harness 全链路编排验证"，而非本次 Sprint 的实际产品目标（tick_stats 功能）。推测原因：Generator 将自身所处的 Harness 框架误认为是本次 Sprint 要验证的对象。

**正确理解**：
- 合同验证的对象 = **PRD 描述的产品功能**（本次为 tick_stats）
- Harness 框架本身（Planner/GAN/Generator/Evaluator）是运载工具，不是验收对象
- 合同应完全基于 PRD 的验收标准重写，6 个 Feature 全部替换

