# Sprint PRD — 价值流建模⑤：probes 挂点改 target_type/target_id + cells 扩 step/enabler 级 + steps/enablers Notion 投影 + golden_path* 退役

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」
- **当前进度**：82%
- **本次推进预期**：+2%（价值流建模 13 张表方案 3e867cad 第 11/13 张表落地 + 旧表收尾）

## 背景

承接决策 3e867cad「价值流建模 13 张表方案」。任务④（migration 492）已建 steps / enablers / enabler_calls。本 sprint ⑤ 收尾：把归位类探针从只能挂活动（activity）精确挂到 step 与 enabler；把 cells（journey_step_links）从活动级扩到 step/enabler 级并进地图与 Notion 承诺地图；把 steps/enablers 投影进 Notion；退役 golden_path 三张旧表。根因见 492 注释——"采集/归位"这一格从画出来就是灰的，探针挂不到 step。

## Golden Path（核心场景）

系统运维者 从 [执行本 sprint 迁移] → 经过 [probes 重挂点 / cells 扩级 / Notion 投影 / 旧表退役] → 到达 [探针精确落到 step 与 enabler、承诺地图显示 steps/enablers、golden_path* 消失]

具体：
1. 执行本 sprint 新增迁移（493+）：`step_probes` 更名/改造为 `probes`，新增 `target_type`（枚举 activity|step|enabler）+ `target_id`；已有行按 target_type=activity 原样回填，不丢探针。
2. `journey_step_links`（cells）扩到 step/enabler 级：允许 cell 指向 steps.id / enablers.id（非仅活动级），并进入 map_projection 与 Notion 承诺地图链。
3. 运行 steps/enablers Notion 投影：`sync-steps-from-workspace.mjs` + Notion projection 把 steps、enablers 两张表投影进 Notion（承诺地图新增 steps/enablers 视图），投影回执写入投影链。
4. 退役旧表：`golden_path`、`golden_paths`、`golden_path_contract_versions` 三张旧表 DROP；代码里对这三表的残留读写清理为对新价值流表的引用（或删除死路径）。
5. 出口可观测：`probes.target_type/target_id` 就位且旧探针零丢失；cells 可在 step/enabler 级建链；Notion 承诺地图出现 steps/enablers；`to_regclass('golden_path'/'golden_paths'/'golden_path_contract_versions')` 均为 NULL；DevGate 三闸 + selfcheck 绿。

## 边界情况

- 迁移可重跑（幂等）：`probes` 改造与 cells 扩级用 IF NOT EXISTS / ON CONFLICT DO NOTHING，重跑不覆盖后来人改的值。
- 旧探针回填：`step_probes` 现有行必须 100% 迁入 `probes`（target_type=activity），迁移后计数一致，零丢失。
- golden_path* 退役前需确认无活跃代码路径依赖（有则先切到新表），避免 DROP 后运行时 500。
- Notion 投影外部不可达时：投影失败必须写 Brain log 并可重试，不得静默假成功。

## 范围限定

**在范围内**：probes 挂点改造（target_type/target_id）、cells 扩 step/enabler 级并进地图/Notion、steps/enablers Notion 投影、golden_path* 三表退役及代码残留清理、对应回归测试。
**不在范围内**：13 张表方案其余尚未落地的表（本 sprint 只做第 11/13 张与收尾）、Dashboard UI 变更、探针实际归位业务逻辑（本 sprint 只改挂点结构，不改采集算法）。

## 假设

- [ASSUMPTION: 新迁移编号从 493 起递增；golden_path* DROP 与 probes 改造可拆多条迁移文件]
- [ASSUMPTION: Notion 承诺地图链复用现有 notion-probe-projection.js / notion 投影链风格，新增 steps/enablers 两个投影目标]
- [ASSUMPTION: 无 journey_id/ability_id 注入，本 sprint 历史约束仅 area 级；scope 锚定来自决策 3e867cad 与任务描述]

## 预期受影响文件

- `packages/brain/migrations/493_*.sql`（及后续）: 新建——probes 改造 + cells 扩级 + golden_path* DROP
- `packages/brain/migrations/474_step_probes.sql`: 参照——旧 step_probes 结构来源
- `packages/brain/src/notion-probe-projection.js`: probes 改名后投影字段随动（target_type/target_id）
- `packages/brain/scripts/sync-steps-from-workspace.mjs`: steps/enablers Notion 投影入口
- `packages/brain/src/golden-path-contracts.js` / `gp-shelf-life.js` / 其余 golden_path 读写点: 旧表退役后的残留清理
- `packages/brain/src/selfcheck.js`: schema 版本自检随迁移推进
- `packages/brain/DEFINITION.md`: journey_step_links / probes 表定义随动

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task 查询为空）+ PrepPRD（无 thin_prd）；无显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: DB schema 迁移后 selfcheck 通过（EXPECTED_SCHEMA_VERSION 校验绿）
- 可观测: Notion 投影失败必须写 Brain log，不得静默假成功

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（无 step/journey_feature 级注入） -->
- [枚举单份] 枚举语义常量只允许一份，落在被各消费方共同 import 的 service，禁止手抄同值副本（来源: area）
- [幂等CAS] "SELECT 判态再 UPDATE" 一律升级为 UPDATE ... WHERE status=ANY(非终态) 的 CAS，防并发（来源: area）
- [jsonb浅合并] 往任务 result 塞回执用固定子键（receipt），不覆盖 payload（来源: area）
- [探针零丢失] step_probes 迁入 probes 后计数一致，禁止丢探针（来源: 决策 3e867cad 语义）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组 -->
- （本 line 暂无历史）— 无 journey_id 注入，initiative_runs 无法查询；已落地基线见 migration 492（steps/enablers/enabler_calls），本 sprint 不得重建这三表

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl + psql。

```bash
# 占位：proposer 将填入真实 psql/curl 脚本
# 期望验收点（自然语言）：
# 1) psql \d probes：存在 target_type（CHECK in activity|step|enabler）+ target_id 列；step_probes 旧行全部迁入且计数一致（零丢失）
# 2) psql：journey_step_links 可在 step/enabler 级建 cell（插入指向 steps.id / enablers.id 的行成功）
# 3) Notion 承诺地图/投影链出现 steps 与 enablers 投影（投影回执/digest 存在，日志无失败）
# 4) psql SELECT to_regclass('golden_path'), to_regclass('golden_paths'), to_regclass('golden_path_contract_versions') 三者均为 NULL
# 5) DevGate 三闸绿：facts-check.mjs / check-version-sync.sh / check-dod-mapping.cjs；selfcheck schema 版本通过
```

## journey_type: autonomous
## journey_type_reason: 纯后端改动，仅涉及 packages/brain/（migrations + src 投影/清理），无 UI、无 agent 协议、无 engine
## target_environment: local_api
## target_environment_reason: 验收在本地 evaluator 用 psql（cecelia 库）+ curl localhost:5221 完成，无需 Windows/微信/远端机器
## journey_id: none
## step_id: none（PrepPRD 未锚定）
