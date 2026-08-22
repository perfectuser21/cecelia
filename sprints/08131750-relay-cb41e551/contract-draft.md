# Test Contract: Map F1 下钻空白修复 + 骨干层装配

**Task ID**: cb41e551-f483-4189-af9f-9d3275d59d35  
**Sprint**: `sprints/08131750-relay-cb41e551`  
**Target environment**: `mac_web`（Cecelia Dashboard，localhost:5174，内网 Playwright）

## 范围

本 Sprint 修复 /map 页 F1 capability 下钻后 Level 2 面板骨干/功能/断言三栏恒为空白的问题，根因是两个叠加缺陷：
1. `collectDescendants()` BFS 方向相反——所有 feature 边的方向是 `feature --[implements]--> capability`，前端却沿正向遍历，永远找不到子孙节点
2. 投影器 `runProjection()` 未读 `journey_steps` 表，backbone 类型节点数恒为 0

顺带修复：`StateBadge` 直接渲染原始 `state_reason` 技术码，改为人话文案。

## 已确认的数据约束（影响合同精度）

- `journeys` 表关联字段：`capability_code`（非 `scope_key`），scope 用 `biz_area` 字段
- F1 对应 journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`，已有四步：接单进车间即分档、合同即法律、造完真验、交付有回执
- 当前 `/api/brain/map?scope=cecelia` 返回 86 节点，backbone=0，capability=11，feature=56
- F1 节点：upstream=51，downstream=0（边方向证据确凿）

## Test Contract

| Workstream | Test 文件 / 命令 | Behavior |
|---|---|---|
| D1 | `apps/api/features/planning/__tests__/map-collect-descendants.test.ts` | F1 形态 fixture（所有边指向 capability），`collectDescendants('F1', edges, nodes)` 返回 `['feat-a', 'feat-b']` 非空数组（Red → Green 顺序） |
| D1 | `apps/api/features/planning/__tests__/map-collect-descendants.test.ts` | `collectDescendants` 不收集 `owned_by` 反向边，只收集 `implements`/`contains` |
| D2 | `packages/brain/src/map/__tests__/projector-backbone.test.js` | `runProjection()` 查 journey_steps（JOIN journeys ON biz_area=$1 AND capability_code）后，backbone 节点数 = step 数，边类型为 `contains`，from_key = capability_code |
| D2 | `packages/brain/src/map/__tests__/projector-backbone.test.js` | backbone 节点 `attributes` 含 `promise`、`status`、`display_order`、`step_key` 字段 |
| D3 | `curl http://localhost:5221/api/brain/map?scope=cecelia` | 返回 backbone 节点数 ≥ 4（F1 四步骨干已投影） |
| D4 | Playwright 截图 | /map 页点 F1，Level 2 面板 backbone 栏显示四步骨干节点名称（接单进车间即分档 / 合同即法律 / 造完真验 / 交付有回执） |
| D5 | `apps/api/features/planning/pages/MapPage.tsx` + 视觉核查 | `StateBadge` 渲染 `child_unknown` 时显示「子节点状态未知」，不裸显技术码 |

## Golden Path

1. 开发者写 failing test（`map-collect-descendants.test.ts`）——验证当前 BFS 为空。
2. 修复 `collectDescendants`：在反向边（`edge.to === current && type in ['implements','contains']`）方向追加 BFS。
3. Test 转绿，commit（Red commit → Green commit，顺序不可颠倒）。
4. DevGate 三件套（`facts-check` / `version-sync` / `dod-mapping`）通过后，修改 `projector.js` 的 `runProjection()`，在写入节点/边之后追加 backbone 装配：  
   `SELECT js.id, js.step_key, js.name, js.promise, js.status, js.display_order, j.capability_code FROM journey_steps js JOIN journeys j ON j.id = js.journey_id WHERE j.biz_area = $1 AND j.capability_code IS NOT NULL ORDER BY j.capability_code, js.display_order`
5. 重新触发投影（调 Brain 投影 API 或等 cron），`/api/brain/map?scope=cecelia` 返回 backbone ≥ 4。
6. 修复 `StateBadge` `humanReason()` 映射，覆盖 9 个已知 reason_code。
7. Playwright 截图验证 Level 2 骨干栏四步可见。

## E2E 验收

```bash
# 前端回归测试（D1）
cd /workspace && npx vitest run apps/api/features/planning/__tests__/map-collect-descendants.test.ts

# Brain 骨干投影测试（D2）
cd /workspace && npx vitest run packages/brain/src/map/__tests__/projector-backbone.test.js

# 生产 API 骨干节点数量（D3）
curl http://localhost:5221/api/brain/map?scope=cecelia | \
  jq '[.nodes[] | select(.type=="backbone")] | length'
# 期望: >= 4

# Level 2 骨干面板 + StateBadge 截图（D4/D5）
# 由 mac_web Playwright 执行，截图路径：sprints/08131750-relay-cb41e551/e2e-screenshot-F1-backbone.png
```

## 未覆盖真实链路清单

- F1 以外其他 capability（G3/G5 等）的 backbone 装配，在本 Sprint 属于顺带验收，不作为主断言
- journeys 表新增 scope_key 列的 migration（经实查 biz_area 字段已满足需求，无需 migration）
- backbone 节点的 state 解析（stateBadge reason_code 修复覆盖现有 capability/feature 节点，backbone 状态未在本 Sprint 定义）
