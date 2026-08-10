# Contract Draft — F1 Impact Contract & Gap Resolution Loop

- **Task ID：** d96c9fa0-83bd-40dc-b731-4f541c43af32
- **Sprint Dir：** sprints/08110022-relay-d96c9fa0
- **日期：** 2026-08-11
- **Gear：** segmented（6 段）

---

## 目标

在 F1 前三步中构建强制执行的 Impact Contract 机制：接单即分档（change_kind/gear 正交）→ 编码前持久化影响声明合同 → 编码后按真实 diff 复算影响并在未声明影响时触发 `CONTRACT_IMPACT_DRIFT` 形成可追踪 gap 并硬阻塞原任务，直到当前 revision 断言验真通过。

---

## 验收标准

### FR-1 Change Normalizer（ws1）

1. **正确映射四档：** 给定任意合法输入，`change_kind` 必须被映射为以下之一：
   - `new_capability`（新能力，对应 gear=segmented）
   - `capability_change`（能力变更，对应 gear=segmented 或 single）
   - `bugfix`（缺陷修复，对应 gear=single）
   - `parameter_only`（参数调整，对应 gear=single）

2. **无效输入拒绝：** 无法归类的输入返回 HTTP 400，body 含 `error` 字段说明原因。

3. **字段独立存在：** 在 `harness_tasks` 表中，`change_kind` 与 `gear` 分别存储为独立列；在任何 API payload 中两字段均独立出现，禁止相互赋值或用其中一个字段值推导另一个字段值。

4. **留痕：** 每次 change_kind 计算结果写入 `harness_skill_relay_log`（或等价审计表），包含输入原始值与映射结果。

### FR-2 Impact Contract Schema 与持久化（ws2）

1. **合法合同写入：** 符合 Zod schema 的合同通过 `POST /api/brain/impact-contracts` 写入 `harness_impact_contracts` 表并返回 201 + 合同 ID。

2. **非法合同拒绝：** 缺少必填字段（如 `change_kind`、`base_revision`、`affected_capabilities`）或字段类型错误的合同被 Structure Gate 拒绝，返回 HTTP 400，body 含具体字段错误描述。

3. **幂等性：** 同一 `(task_id, base_revision)` 组合重复提交时，返回 200 + 已有合同 ID，不创建重复记录（通过 `idempotency_key` 或唯一约束实现）。

4. **可查询：** `GET /api/brain/impact-contracts/:id` 返回完整合同 JSON，包含所有字段。

5. **Mapper 不可达失败：** Structure Gate 在 Mapper 不可达时返回 HTTP 503，body 含 `retryable: true` 及重试建议。

### FR-3 Structure Gate（ws3，部分依赖 MJ5）

1. **三种不可判定情形均拒绝：**
   - Mapper stale（freshness 超时）→ 503 + `reason: mapper_stale`
   - Mapper unavailable → 503 + `reason: mapper_unavailable`
   - revision mismatch（合同 base_revision 与当前 HEAD 不匹配）→ 409 + `reason: revision_mismatch`

2. **每种情形均返回 `retryable` 字段和重试建议。**

3. **不可判定不等于零影响：** 三种情形下门禁一律不放行，绝不透传为"通过"。

> **注：** FR-3 的真实 Mapper 路径依赖 MJ5（`/api/brain/map/radius` + `projection_digest` + freshness 合同），在 MJ5 通过验收前，Structure Gate 对 Mapper 调用使用受控 stub，并在测试注释中明确标注。

### FR-4 Diff Impact Gate 与 drift 仲裁（ws4，需 MJ5）

1. **全覆盖：** 实际影响 ⊆ 声明影响时，门禁通过，进入正常验收流程。

2. **可扩展：** 新增影响已有对应断言时，扩展合同并自动运行新断言，门禁仍通过。

3. **drift 触发：** 新增影响缺少断言时，触发 `CONTRACT_IMPACT_DRIFT` 事件，写入 `gap_events` 表，门禁变红，原任务进入 `blocked` 状态。

4. **drift 事件可查：** `GET /api/brain/gaps?task_id=<id>` 能查到 gap 记录，含受影响能力列表。

> **注：** FR-4 全程依赖 MJ5 `radius/digest/freshness` 合同通过真实环境验收。

### FR-5 Gap Ledger（ws5，需 MJ5）

1. **状态机单向流转：** gap 状态只允许路径 `open → assigned → fixing → verifying → resolved`；验真失败进入 `reopened`，只能回到 `assigned`。

2. **原任务自动恢复：** gap 修复任务状态变为 `completed` 且当前 revision 断言 PASS 后，原任务从 `blocked` 恢复为 `in_progress`。

3. **幂等去重：** 重复触发同一 gap 的恢复回调时，系统幂等处理，不产生重复状态变更。

4. **分诊告警：** gap owner 不存在时，gap 进入分诊队列，触发告警（写入 `alerts` 表或发送通知）。

### FR-6 全链演练（ws6，需 MJ5）

1. **端到端可追溯：** 任意实际 diff → 影响裁决 → 未声明影响 → gap 建立 → 依赖阻塞 → 修复 → 恢复，每步均有 DB 记录可查。

2. **无假绿：** Mapper stale/不可达/revision mismatch 均不产生假绿（gate 不放行）。

3. **永久 CI：** 全链回归测试纳入 CI，`brain-ci.yml` 中可见且 pass 才允许合并。

---

## E2E 验收

### 最小可验证链路（ws1 + ws2，无 MJ5 依赖）

```bash
# manual:bash
# 前提：Brain 运行于 localhost:5221

# 步骤1：创建一个携带 change_kind 的任务，验证字段独立存储
TASK_RESP=$(curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "E2E: Impact Contract test task",
    "task_type": "capability_change",
    "change_kind": "new_capability",
    "gear": "segmented"
  }')
TASK_ID=$(echo $TASK_RESP | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
echo "Task ID: $TASK_ID"

# 步骤2：验证 DB 中 change_kind 和 gear 独立存在
psql -U cecelia cecelia -c "SELECT id, change_kind, gear FROM harness_tasks WHERE id='$TASK_ID';"

# 步骤3：提交合法 Impact Contract
CONTRACT_RESP=$(curl -s -X POST http://localhost:5221/api/brain/impact-contracts \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"change_kind\": \"new_capability\",
    \"base_revision\": \"$(git -C /workspace rev-parse HEAD)\",
    \"affected_capabilities\": [\"impact-contract\"],
    \"required_assertions\": [\"change_kind_maps_correctly\"],
    \"freshness_evidence\": null,
    \"inapplicable_items\": [],
    \"inapplicable_reasons\": {}
  }")
echo "Contract resp: $CONTRACT_RESP"
echo $CONTRACT_RESP | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);if(r.id){console.log('PASS: contract created, id='+r.id)}else{console.log('FAIL: '+JSON.stringify(r));process.exit(1)}})"

# 步骤4：验证非法合同被拒绝（缺少 base_revision）
INVALID_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/impact-contracts \
  -H "Content-Type: application/json" \
  -d "{\"task_id\": \"$TASK_ID\", \"change_kind\": \"new_capability\"}")
if [ "$INVALID_RESP" = "400" ]; then
  echo "PASS: invalid contract rejected with 400"
else
  echo "FAIL: expected 400, got $INVALID_RESP"
  exit 1
fi
```

### Gap 状态机验证（ws5，需 MJ5）

```bash
# manual:bash
# 前提：MJ5 合同已通过，Brain 运行于 localhost:5221

# 查询当前 open gap 列表
curl -s http://localhost:5221/api/brain/gaps?status=open | \
  node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log('Open gaps:', r.length)})"

# 验证 gap 状态单向流转
psql -U cecelia cecelia -c "SELECT g.id, g.status, array_agg(ge.event_type ORDER BY ge.created_at) as events FROM harness_gaps g JOIN gap_events ge ON g.id=ge.gap_id GROUP BY g.id, g.status LIMIT 5;"
```

---

## 未覆盖真实链路清单

以下部分在当前 sprint（ws1-ws2）中使用 mock/stub，待 MJ5 合同通过后替换为真实实现：

| # | 内容 | mock 方式 | 解锁条件 |
|---|------|-----------|----------|
| 1 | `POST /api/brain/map/radius` 调用 | 受控 stub，返回固定影响范围列表 | MJ5 合同通过真实环境验收 |
| 2 | `projection_digest` 计算与验证 | stub 返回固定 digest 字符串 | MJ5 `projection_digest` 合同 |
| 3 | Mapper freshness 检查（freshness_evidence 字段） | stub 始终返回 fresh，超时测试用 mock | MJ5 freshness fail-closed 合同 |
| 4 | revision mismatch 检测（HEAD vs 合同 base_revision） | 单元测试中手动构造 mismatch 场景 | MJ5 合同 + 真实 Mapper 部署 |
| 5 | Diff Impact Gate 真实 diff 重算 | 测试文件中使用预构造 diff fixture | MJ5 合同 + FR-4 实现 |
| 6 | Gap 恢复后的任务自动调度（恢复 in_progress） | ws5 骨架实现，端到端仅在 ws6 验证 | ws5 实现完成 |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 备注 |
|---|---|---|---|
| ws1 | `packages/brain/src/impact-contract/__tests__/change-kind.test.js` | task_type=new_feature / 非枚举值时抛出 / gear 均存在且值独立 | permanent |
| ws2 | `packages/brain/src/impact-contract/__tests__/contract-schema.test.js` | Zod parse 不抛出 / Zod parse 抛出 ZodError / success: true | permanent |
| ws2 | `packages/brain/src/impact-contract/__tests__/contract-store.test.js` | 相同内容计算出相同 hash / 缺少 base_revision 时验证失败 | permanent |
| ws3 | `packages/brain/src/impact-contract/__tests__/structure-gate.test.js` | mapper_unavailable / stale / revision_mismatch | permanent |
| ws4 | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | 通过（pass）/ extend / CONTRACT_IMPACT_DRIFT / blocked（不放行） | permanent |
| ws5 | `packages/brain/src/impact-contract/__tests__/gap-store.test.js` | open → assigned / validateTransition 抛出 422 / triage → assigned | permanent |
| ws3 | `packages/brain/src/impact-contract/__tests__/map-client.test.js` | fresh stub / affected_nodes / callMapper | permanent |
| ws5 | `packages/brain/src/routes/__tests__/gaps.test.js` | harnessGapsRouter / router 可挂载 / router 有 stack | permanent |
| ws2 | `packages/brain/src/routes/__tests__/impact-contracts.test.js` | impactContractsRouter / router 可挂载 / router 有 stack | permanent |
| ws1 | `sprints/08110022-relay-d96c9fa0/tests/change-kind.test.js` | task_type=new_feature / 非枚举值时抛出 / gear 均存在且值独立 | sprint |
| ws2 | `sprints/08110022-relay-d96c9fa0/tests/contract-schema.test.js` | Zod parse 不抛出 / Zod parse 抛出 ZodError / success: true | sprint |
| ws2 | `sprints/08110022-relay-d96c9fa0/tests/contract-store.test.js` | 相同内容计算出相同 hash / 缺少 base_revision 时验证失败 | sprint |
| ws3 | `sprints/08110022-relay-d96c9fa0/tests/structure-gate.test.js` | mapper_unavailable / stale / revision_mismatch | sprint |
| ws4 | `sprints/08110022-relay-d96c9fa0/tests/diff-gate.test.js` | 通过（pass）/ extend / CONTRACT_IMPACT_DRIFT / blocked（不放行） | sprint |
| ws5 | `sprints/08110022-relay-d96c9fa0/tests/gap-store.test.js` | open → assigned / validateTransition 抛出 422 / triage → assigned | sprint |

---

## 铁律覆盖对照

| # | Invariant（来自 sprint-prd.md） | 合同对应条款 |
|---|---|----|
| 1 | Brain 改动门禁（DevGate 三连）：facts-check + version-sync + dod-mapping，任一失败禁止继续编码 | ws1-ws6 每段 scope.devgate_required = true；task-plan.json 中每段 description 均注明必须先通过 DevGate 三连 |
| 2 | Migration 号无碰撞：本计划从 401 起，开工前重新扫描已用编号 | contract-dod.md 包含检查命令；ws2 scope.files 指定 `401_impact_contracts.sql`，ws5 指定 `402_harness_gaps.sql` |
| 3 | change_kind / gear 严格分离：两字段分别计算、分别留痕，禁止互相赋值 | FR-1 验收标准第3条"字段独立存在"；change-kind.test.js 包含交叉赋值的负向测试 |
| 4 | Mapper fail-closed 原则：stale/unavailable/revision mismatch/无 freshness 均判 impact_unknown，门禁不放行 | FR-3 验收标准第1-3条；structure-gate.test.js 含三种不可判定情形测试；contract-dod.md BEHAVIOR-3 |
| 5 | Red-then-Green 顺序：先保留 failing test（RED），再写最小实现（GREEN），测试永久留 CI | tests/ 骨架文件均以 `assert.fail('RED: not yet implemented')` 开头；task-plan.json 每段 scope.tests 字段指向对应测试 |
| 6 | MJ5 依赖边界：Segment 1-2 可独立推进；Segment 3-6 等 MJ5 验收后继续 | ws1/ws2 depends_on=[]或[ws1]；ws3-ws6 在 description 中标注"需 MJ5 合同"；task-plan.json depends_on 链路体现 |
| 7 | Gap 状态机单向流转：open→assigned→fixing→verifying→resolved；验真失败→reopened→assigned；关闭必须引用当前 revision 断言 | FR-5 验收标准第1条；gap-store.test.js 含状态逆向流转的负向测试；contract-dod.md BEHAVIOR-4 |
