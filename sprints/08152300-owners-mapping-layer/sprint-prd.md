# Sprint PRD — MJ5 OWNERS 映射层刀1：Brain 读目录级 OWNERS 声明并确定性投影到地图（不猜归属）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：feature `92d14f1e` OWNERS 映射层 planned/thin
- **本次推进预期**：feature 落地为 thin 可用（Brain 具备"读 OWNERS 声明→确定性投影"能力，cecelia 仓自贴样板验证）

## 背景

主理人拍板（2026-08-15，对照 Meta OWNERS / Google CUJ+SLO / Kythe，07-18 决策"抄 OWNERS：声明进仓贴代码走"）：**地图必须是"映射出来的"，不是"扫出来的"**。扫描（照相层）只回答"存在/新鲜"，永不定归属；归属只来自代码旁边的声明。ZenithJoy 仓 5311 条事实无主、line02 地图全灰，根因是仓里没有 OWNERS 可映。本刀让 Brain 具备"读声明→投影"能力，并在 cecelia 仓先贴样板验证。

## Golden Path（核心场景）

系统从 [OWNERS 声明进仓] → 经过 [Brain 读声明为 owners 事实 + 确定性投影] → 到达 [/map Level-2 按声明显示 capability 名下目录/文件/测试]

具体：
1. 开发者在某目录放 `OWNERS` 声明文件（YAML：`capability: <scope>/<capability_key>`，可选 `step: stepN` 或 `steps: [stepN,…]`，可选 `owner:`）→ 提 PR 合并 → 声明进仓
2. Brain 扫描时**读取**各仓 OWNERS 文件（只读声明、不解析代码语义）→ 存为新事实种类 `owners`（`fact_snapshot_headers` 新增 kind，带 source_revision/freshness 哨兵）
3. `POST /api/brain/map/rebuild {"scope_key":"cecelia"}` 时按 OWNERS 声明把该目录下照相层事实（tests/api/db_schema/graph 节点）确定性挂到对应 capability（及 step）节点 → `/map` Level-2 与 `GET /api/brain/map/nodes/<capability>?scope=cecelia` 展示
4. 声明冲突（同一路径被两 capability 声明 / capability key 不在 manifest / step 不在 product-map）→ 该目录进"声明冲突"清单，`GET /api/brain/map/health?scope=cecelia` 亮黄，不猜、不静默、不投影该路径
5. 无 OWNERS 覆盖的路径继续走无主清单（`/api/brain/map/unclaimed`）+ island-check 棘轮（既有，只降不升）
6. cecelia 仓给 `packages/brain/src/lib/map-*.js`、`packages/brain/src/map/**`、`apps/dashboard/src/pages/map/**` 贴 `OWNERS`→`cecelia/MJ5` 样板；rebuild 后 MJ5 名下自动出现这些文件与其测试
- 出错恢复：OWNERS 语法错 → 该文件进冲突清单并带行号；扫描器挂 → 既有 >24h/10min stale 哨兵报红（照相层规矩）

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- 作用域语义：一个 OWNERS 管当前目录及全部子目录，子目录 OWNERS 覆盖父级（Meta 语义，"子覆盖父"避免双归属）
- 同一路径多重声明 → 报冲突不投影（不取最深、不全投影）
- capability key 不在该 scope active manifest → 声明打空并进冲突清单
- 空 owners 事实 / rebuild 前无声明 → MJ5 名下为空但不报错，无主清单照常
- 事实归属粒度：test/graph 事实按 file_path 前缀匹配；api/db_schema 事实按其源文件路径（api_registry/db_schema_registry 现有 file 字段），缺字段则本刀补

## 范围限定

**在范围内**：Brain OWNERS 读取器（kind=owners 事实）、地图按声明确定性投影、冲突即报进 health、cecelia 仓自贴 OWNERS 样板、`/map` Level-2 声明驱动渲染、逻辑守卫单测（解析/作用域/冲突/合法性）先红后绿入 CI
**不在范围内**：给 zenithjoy 贴 OWNERS 或改其 CI（刀2）；改照相层扫描器事实口径（test/api/db_schema/graph 不动）；Bazel/Nx 构建图；第三方 OWNERS 解析库；改 GP 封版 11 要素/journey_step_links 结构；重切任何 GP 骨干

## 假设

- [ASSUMPTION: OWNERS 文件格式为 YAML，字段 `capability`（必填）/`step|steps`（可选）/`owner`（可选），文件名固定为 `OWNERS`]
- [ASSUMPTION: cecelia scope 的 active manifest 已含 capability key `MJ5`，可供 `cecelia/MJ5` 声明校验通过]
- [ASSUMPTION: 样板目录下真实文件数 ≥1，rebuild 后 `nodes/MJ5` 节点数 > 0]

## 预期受影响文件

- `packages/brain/src/lib/map-*.js`（map-projector / map-anchor-resolver / map-read-service）：新增 OWNERS 声明读取 + 确定性投影逻辑
- `packages/brain/src/map/**`：owners 事实种类接入 rebuild/read
- `scripts/scan/*` + `run-all-scans.sh` + `fact_snapshot_headers`：新增 kind=owners + REQUIRED_FACT_KINDS + 新鲜度哨兵
- `apps/dashboard/src/pages/map/**`（`apps/api/features/planning/pages/MapPage.tsx`）：Level-2 声明驱动渲染
- `packages/brain/**/OWNERS`、`apps/dashboard/**/OWNERS`：cecelia 仓自贴样板声明文件
- 逻辑守卫单测（解析/作用域/冲突/合法性）：先红后绿入 CI

## NFR 约束

<!-- 来源: PrepPRD 显式值（主源；decisions 表 category=nfr 无活跃记录） -->
- 鉴权：内部端点走 `X-Internal-Token`（= 容器 env `CECELIA_INTERNAL_TOKEN`）/ internalAuthOrLoopback
- 新鲜度：owners 事实沿用照相层哨兵（>24h stale 报红，10min 扫描窗），冲突/语法错必须可观测（health 亮黄 + 带行号）
- 测试隔离：integration 走 db-config.js DB_DEFAULTS，禁连生产库
- 凭据：无新增外部凭据
- 依赖：不引入第三方 OWNERS 解析库

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 主理人拍板 + decisions e035dad8（journey_feature 判定点）+ area mapper 纪律 -->
- [不猜归属] 归属只来自代码旁的 OWNERS 声明；扫描层只回答存在/新鲜，永不定归属（来源: 主理人拍板 07-18/08-15）
- [冲突即报] 同一路径多重声明 → 报冲突不投影，不猜不静默（来源: journey_feature e035dad8）
- [key 合法性] capability key 必须在该 scope active manifest capabilities 内，否则声明打空（来源: journey_feature e035dad8）
- [子覆盖父] 作用域为目录及全部子目录，子目录 OWNERS 覆盖父级（来源: journey_feature e035dad8）
- [禁平行账本] 不改 GP 封版 11 要素 / journey_step_links 结构（来源: area mapper 纪律）
- [planner 分支纪律] planner 绑定服务端签发 PLANNER_BRANCH，禁自行 checkout/switch（来源: area planner_role_branch）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey 51754939 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收 ability — journey 51754939 为 skeleton，认领制三闸 / 引用重跑闸图驱动 两 sibling 均 working/thin 未毕业）

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=mac_web 产出（Playwright + curl 混合，写进 contract-draft.md）。

```bash
# 占位：proposer 将按 target_environment=mac_web 填入真实脚本（Playwright /map 截图断言 + curl localhost:5221 API 断言 + psql fact_snapshot_headers 断言）
# 期望验收点（自然语言）：
# 1. cecelia 仓扫描后 fact_snapshot_headers 出现 kind=owners 行，row_count ≥ 样板数，freshness 哨兵生效
# 2. POST /map/rebuild {scope_key:cecelia} 后 GET /map/nodes/MJ5?scope=cecelia 返回按 OWNERS 归属的文件/测试节点（≥ 样板目录真实文件数），unclaimed_count 相对 rebuild 前下降
# 3. 制造双重声明冲突 → GET /map/health?scope=cecelia 报冲突且该路径不投影（proven-to-fire：亲眼见红再改绿）
# 4. /map 页 Level-2 对 MJ5 显示声明驱动的目录/文件列表（Playwright mac_web 截图断言，非 UUID 串）
# 5. 无 OWNERS 目录仍在无主清单；island-check 既有 smoke 保持绿
# 6. 逻辑守卫单测（解析/作用域/冲突/合法性）先红后绿并入 CI；zenithjoy 侧 npm run test:product-map 不受影响
```

## journey_type: user_facing
## journey_type_reason: 本刀触及 apps/dashboard `/map` 页 Level-2 声明驱动渲染，用户可在 UI 直接感知，按优先级链 UI > brain 命中 user_facing
## target_environment: mac_web
## target_environment_reason: 验收含 Playwright `/map` 截图断言（localhost:5174 Cecelia Dashboard），mac_web 本机 Playwright 并可同机 curl localhost:5221 验 API
## journey_id: 51754939-247e-4b22-8f93-f8464a8eb985
## step_id: factory/MJ5 keep-green（feature 92d14f1e OWNERS 映射层；PrepPRD GP-Anchor，无独立 Step UUID）
