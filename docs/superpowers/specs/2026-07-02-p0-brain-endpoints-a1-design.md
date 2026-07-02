# P0 Brain 端点补齐（A1 硬前置）设计

> harness 验证模型重构 HANDOFF 第 5 节 P0。消费方：A1（harness-planner Step 0.4）。
> PrepPRD：`sprints/07021055-p0-brain-endpoints-a1/prep-prd.md`。

## 背景

A1 需要 planner 每个 sprint 拉「整条 line 的累积 FR + invariant」注入合同，但现状两个缺口（A1 方案文档"依赖/缺口"节）：

1. **累积 FR 聚合缺口**：`GET /golden_path` 只接 `owner_task_id`；`tasks` 无 `journey_id`，无法按 line 聚合。桥是 `golden_path.owner_task_id → tasks.ability_id → journey_features.journey_id`（已 psql 验证三表列存在）。
2. **area 级 invariant 缺口**：`decisions` 表 `category='invariant'` 共 19 条（5 条 Line04 journey_feature 级 + 7 条 area 级 + 7 条 level NULL），但 `GET /decisions` 读的是 `decision_log` 审计表且忽略 category 参数（status.js:270 / shared.js:19），area 级铁律无干净端点可取。

## 设计

两个只读端点，都加在 `packages/brain/src/routes/abilities.js`（golden_path / decisions 写读端点全在这个文件，保持内聚）：

### 1. `GET /api/brain/journeys/:journey_id/golden-paths?status=<可选>`

```sql
SELECT jf.id AS ability_id, jf.name AS ability_name, jf.status AS ability_status,
       gp.owner_task_id, gp.id, gp.order_no, gp.feature_id, gp.note
FROM golden_path gp
JOIN tasks t ON gp.owner_task_id = t.id
JOIN journey_features jf ON t.ability_id = jf.id
WHERE jf.journey_id = $1 [AND jf.status = $2]
ORDER BY gp.owner_task_id, gp.order_no ASC
```

JS 层按 **owner_task_id** 分组（不是按 ability_id——ability:run=1:N，同一 ability 可被多个 task 推进、各有各的 golden_path，按 ability 分组会让不同 task 的 order_no 交错）：

```json
[
  {
    "ability_id": "...", "ability_name": "...", "ability_status": "done",
    "owner_task_id": "...",
    "steps": [ { "id": "...", "order_no": 1, "feature_id": "...", "note": "..." } ]
  }
]
```

- `status` 参数校验：必须在 ABILITY_STATUS 白名单内，否则 400。
- 非法 journey_id UUID → 400（对齐本文件 POST /golden_path 的 invalid-uuid 处理惯例）。
- 无匹配返回 `[]`（200），对齐本文件其他读端点。

### 2. `GET /api/brain/invariants?level=&target_type=&target_id=`

```sql
SELECT * FROM decisions
WHERE category = 'invariant' AND status = 'active'
  [AND level = $n] [AND target_type = $n] [AND target_id = $n]
ORDER BY created_at DESC
```

- `level` 校验：必须在 DECISION_LEVELS（area/ability/feature/step）内，否则 400。
- 读 `decisions` 表（非 `decision_log`）；无匹配返回 `[]`（200）。
- 不动坏的 `GET /decisions`（status.js）——那是别的消费方在用的历史行为，本次只提供正确的新入口，A1 落地时 planner 指向新端点。

## 测试策略

unit：`routes/__tests__/abilities.test.js` 追加用例（既有 mock pool + supertest 模式）——TDD 先 failing 后实现。
真实验证：本机 curl `journeys/bb8cc561-.../golden-paths`（Cecelia harness line）+ `invariants?level=area`（应返回 7 条系统铁律）。

## 不做

- 不改 `GET /decisions`（读 decision_log 的历史行为留给消费方迁移后再清理）
- 不加分页/游标（数据量级：invariant 19 条、单 line golden_path 数十行，YAGNI）
- 不做写端点
