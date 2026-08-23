# Sprint PRD — Dashboard 系统总图页上线：map 投影现算渲染

## OKR 对齐

- **对应 KR**：G1 Command Deck（系统能力与运行状态可见）
- **当前进度**：待定（Brain context 未返回量化进度）
- **本次推进预期**：上线可从 Dashboard 访问的系统总图呈现层

## 背景

Brain 已提供 `GET /api/brain/map?scope=cecelia|zenithjoy-workspace` 的实时投影，但 Dashboard 尚无可访问的系统总图页。呈现层是运转前提；本 sprint 将 API 的当前投影直接呈现为可探索、可核对的系统总图。

## Golden Path（核心场景）

用户从 Dashboard system-hub 入口进入系统总图页 → 选择 scope 并探索价值流、能力和特性 → 看见测试证明、横切件、交接关系及投影新鲜度。

具体：
1. 用户从 system-hub 打开系统总图，页面请求当前 scope 的 `/api/brain/map` live 数据，并显示 manifest 版本与 freshness 徽标。
2. 用户在 `cecelia` 与 `zenithjoy-workspace` 双 scope 间切换；每次切换均显示对应 API 当前返回的投影，不沿用前一 scope 数据。
3. 用户按“价值流 → 能力 → 特性”三层展开或折叠，搜索可定位匹配节点；特性显示测试证明数量与覆盖条。
4. 用户查看横切件及交接面板，能够识别 `serves`、`owned_by` 与 `hands_off_to` 关系。
5. 当 freshness 不是 `fresh` 时，页面给出清晰、持续可见的非新鲜提示；请求失败或无数据时不展示为成功投影。

## 边界情况

- scope 切换期间显示明确加载态，较早请求不得覆盖较新 scope 的结果。
- 空节点、空关系或搜索无匹配时显示可理解的空状态。
- API 失败或响应不可用时显示错误状态，并保留重新请求入口。
- 缺失可选证明或关系数据时，其余有效层级仍可浏览。

## 范围限定

**在范围内**：Dashboard 系统总图页面、system-hub 可达入口、双 scope live fetch、三层折叠、搜索、证明覆盖、横切件/交接面板、manifest/freshness 呈现及状态反馈。

**不在范围内**：修改 map 投影生成算法、写入或编辑地图数据、新增第三个 scope、改变 Brain API 响应契约、复刻设计稿中的静态演示数据。

## 假设

- [ASSUMPTION: system-hub 是该页面的唯一主导航入口。]
- [ASSUMPTION: “覆盖条”以 API 已提供的 assertion/证明关系计算并呈现，不在前端臆造覆盖结论。]
- [ASSUMPTION: Unified Map 显式映射未完整配置；payload.map_scope 为数组且 payload.map_repo 缺失，因此本 PRD 仅以 payload 中 API 与验收事实锚定范围。]

## 预期受影响文件

- `apps/dashboard/src/pages/map/MapPage.tsx`：承载系统总图用户可见页面。
- `apps/dashboard/src/pages/map/` 下既有测试：固化页面核心行为和异常状态。
- `apps/dashboard/src/` 中 system-hub 路由配置：提供页面入口。

## DoD（可执行验收计划）

1. [BEHAVIOR] 从 system-hub 可进入系统总图，初始 live 请求、加载态、成功态可观察。
2. [BEHAVIOR] `cecelia` scope 页面价值流数与能力数逐项等于同次 API 响应，当前基准验收期待为 2 条价值流、11 个能力；若 API 实时数据变化，以逐项一致为准并单独报告基准偏差。
3. [BEHAVIOR] 切换到 `zenithjoy-workspace` 后页面与该 scope 的 API 响应一致，且没有前一 scope 残留。
4. [BEHAVIOR] 三层展开/折叠、搜索命中/无结果、特性证明数量与覆盖条均由 live 投影驱动。
5. [BEHAVIOR] 横切件和交接面板准确呈现 `serves`、`owned_by`、`hands_off_to` 关系。
6. [BEHAVIOR] manifest 版本可见；freshness 非 `fresh` 时出现可见警告，API 失败和空数据有明确状态。
7. [ARTIFACT] Dashboard 页面与路由的自动化回归测试进入既有 CI。
8. [ARTIFACT] mac_web E2E 在 localhost:5174 对真实页面和真实 API 完成从入口到结果的核对并留存断言结果。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 加载、错误、空数据及非 fresh 状态必须在页面可见。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step 与 journey_feature 无记录，area 返回 89 条 active 决策，均按 id 作为完整权威集合，避免复制时截断铁律正文。 -->
- [分支归属] Planner workspace 必须保持服务端签发的 planner branch，Provider 不得 checkout 或 switch（来源: area，id: ae95068e-1576-454a-9675-9de4f0bffa38）。
- [全量继承] `/api/brain/invariants?level=area` 本次读取的 89 条 active area invariant 全部继续生效；proposer/evaluator 必须按 decision id 去重并逐条校验，不得因本 PRD 摘要而删减（来源: area）。

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 在 contract-draft 中将以下验收点翻译为 localhost:5174 的 Playwright 脚本：
# 打开 system-hub → 进入系统总图 → 分别读取两个 scope 的真实 API → 核对节点/关系/证明统计 → 操作折叠与搜索 → 注入非 fresh 响应并断言可见警告。
```

## journey_type: user_facing
## journey_type_reason: 变更位于 apps/dashboard，用户通过浏览器直接操作和观察。
## target_environment: mac_web
## target_environment_reason: Dashboard E2E 在本机 Playwright 打开 localhost:5174。
## journey_id: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
## step_id: keep-green
