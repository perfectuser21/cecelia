# Sprint PRD — 系统总图页上线（map 投影现算渲染）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（G1 统一查询能力的可视化出口上线）

## 背景

第四次登记。前史：r1 死于 infra lease 毛刺；r2 死于 base_sha 过期 ref；r3 的 generator 完成 Red+Green 但死于 impact_anchor_missing——view-model 被误写进不存在的 `packages/core/` 新树。清单 v7（决策 1222f4eb）已把 G1 认领范围限定为 `apps/dashboard/` 与 `apps/api/features/planning/` 两棵树。本 sprint 把已存在的 MapPage 从表格视图升级为直连 `/api/brain/map` 现算渲染的三层可折叠脑图，作为 G1 统一查询能力的用户出口。

## Golden Path（核心场景）

用户打开 [/map 页面] → 经过 [选 scope + 展开脑图 + 搜索] → 到达 [看到与 API 一致的系统总图]

具体：
1. 用户在 Dashboard（localhost:5174）打开 `/map` 路由，页面直连 `GET /api/brain/map?scope=cecelia` 现算拉取（不落缓存快照），渲染 manifest_version / digest / freshness / nodes / edges。
2. 页面以 mind-elixir 脑图呈现三层可折叠结构：价值流 → 能力 → 特性；特性节点显示测试证明数与覆盖条，并展示横切件与交接（handoff）面板。
3. 用户切换 scope 到 `zenithjoy-workspace`，脑图重新现算渲染对应投影；可用搜索定位节点。
4. 页面显示 freshness 徽标；当 `freshness.status` 非 `fresh` 时出现可见的过期提示。
5. 可观测出口：cecelia scope 渲染出 2 条价值流、11 个能力，且节点数量/名称与 API 返回一致。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- freshness 非 fresh（stale/unknown）→ 徽标变色 + 显示 reason_code 文案，不得静默当作 fresh。
- API 返回空 nodes/edges 或请求失败 → 页面显示空态/错误态，不白屏。
- scope 切换的并发请求 → 以最后一次选择为准，避免旧响应覆盖新视图。

## 范围限定

**在范围内**：
- 改造已存在的 `apps/api/features/planning/pages/MapPage.tsx` 为 live-fetch 三层脑图。
- view-model 等配套文件放 `apps/api/features/planning/` 内部，靠近页面。
- 路由经 `apps/api/features/system-hub/index.ts` 接线；`/map` 路由保持可达。
- 更新 `apps/dashboard/src/pages/map/MapPage.test.tsx` 验证 /map 路由存在并保持通过。
- `mind-elixir`（MIT）加入 `apps/dashboard/package.json` 依赖。

**不在范围内**：
- 新建任何顶层目录（`packages/core` 不存在，禁止创建）。
- 把实现放到 G1 两棵认领树（`apps/dashboard/`、`apps/api/features/planning/`）之外。
- 改动 `/api/brain/map` 后端投影逻辑（仅消费，不改算法）。

## 假设

- [ASSUMPTION: scope 枚举为 `cecelia` 与 `zenithjoy-workspace` 两个，与任务描述一致。]
- [ASSUMPTION: 设计布局照 demo artifact 28e4485e，仅将静态数据替换为 live fetch。]
- [ASSUMPTION: "2 价值流 11 能力" 为 cecelia scope 当前 v7 投影的真实值，验收以运行时 API 实际返回为准。]

## 预期受影响文件

- `apps/api/features/planning/pages/MapPage.tsx`：主页面，表格 → 三层脑图 + live fetch。
- `apps/api/features/planning/`（内部）：view-model / 组件配套。
- `apps/api/features/system-hub/index.ts`：路由接线，保证 /map 可达。
- `apps/dashboard/src/pages/map/MapPage.test.tsx`：断言 /map 路由存在并通过。
- `apps/dashboard/package.json`：新增 mind-elixir 依赖。

## NFR 约束

<!-- 来源: decisions category=nfr 双源均为空；以下为 PrepPRD 显式项 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 依赖许可: mind-elixir 必须为 MIT 许可（PrepPRD 显式）
- 可观测: freshness 非 fresh 必须有可见提示，禁止静默判 fresh（PrepPRD 显式）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 两源为空，仅 area 源 -->
- [凭据隔离] 多人协作禁止混用授权凭据，操作他人账号资源须用其本人授权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=mac_web 产出（Playwright，localhost:5174）。

```bash
# 占位：proposer 将填入 mac_web Playwright 脚本
# 期望验收点（自然语言）：
# 1. 打开 localhost:5174/map，页面直连 GET /api/brain/map?scope=cecelia 现算渲染。
# 2. 脑图三层可折叠（价值流→能力→特性），cecelia scope 出现 2 价值流、11 能力，且与 API 一致。
# 3. 切到 zenithjoy-workspace 脑图重新渲染；搜索能定位节点。
# 4. freshness 非 fresh 时页面出现可见过期提示。
```

## journey_type: user_facing
## journey_type_reason: 主体是 apps/dashboard/ 前端页面 + apps/api/features/planning UI，走浏览器打开 Cecelia Dashboard。
## target_environment: mac_web
## target_environment_reason: 任务显式指定 E2E 走 localhost:5174，本机 Playwright 验证 Dashboard 页面。
## journey_id: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
## step_id: keep-green
