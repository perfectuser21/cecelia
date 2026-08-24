# Sprint PRD — 系统总图页上线（map 投影现算渲染）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+2%（管家指挥台 G1 统一查询的可视化出口落地）

## 背景

Unified Map 投影层（manifest v7）已现算产出 cecelia / zenithjoy-workspace 双 scope 的
节点/边/freshness，但缺一个把投影渲染给人看的总图页。本 sprint 把
`GET /api/brain/map?scope=...` 的现算结果渲染成三层可折叠脑图，作为 G1「统一查询」的用户可见出口。
第五次登记（r5）：前四轮死在 infra/base_sha/impact_anchor/evidence 越界，本轮实现范围与位置硬约束同 r4。

## Golden Path（核心场景）

用户在 Dashboard 打开 [/map 总图页] → 经过 [现算 fetch + 三层脑图渲染 + scope 切换] → 到达 [看到与 API 一致的价值流/能力/特性全景]

具体：
1. 用户浏览器打开 `localhost:5174/#/map`（导航「地图」入口，planning feature 已注册的 /map 路由）
2. 页面直连 `GET /api/brain/map?scope=cecelia` 现算拉取，用 mind-elixir 渲染三层可折叠脑图：
   价值流（value_stream）→ 能力（capability）→ 特性（feature）
3. 页面顶部显示 freshness 徽标；特性节点带「测试证明数」与覆盖条；提供横切件（crosscut）+
   交接面板（hands_off_to 边界）与节点搜索
4. 用户把 Scope 从 `cecelia` 切到 `zenithjoy-workspace` → 页面重新现算 fetch 并重渲染脑图
5. 可观察结果：cecelia scope 渲染出 **2 条价值流、11 个能力**，数字与 API summary 一致；
   freshness 非 fresh 时页面出现可见提示

## 边界情况

- freshness 状态为 `stale`/`unknown` 等非 `fresh` 值 → 徽标区必须出现可见提示文案，不得静默
- 某 scope 返回空 nodes/edges → 空态占位，不崩溃
- scope 切换过程中的 in-flight 请求 → 以最后一次选择为准，旧响应不覆盖新脑图
- 节点无 receipt / 测试证明数为 0 → 覆盖条显示 0，不报错

## 范围限定

**在范围内**：
- 改 `apps/api/features/planning/pages/MapPage.tsx`（总图页真身，已存在）
- view-model 等配套放 `apps/api/features/planning/` 内部
- 路由经 `apps/api/features/system-hub/index.ts` 接线（/map 现由 planning manifest 注册，保持一致）
- 依赖 `mind-elixir`（MIT）加进 `apps/dashboard/package.json`
- 更新 `apps/dashboard/src/pages/map/MapPage.test.tsx` 断言 /map 路由存在并保持通过
- 布局照 demo artifact 28e4485e，数据改 live fetch

**不在范围内**：
- 新建任何顶层目录（`packages/core` 不存在，禁止创建）
- 把实现放到 G1 认领的 `apps/dashboard/` 与 `apps/api/features/planning/` 之外
- 改 Brain map 投影后端逻辑（只消费现有 `/api/brain/map`）
- zenithjoy-workspace 的数据正确性校准（本 sprint 只保证切换能现算重渲染）

## 假设

- [ASSUMPTION: /map 路由已由 planning manifest（`apps/api/features/planning/index.ts:20`）注册指向 `./pages/MapPage`，复用不新注册]
- [ASSUMPTION: live freshness=fresh，「非 fresh 提示」由 stale mock 单测覆盖，live E2E 只断言 fresh 路径真实 2/11 计数]
- [ASSUMPTION: 三层层级由 map edges 的 contains 关系推导]

## 预期受影响文件

- `apps/api/features/planning/pages/MapPage.tsx`：总图页真身，改为 mind-elixir 三层脑图 + live fetch
- `apps/api/features/planning/`（api/components/view-model）：配套 view-model 与子组件
- `apps/api/features/system-hub/index.ts`：路由接线校对（保持 /map 可达）
- `apps/dashboard/package.json`：新增 `mind-elixir` 依赖
- `apps/dashboard/src/pages/map/MapPage.test.tsx`：断言 /map 路由存在并保持通过

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 line 空）+ PrepPRD 显式项，PrepPRD 优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: mind-elixir 需 MIT 许可；依赖声明于 apps/dashboard/package.json
- 可观测: 直连现算渲染，不得引入本地缓存掩盖 freshness；freshness 非 fresh 必须在页面可见

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并（本 line 均空）-->
- （本 line 暂无历史）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path（journey golden-paths 返回空）-->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；proposer 在 GAN 阶段按 target_environment=mac_web 填 Playwright 真实脚本，写进 contract-draft.md 的 `## E2E 验收` 区块。

```bash
# 占位：proposer 将按 target_environment=mac_web 填入真实 Playwright 脚本（localhost:5174/#/map）
# 期望验收点（自然语言）：
#  1. 浏览器打开 localhost:5174/#/map，标题/总图页可见，三层脑图渲染成功
#  2. cecelia scope 下脑图统计与 GET /api/brain/map?scope=cecelia 的 summary 一致：
#     value_streams=2、capabilities=11（真实计数，不是硬编码断言）
#  3. Scope 切到 zenithjoy-workspace 触发重新 fetch 并重渲染（无旧脑图残留）
#  4. freshness 徽标可见；非 fresh 状态下出现可见提示（stale mock 单测覆盖）
#  5. apps/dashboard/src/pages/map/MapPage.test.tsx 全绿（/map 路由断言保持通过）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard 与 apps/api/features/planning 的用户可见总图页，属前端页面
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard Web UI，本机 Playwright 打开 localhost:5174/#/map 现算渲染验证
## journey_id: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
## step_id: keep-green（gp_id=butler/g1_command_deck，来源 task.payload.anchor）
