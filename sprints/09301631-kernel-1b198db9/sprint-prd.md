# Sprint PRD — 价值流建模②：areas.parent_area_id + journeys.kind + 旧 capabilities 并入 system_capabilities 腾名

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（价值流 13 张表方案的第 2 张增量落地，为后续 workflows/steps/spans 的 %C&A 度量打底）

## 背景

主理人决策 3e867cad（价值流建模 13 张表方案，2026-09-29 拍板）中「改 5」的前 3 张表。本 sprint 只做其中 1-3 项：
1. `areas` 加自引用父列，让部门可挂到产品线下（新媒体部门 → ZenithJoy）。
2. `journeys` 加 `kind`（value_stream / capability），并让业界词视图 `value_streams` / `capabilities` 随 `kind` 派生。
3. 现有 `capabilities` 表（决策记载 37 行系统能力清单）并入 `system_capabilities`，把 `capabilities` 这个名字腾出来给上面的视图用。
其余「改 5」表（backbone_activities / task_runs / step_probes）与「新建 5」不在本 sprint。

## Golden Path（核心场景）

系统从 [跑 Brain migration] → 经过 [areas 加 parent_area_id、journeys 加 kind、旧 capabilities 数据搬进 system_capabilities 并腾名、重建 value_streams/capabilities 两视图] → 到达 [migration 幂等通过、schema_version 前进、selfcheck 绿、三处结构可经 psql/Brain API 观测到新形态且旧数据零丢失]

具体：
1. [触发条件] 在 `packages/brain` 新增编号 `493_*.sql` migration，`node src/migrate.js` 执行。
2. [系统处理]
   - `areas` 新增可空 `parent_area_id uuid REFERENCES areas(id) ON DELETE SET NULL`；并把「新媒体部门」area 的 `parent_area_id` 指向「ZenithJoy」area。
   - `journeys` 新增 `kind`（枚举，取值 `value_stream` / `capability`），语义：无父的 journey = value_stream、有父的 journey = capability（父关系判定见「假设」）。
   - 旧 `capabilities` 表 37 行系统能力清单逐行映射搬入 `system_capabilities`（零丢失），随后把旧 `capabilities` 表退役（drop / rename）腾出名字。
   - `CREATE OR REPLACE VIEW value_streams`（原 391 已存在、原样 alias journeys）改为按 `kind='value_stream'` 过滤；新建 `CREATE VIEW capabilities` 按 `kind='capability'` 过滤 journeys。
3. [可观测结果] migration 二次执行仍幂等；`SELECT` 三处新结构与两视图均返回预期；`system_capabilities` 行数 = 原 `system_capabilities` + 37；selfcheck 通过。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **视图名撞库**：`capabilities` 视图必须在旧 `capabilities` 表腾名之后创建，否则 CREATE VIEW 撞已存在关系；migration 内部顺序须「先搬数据 + 退役旧表 → 再建视图」。
- **既有 value_streams 视图**：391 已建 `value_streams`（原样 alias journeys），须用 `CREATE OR REPLACE VIEW` 重定义，不能 CREATE 报重复。
- **数据零丢失 + 幂等**：并表映射须覆盖旧 `capabilities` 所有非空列落到 `system_capabilities`（映射不上的进 `definition` JSONB）；全 migration 用 `IF NOT EXISTS`/存在性判断包裹，重复执行不报错、不重复搬数据。
- **外键空值**：绝大多数 area 的 `parent_area_id` 为 NULL（顶层）；仅显式指定的父子对被设值。
- **枚举单源**：`kind` 取值集合若被多处消费，须遵守 area 铁律「枚举语义常量只允许一份」，落在共同 import 的 service，禁止手抄副本。

## 范围限定

**在范围内**：
- 新增一支 `packages/brain/migrations/493_*.sql` 完成上述三张表结构 + 数据并入 + 两视图重建。
- 必要时同步 `selfcheck.js` / DEFINITION.md / facts 契约，使 DevGate（facts-check / version-sync / dod-mapping）通过。
- 旧 `capabilities` 表数据零丢失搬入 `system_capabilities` 并退役旧表。

**不在范围内**：
- 不做「新建 5」表（workflows/steps/enablers/enabler_calls/spans）。
- 不改 backbone_activities / task_runs / step_probes（改 5 的后 3 张）。
- 不改 dashboard / apps / engine 代码，不做前端展示。
- 不迁移或重写 capability-scanner 的业务逻辑（除非其 SQL 直读旧 `capabilities` 表名导致 selfcheck/测试红，此时最小改名以保持绿）。

## 假设

- [ASSUMPTION: journeys 当前无 `parent_journey_id` 列；本 sprint「无父/有父」的父关系判定，若无显式父列则 `kind` 由数据显式写入（默认 `value_stream`），父列本身留待 13 表方案后续 sprint。proposer 须据 api_registry / 现网数据锁定 kind 的默认值与回填规则。]
- [ASSUMPTION: 旧 `capabilities` 行数以现网为准（决策记载 37，migration 030 种子 23）；实现时以 `SELECT count(*)` 实测为搬迁基数，验收断言「搬后 system_capabilities 增量 = 实测旧行数」。]
- [ASSUMPTION: 「新媒体部门」与「ZenithJoy」两 area 已存在于 areas 表；父子指向按 name 精确匹配，缺任一则该 seed 跳过并记录，不阻断结构变更。]
- [ASSUMPTION: 新 migration 编号取 493（现最新 492）；selfcheck EXPECTED_SCHEMA_VERSION 现为 430，DB≥430 即通过，是否随本次上调由 proposer 按约定决定。]

## 预期受影响文件

- `packages/brain/migrations/493_*.sql`: 新增——三处结构变更 + 数据并入 + 两视图重建（本 sprint 主产物）。
- `packages/brain/src/capability-scanner.js`: 若直读旧 `capabilities` 表名，需最小改指向 system_capabilities 以保持绿。
- `packages/brain/src/similarity.js`: 含对 `capabilities` 的向量检索（第 392-401 行），旧表退役后须改读新表或视图。
- `packages/brain/src/selfcheck.js`: 如需上调 EXPECTED_SCHEMA_VERSION。
- `DEFINITION.md` / facts 契约: 若表清单被 facts-check 校验则同步。
- `packages/brain/src/__tests__/`: 新增/更新 migration-493 回归测试（幂等 + 数据零丢失 + 两视图形态）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step 源 []、feature 源不适用 ability_id=none、active nfr 决策 0 条），PrepPRD(决策 3e867cad) 未显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定；migration 为一次性 DDL，无在线延迟约束）
- 频控: 无
- 版本要求: schema_version 须单调前进，migration 幂等（IF NOT EXISTS）
- 可观测: migration 失败必须落 Brain 日志；数据并入前后行数可经 psql/Brain API 核对

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step 源 []、journey_feature 源不适用（ability_id=none）、area 源命中相关项 -->
- [枚举单源] 枚举语义常量（非终态集合）只允许一份，落在被各消费方共同 import 的 service；手抄同值副本是隐形炸弹（来源: area）——直接约束 journeys.kind 取值集合
- [验证命令实跑] 合同里的验证命令必须实跑确认 exit code 语义，绿态误判须排除（来源: area）
- （另有多条 area 级 `[capture-triage] learning:` 型 harness 过程铁律，均为链路自愈/证据窗口/毕业步等过程约束，与本 DB 结构变更无功能耦合，evaluator 侧仍按 area 全量生效）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）<!-- payload 无 journey_id，line 级累积 FR 无法锚定，优雅降级为空 -->

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（psql + curl localhost:5221）。

```bash
# 占位：proposer 将填入真实 local_api 脚本（node packages/brain/src/migrate.js + psql 断言 + Brain API 核对）
# 期望验收点（自然语言）：
#   1. migrate 前记录 old=count(capabilities); sysc0=count(system_capabilities)；跑 migrate 成功且二次执行仍幂等，schema_version 前进
#   2. areas 含 parent_area_id 自引用 FK 且 新媒体部门.parent_area_id=ZenithJoy.id；journeys 含 kind 受约束在 {value_stream,capability}
#   3. count(system_capabilities)=sysc0+old（零丢失）且旧 capabilities 表已退役；value_streams/capabilities 两视图各只返回对应 kind
#   4. selfcheck 通过；DevGate facts-check / version-sync / dod-mapping 绿
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 DB schema 变更（migration + 视图 + 数据并入），无用户界面与远端 agent 协议，属自治后端演进。
## target_environment: local_api
## target_environment_reason: 验收在本地 evaluator 用 psql + curl localhost:5221 对 Brain DB/API 核对结构与行数，无需浏览器或远端机器。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
