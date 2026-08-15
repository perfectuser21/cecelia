# Sprint PRD — MJ5 OWNERS 映射层刀1：Brain 读目录级 OWNERS 声明并确定性投影（不猜归属）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（承诺地图闭环 MJ5：地图从"扫出来"进化为"映射出来"）

## 背景

主理人 2026-08-15 拍板（对照 Meta OWNERS / Google CUJ+SLO / Kythe，07-18 决策"抄 OWNERS：声明进仓贴代码走"）：**地图必须是"映射出来的"，不是"扫出来的"**。扫描（照相层）只回答"存在/新鲜"，永不定归属；归属只来自代码旁边的 OWNERS 声明。本刀让 Brain 具备"读声明→确定性投影"能力，并在 cecelia 仓先贴样板（feature `92d14f1e` OWNERS 映射层，planned/thin → 本刀落地为 thin 可用）。

## Golden Path（核心场景）

开发者放 OWNERS 声明 → Brain 读为 kind=owners 事实 → 地图按声明确定性投影 → `/map` Level-2 声明驱动渲染

具体：
1. 开发者在某目录放 `OWNERS` 声明文件（YAML：`capability: <scope>/<capability_key>`，可选 `step: stepN`/`steps: [stepN,…]`，可选 `owner: <人/角色>`）→ 提 PR 合并 → 声明进仓
2. Brain 扫描时**读取**各仓 OWNERS 文件（只读声明，不解析代码语义）→ 存为新事实种类 `kind=owners`（`fact_snapshot_headers` 新增 kind，带 source_revision/freshness 哨兵，同步 REQUIRED_FACT_KINDS）
3. 地图 rebuild/read 时按 OWNERS 声明把该目录下照相层事实（tests/api/db_schema/graph 节点）**确定性挂到**对应 capability（及 step）→ `/map` Level-2 与 `/api/brain/map/nodes/<key>` 展示
4. 声明冲突（同一路径被两个 capability 声明 / capability key 不在该 scope active manifest / step 不在 product-map）→ 该目录进"声明冲突"清单，`/map/health` 亮黄，**不猜、不静默、不投影**
5. 无 OWNERS 覆盖路径继续走无主清单 + island-check 棘轮（既有机制，数量只降不升）
6. cecelia 仓先给 `packages/brain/src/lib/map-*.js`、`packages/brain/src/map/**`、`apps/dashboard/src/pages/map/**` 贴 `OWNERS→cecelia/MJ5` 样板；rebuild 后 MJ5 名下自动出现这些文件与其测试

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry/db_schema 后推导，Planner 不定义技术规范。 -->

## 边界情况

- OWNERS 语法错（YAML 解析失败）→ 该文件进冲突清单并带**行号**，不使整仓扫描失败
- 作用域规则：一个 OWNERS 管本目录及全部子目录，**子目录 OWNERS 覆盖父级**（Meta 语义，避免双归属）
- 声明的 capability key 不存在于 active manifest / step 不在 product-map → 冲突清单，不投影
- 扫描器挂 → 既有 >24h / 10min stale 哨兵报红（照相层规矩，不新增口径）
- 空 OWNERS 目录 / 无声明目录 → 无主清单，行为不变

## 范围限定

**在范围内**：Brain OWNERS 读取器（kind=owners 新事实）+ 声明驱动确定性投影 + 冲突即报（/map/health）+ cecelia 仓 MJ5 OWNERS 样板 + `/map` Level-2 声明驱动渲染 + 逻辑守卫单测（解析/作用域/冲突/合法性）先红后绿并入 CI。

**不在范围内**：不给 zenithjoy 贴 OWNERS、不改 zenithjoy CI（刀2）；不改照相层扫描器事实口径（test/api/db_schema/graph 不动）；不做 Bazel/Nx 构建图、不引第三方 OWNERS 解析库；不改 GP 封版 11 要素 / journey_step_links 结构（禁平行账本）；不重切任何 GP 骨干；不补 zenithjoy 其余 journey 的 capability_code seed。

## 假设

- [ASSUMPTION: OWNERS 文件名固定为 `OWNERS`（无扩展名），内容为 YAML；解析用 Node 内置/现有依赖，不引新库]
- [ASSUMPTION: 事实归属粒度 = 文件级：test/graph 事实按 file_path 前缀匹配；api/db_schema 事实按 api_registry/db_schema_registry 现有 file 字段匹配，字段缺失则本刀补]
- [ASSUMPTION: MJ5 capability_key 已存在于 cecelia scope active manifest；样板 OWNERS 直接引用之]
- [ASSUMPTION: `map_repo` 未在 payload 提供，Unified Map 记为 not_configured；scope 锚定用 map_scope=MJ5 + journey 51754939]

## 预期受影响文件

- `packages/brain/src/lib/map-projector.js`：新增按 OWNERS 声明确定性投影逻辑
- `packages/brain/src/lib/map-anchor-resolver.js`：声明→capability/step 锚定与合法性校验
- `packages/brain/src/lib/map-read-service.js`：`/nodes/<key>` 与 Level-2 返回声明归属结果
- `packages/brain/src/lib/map-manifest-schema.js`：capability path_prefixes/exact_paths 复用/扩展
- 新增 OWNERS 读取器（`scripts/scan/scan-owners.*` 或 `packages/brain/src/lib/owners-reader.js`）+ `run-all-scans.sh` 接线
- `fact_snapshot_headers` + REQUIRED_FACT_KINDS + 新鲜度哨兵：新增 kind=owners
- `apps/api/features/planning/pages/MapPage.tsx`：Level-2 声明驱动渲染（非 UUID 串）
- cecelia 仓新增 `OWNERS` 样板文件（map 相关目录，capability=cecelia/MJ5）

## NFR 约束

<!-- 来源: decisions category=nfr（step+feature 均空数组）→ 仅用 PrepPRD 显式值 -->
- 超时/延迟: 待定（PrepPRD 未指定；proposer 阶段确认）
- 频控: 无
- 版本要求: 无
- 可观测: 声明冲突必须在 `/map/health` 亮黄可见；扫描器挂沿用 >24h/10min stale 哨兵报红
- 安全/隔离: Brain 本地 `localhost:5221`，`X-Internal-Token`=容器 env `CECELIA_INTERNAL_TOKEN`；integration 测试走 `db-config.js` DB_DEFAULTS，**禁连生产**

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step+feature 空；area 级 84 条中与本刀（map/scope 归属）相关的 2 条租户隔离铁律；其余 82 条为 capture-triage/Android 学习条目，与本刀无关不注入 -->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串，让隔离漏洞当场暴露（来源: area）
- [不猜归属] 归属只来自 OWNERS 声明；扫描层永不定归属，声明冲突即报不投影（来源: 本 sprint thin_prd 主理人拍板）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey 51754939 golden-paths 返回 []（skeleton line，尚无 done/working ability 沉淀 golden_path） -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述。**最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出**（target_environment=mac_web：本机可同时跑 curl+psql 后端验证与 Playwright UI 断言）。

```bash
# 占位：proposer 将按 target_environment=mac_web 填入真实脚本（curl+psql 后端 + Playwright 前端）
# 期望验收点（自然语言）：
# 1. 对 cecelia 仓扫描后 fact_snapshot_headers 出现 kind=owners 行，row_count ≥ 样板数，freshness 哨兵生效
# 2. POST /api/brain/map/rebuild {"scope_key":"cecelia"} 后，GET /api/brain/map/nodes/MJ5?scope=cecelia
#    返回按 OWNERS 归属的文件/测试节点（≥ 样板目录真实文件数），且 unclaimed_count 相对 rebuild 前下降
# 3. 制造双重声明冲突 → GET /api/brain/map/health?scope=cecelia 报冲突且该路径不被投影（proven-to-fire：先见红再改绿）
# 4. /map 页 Level-2 对 MJ5 显示声明驱动的目录/文件列表（Playwright mac_web 截图断言，非 UUID 串）
# 5. 无 OWNERS 目录仍在无主清单；island-check 既有 smoke 保持绿
# 6. 逻辑守卫单测（解析/作用域/冲突/合法性）先红后绿并入 CI；zenithjoy 侧 npm run test:product-map 不受影响
```

## journey_type: user_facing
## journey_type_reason: 本刀含 apps/dashboard `/map` Level-2 声明驱动渲染，用户在页面上直接感知归属结果，命中 if-elif 链首条 apps/dashboard。
## target_environment: mac_web
## target_environment_reason: /map Level-2 需 Playwright 截图断言（localhost:5174），mac_web 本机可同时执行 curl+psql 后端验证与 UI 断言。
## journey_id: 51754939-247e-4b22-8f93-f8464a8eb985
## step_id: none（PrepPRD 锚定到 feature 92d14f1e OWNERS 映射层，未细化到具体 step UUID）
