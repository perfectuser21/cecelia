# Sprint PRD — Map 总图页 F1 下钻空白修复 + 骨干层装配

**Task ID**: cb41e551-f483-4189-af9f-9d3275d59d35
**Sprint Dir**: sprints/08131750-relay-cb41e551
**Brain URL**: http://host.docker.internal:5221
**生成时间**: 2026-08-13
**DevGate**: ✅ 三件套全部通过（facts-check / version-sync / dod-mapping）

---

## 问题全景

`/map` 页点开任意 capability（如 F1），Level 2 面板 backbone / feature / assertion 三栏恒为空白。  
根因已诊断：两个叠加缺陷，需合成一个交付物解决。

---

## 缺陷 1：下钻方向相反（Bug）

### 症状
`collectDescendants()` BFS 沿 `edge.from === current` 正向遍历，但实际投影中 feature/factory 等节点指向 capability：
- `feature_id --[implements]--> F1`
- `crosscut --[owned_by]--> F1`

F1 的 downstream 为空数组，BFS 永远找不到子孙节点。

### 证据（生产 API 实测）
```
/api/brain/map/nodes/F1?scope=cecelia
→ upstream: 51 条 (implements + owned_by)
→ downstream: 0 条
```
当前 F1 的 51 条边全是"别人指向 F1"，前端却沿 from===F1 的方向找。

### 涉及文件
- **前端**: `apps/api/features/planning/pages/MapPage.tsx` L122–L137 (`collectDescendants`)
- **边方向**: 投影器生成边时 `from=feature_key, to=capability_key`（`implements` 边），这是规范语义（feature implements capability），方向本身正确

### 修复方案（选项 A，改前端）
在 `collectDescendants` 中，同时遍历以下两个方向的边：
1. 正向：`edge.from === current`（原有逻辑，保留但对 capability 无实际效果）
2. 反向：`edge.to === current && INBOUND_TYPES.includes(edge.type)` —— 收集 `implements` / `contains` 指向当前节点的上游节点

`INBOUND_TYPES = ['implements', 'contains']`（`owned_by` 不属于子孙语义，不纳入）

### 必须先写 Failing Test
文件：`apps/api/features/planning/__tests__/map-collect-descendants.test.ts`

```typescript
// Fixture：F1 形态 — 边全部指向 capability，没有正向 downstream
const nodes = [
  { key: 'F1', type: 'capability', ... },
  { key: 'feat-a', type: 'feature', ... },
  { key: 'feat-b', type: 'feature', ... },
];
const edges = [
  { from: 'feat-a', to: 'F1', type: 'implements' },
  { from: 'feat-b', to: 'F1', type: 'implements' },
];
// 当前 collectDescendants('F1', edges, nodes) === [] (failing)
// 修复后应返回 [feat-a, feat-b]
```

---

## 缺陷 2：骨干层零投影（加厚）

### 症状
`/api/brain/map?scope=cecelia` 返回 86 节点，其中：
- `backbone` 类型：**0 个**
- `assertion` 类型：仅 **1 个**

Level 2 面板骨干栏永远空白，即使修复缺陷1后依然如此。

### 数据现状
- `journey_steps` 表中 F1 的 journey（`e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`）已有四步：
  1. 接单进车间即分档
  2. 合同即法律
  3. 造完真验
  4. 交付有回执
  每步带 `promise` + `status` 字段。
- `packages/brain/config/map-manifests/cecelia.v1.json` 仅声明到 `capability` 层，投影器 `buildStructuralProjection` 完全不读 `journey_steps`。

### 修复方案：为投影器加 backbone 层

#### 修改点 1：`packages/brain/src/map/projector.js`

在 `buildStructuralProjection` 中新增第 6 步（DB 查询版）：

```javascript
// 6. Backbone 节点（来自 journey_steps）
// 调用时机：runProjection() 传入 queryable，buildStructuralProjection 保持无副作用
// 因此，backbone 装配在 runProjection() 中独立做，不改 buildStructuralProjection 签名
```

在 `runProjection()` 中，生成结构投影后追加 backbone 节点/边：

```javascript
// 查 journey_steps，按 capability_key 关联
const { rows: steps } = await client.query(`
  SELECT js.id, js.step_key, js.name, js.promise, js.status, js.display_order, j.capability_key
  FROM journey_steps js
  JOIN journeys j ON j.id = js.journey_id
  WHERE j.scope_key = $1 AND j.capability_key IS NOT NULL
  ORDER BY j.capability_key, js.display_order
`, [scopeKey]);

for (const step of steps) {
  const backboneKey = `backbone_${step.id}`;
  const backboneId = stableNodeId(scopeKey, 'backbone', backboneKey);
  nodes.push({ node_id: backboneId, node_type: 'backbone', node_key: backboneKey,
    name: step.name, attributes: { promise: step.promise, status: step.status,
      display_order: step.display_order, step_key: step.step_key }, source_refs: [] });
  // capability → backbone contains 边
  const containsEdgeKey = `${step.capability_key}_contains_${backboneKey}`;
  edges.push({ edge_id: stableEdgeId(scopeKey, 'contains', containsEdgeKey),
    edge_key: containsEdgeKey, edge_type: 'contains',
    from_key: step.capability_key, to_key: backboneKey,
    from_node_id: resolveNodeId(step.capability_key), to_node_id: backboneId,
    source_refs: [], attributes: {} });
}
```

注意：`journeys` 表需要 `scope_key` 和 `capability_key` 字段——若缺失需确认 schema 后决定是否补 migration。

#### 修改点 2：`collectDescendants` 同时覆盖 backbone 节点
缺陷1修复后，backbone 节点（`from=backbone_xxx → to=F1` 方向为 contains 边，即 `from=F1 to=backbone_xxx`），应能被正向遍历找到。

---

## 顺带修复：StateBadge reason_code 人话化

### 问题
`apps/api/features/planning/pages/MapPage.tsx` L81 直接渲染 `node.state_reason` 原始字符串（如 `child_unknown`、`receipt_missing`、`no_receipt`、`no_anchor`）。

### 修复
在 `MapPage.tsx` 中添加翻译映射：

```typescript
const REASON_LABELS: Record<string, string> = {
  child_unknown:      '子节点状态未知',
  receipt_missing:    '回执未提交',
  no_receipt:         '无验收回执',
  no_anchor:          '无事实锚点',
  fact_stale:         '事实快照已过期',
  pass_current_revision: '当前版本通过',
  fail_current_revision: '当前版本失败',
  revision_mismatch:  '版本不匹配',
  resolver_error:     '状态解析器异常',
  manifest_declared:  '已在 Manifest 声明',
};

function humanReason(code: string | null | undefined): string {
  if (!code) return '';
  return REASON_LABELS[code] ?? code;
}
```

`StateBadge` 改为：
```tsx
{node.state !== 'green' && node.state_reason && <span>{humanReason(node.state_reason)}</span>}
```

---

## 验收断言

### 断言 1：vitest 回归测试（前端）
- **文件**：`apps/api/features/planning/__tests__/map-collect-descendants.test.ts`
- **内容**：F1 形态 fixture（所有边指向 capability），`collectDescendants('F1', edges, nodes)` 返回非空数组，包含两个 `feature` 节点
- **CI**：进 `workspace-ci.yml`，永久保留

### 断言 2：生产 API backbone 数量
```bash
curl http://localhost:5221/api/brain/map?scope=cecelia | \
  jq '[.nodes[] | select(.type=="backbone")] | length'
# 期望: >= 4（F1 的四步骨干）
```

### 断言 3：/map 页面截图
- 点击 F1，Level 2 面板 backbone 栏显示四步骨干
- 每步 feature 挂在对应步骤下
- StateBadge 显示人话文案而非原始 reason code

---

## 实施顺序

```
Step 1: 写 failing test (断言1) — apps/api/features/planning/__tests__/map-collect-descendants.test.ts
Step 2: 修复 collectDescendants，test 转绿
Step 3: 确认 journeys 表 schema（有无 scope_key + capability_key），决定是否需要 migration
Step 4: 若需 migration → 走 DevGate，再改 projector.js 的 runProjection() 追加 backbone
Step 5: 若不需 migration → 直接改 projector.js 追加 backbone，重新投影
Step 6: 验证 /api/brain/map?scope=cecelia 中 backbone >= 4（断言2）
Step 7: 修复 StateBadge reason_code 翻译
Step 8: 截图验证（断言3）
Step 9: commit + PR，永久进 CI
```

---

## 关键文件路径

| 文件 | 改动类型 |
|------|----------|
| `apps/api/features/planning/pages/MapPage.tsx` | 修复 collectDescendants + StateBadge 翻译 |
| `apps/api/features/planning/__tests__/map-collect-descendants.test.ts` | 新建 failing test（先写） |
| `packages/brain/src/map/projector.js` | runProjection() 追加 backbone 节点/边 |
| `packages/brain/config/map-manifests/cecelia.v1.json` | 无需改动（backbone 来自 DB） |

---

## DevGate 状态

- `node scripts/facts-check.mjs` → ✅ All facts consistent
- `bash scripts/check-version-sync.sh` → ✅ All version files in sync (v1.273.1)
- `node packages/quality/scripts/devgate/check-dod-mapping.cjs` → ✅ 映射检查通过

改动 `packages/brain/src/map/projector.js` 前，DevGate 三件套必须再跑一遍确认仍通过。

---

## Invariant 约束

| # | Invariant |
|---|-----------|
| 1 | collectDescendants BFS 必须同时遍历反向 implements/contains 边（to===current） |
| 2 | backbone 节点由投影器从 journey_steps 动态生成，不写入 manifest |
| 3 | capability → backbone 边类型为 `contains` |
| 4 | StateBadge reason_code 必须翻译为人话，不裸渲技术码 |
| 5 | 回归测试永久留 CI，不允许删除 |
| 6 | 改 Brain 代码前必须过 DevGate 三件套 |

---

## 累积 FR 加载

| # | FR |
|---|----|
| 1 | collectDescendants 同时收集 to===current 且 type in ['implements','contains'] 的反向边 |
| 2 | runProjection() 追加 backbone 层：从 journey_steps JOIN journeys 查询，生成 backbone 节点与 capability→backbone contains 边 |
| 3 | StateBadge 添加 reasonCodeMap 映射（9 个 code → 人话文案） |
| 4 | 新增 vitest 测试文件：apps/api/features/planning/__tests__/map-collect-descendants.test.ts |
| 5 | 先写 failing test（Red commit），再写实现（Green commit），顺序不可颠倒 |
| 6 | 生产 /api/brain/map?scope=cecelia 返回 backbone 节点数 ≥4 |

---

## NFR

- 性能：backbone 投影查询加 JOIN 后响应时间不超 500ms（生产 86 节点规模）
- 兼容性：不改动 manifest 文件格式，backbone 完全由 DB 动态生成
- 测试：回归测试永久留 CI，不允许删除

---

## journey_type: user_facing
## journey_type_reason: 验收断言3要求 /map 页面点 F1 截图，涉及前端 UI 渲染路径。
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard 前端 UI → mac_web（localhost:5174，内网 Playwright）。
## journey_id: 51754939-247e-4b22-8f93-f8464a8eb985
## step_id: a4438f77-7ee0-48f7-ab96-40e1b322ba14
