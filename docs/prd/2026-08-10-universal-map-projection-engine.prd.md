# PRD：Universal Map Projection Engine——业务意图 × 实现事实的自动现算地图

- 日期：2026-08-10
- 状态：已定向，交给新 session 认领执行
- 类型：通用平台能力；Cecelia 是首个真实验收域，不是专用实现
- 业务锚点：工厂 · MJ5 承诺地图闭环（投影引擎）＋ 管家 · G1 指挥舱（可视化消费）
- 首验决策：`4bc109e9-3b70-4b17-a1b4-bcd01bfae776`
- 历史方向锚：`d533e634`（照相层/账本层分离）、`af3a5374`（承诺地图与依赖图以锚点结合）

---

## 一、用户要的到底是什么

用户不要一个负责逐项登记的 Skill，也不要一张需要持续人工维护的表。用户要的是一台通用
Map Engine：业务意图输入一次，代码、测试、API、数据库和运行结果持续变化时，系统自动把
“现在到底是什么样子”投影出来。

目标模型：

```text
主理人拍板的业务意图（Brain）             各仓库实现事实（Git / CI / DB）
            │                                      │
            │ 一次结构化输入                        │ 自动扫描 / 事件回执
            ▼                                      ▼
     Versioned Map Manifest                  Fact Snapshot Pool
            │                                      │
            └──────────────┬───────────────────────┘
                           ▼
                Deterministic Map Projector
                           │
                 节点、边、锚点、影响半径
                           ▼
                   Query-time State Resolver
                           │
               Unified Map API（唯一读入口）
                           │
             Dashboard / AI / CI / Notion 投影
```

一句话承诺：**意图只输入一次，现实自动流入，状态查询时现算，所有消费者看到同一张图。**

---

## 二、问题与根因

### 2.1 当前只有零件，没有完整 Mapper

现存零件：

- 业务账本：`journeys / golden_paths / journey_steps / journey_features / journey_step_links`
- 代码照相层：`graph_edges / api_registry / db_schema_registry / test_registry`
- 自动扫描器：`scripts/scan/scan-graph.mjs` 等四个 scanner
- 代码图查询：`/api/brain/graph/{locate,related,radius,island-check,claim-status}`
- 可视化：Dashboard 军师台
- 语义切分助手：`capability-mapper` Skill

但中间缺失“业务意图 + 实现事实 → 统一地图”的确定性 Projector。军师台直接读取旧账本，
没有消费代码关系图；`capability-mapper` 只输出 Markdown 并逐表写库，不是运行时引擎。

### 2.2 当前不是现算

`journey_step_links.cell_status` 仍被写入数据库，Dashboard 原样展示。测试文件删除、CI 变红、
锚点断裂后，旧绿状态不会自然失效。2026-08-06 已明确收敛的目标是：

- 格子只保存稳定锚点，不保存权威红绿；
- 绿 = 锚点存在 + 目标存在 + 与当前 revision 匹配的最近有效执行 PASS；
- 红 = 有有效锚点，但当前 revision 最近执行 FAIL；
- 灰 = 没有锚点；
- 未知 = 照相层陈旧、执行证据过期或数据源不可用；
- 状态必须查询时计算，禁止拿历史 `cell_status` 冒充当前事实。

### 2.3 自动事实池已经停摆

截至本 PRD 写作时，`graph_edges` 的 Cecelia 照片最后扫描时间为 2026-07-20，API 已报告
约 509 小时陈旧。Host cron 虽仍每五分钟触发，但 cron PATH 找不到 `node`，四个扫描器均失败。
因此恢复事实池是本项目的硬前置，不可把旧快照拿来做投影验收。

### 2.4 最新业务地图只存在于自然语言决策

决策 `4bc109e9` 已拍板 Cecelia 为 2 条价值流、11 个 Capability、2 条边界、7 项横切件，
共享前置不适用；但数据库结构仍是旧的 9 条 Cecelia journey 与 17 条 golden_paths。最新决策
没有成为机器可读 Map Manifest，也没有自动生成投影。

---

## 三、产品原则（不可退让）

1. **双真相源，不建第三本账**
   - 业务意图真相：Brain 中经用户拍板并绑定 decision 的 Versioned Map Manifest。
   - 实现事实真相：Git、测试清单、API、DB schema、CI/验收回执。
   - Projection 是可删除重建的派生物，绝不能反向覆盖真相源。

2. **一次输入，不做逐节点 CRUD**
   - 一个 scope 的完整业务地图以单份 manifest 提交、校验、激活。
   - 禁止要求人分别创建 2 个 Value Stream、11 个 Capability、2 条 Boundary、7 个 Cross-cut。
   - 激活 manifest 后，全部节点、边和兼容读面由 Projector 一次生成。

3. **确定性优先，AI 只有提案权**
   - 稳定 ID、图结构、锚点命中、状态与影响半径由代码确定性计算。
   - AI 可对未归属代码提出候选映射，但候选不得直接进入 active projection。

4. **状态现算，不保存权威颜色**
   - Projection 可缓存结构，红绿灰未知必须基于当前事实与 receipt 查询时计算。
   - 旧 `cell_status` 只作为迁移输入和兼容字段，完成切换后不得成为读面权威。

5. **陈旧即未知，禁止旧绿假装健康**
   - 任一关键事实源超过 freshness budget，相关节点状态必须降为 `unknown` 并带原因。

6. **通用内核，适配器隔离**
   - Map core 不出现 `cecelia`、`zenithjoy`、`F1`、`G1` 等领域硬编码。
   - 每个仓只通过 repo adapter 提供事实；每个业务域只通过 manifest 提供语义。

7. **统一读入口**
   - Dashboard、AI、CI、后续 Notion 投影只读 Unified Map API。
   - 禁止新消费者自行 JOIN 五六张旧表拼出另一张地图。

---

## 四、范围

### 4.1 本期必须完成

1. Versioned Map Manifest 的 schema、验证、版本与激活机制。
2. 通用 Fact Snapshot Pool：代码边、API、DB schema、测试、执行回执及 freshness。
3. Deterministic Map Projector：从 manifest 与 facts 生成统一节点/边投影。
4. Anchor Resolver：把代码、测试、API、DB 与 Capability/Feature/Acceptance Criterion 连接。
5. Query-time State Resolver：现算 `green/red/gray/unknown/not_applicable`。
6. Unified Map API：整图、节点详情、影响半径、健康度与重建入口。
7. Dashboard Map 页面：显示 Value Stream、Capability、Boundary、Cross-cut、共享前置与状态。
8. Cecelia 最新 2×11×2×7 地图的一次输入与真实投影迁移。
9. 接入 `zenithjoy-workspace` 作为第二个真实 repo/scope，证明没有做成 Cecelia 专用代码。
10. 旧读面的兼容期与收权：军师台切到 Map API，旧接口不再拥有地图解释权。

### 4.2 本期不做

- 不让 AI 从代码自行发明 Value Stream 或 Capability。
- 不做可拖拽编辑器；地图编辑通过 manifest 版本变更完成。
- 不做三维画布、动画或复杂布局算法；先交付信息正确、可下钻的二维拓扑视图。
- 不把 Notion、Markdown、Excel 设为真相源；它们只能是消费者投影。
- 不用名称正则作为正式归属规则。
- 不物理删除旧业务表；先完成兼容投影和消费者迁移，再另立清理任务。
- 不在本项目重写 dependency-cruiser 或现有 registry scanner。

---

## 五、核心数据合同

### 5.1 Versioned Map Manifest

新增 `map_manifest_versions`，每行是一份不可变、可审计的完整业务意图：

```text
id                  uuid
scope_key           text              # 例如 cecelia / zenithjoy
version             integer
source_decision_id  uuid FK decisions # 用户拍板留痕
manifest            jsonb             # 通过 JSON Schema 校验的完整输入
digest              text              # canonical JSON SHA-256
status              text              # draft / active / superseded / rejected
created_at          timestamptz
activated_at        timestamptz
```

约束：

- 同一 `scope_key` 最多一份 active manifest。
- manifest 激活与 source decision 绑定在同一事务完成。
- manifest 不允许局部 PATCH；任何变化产生新 version。
- 重复提交相同 digest 必须幂等，不新增版本。
- active 变化触发 projector；失败时旧 active projection 保持可读，同时健康度报红。

Manifest 必须表达：

```json
{
  "scope_key": "cecelia",
  "schema_version": 1,
  "value_streams": [],
  "capabilities": [],
  "boundaries": [],
  "crosscut_pool": [],
  "shared_prerequisites": { "applicable": false, "items": [], "reason": "..." }
}
```

所有实体使用稳定 `key`，名称可变化但 key 不变。引用只能用 key，禁止用展示名关联。

### 5.2 Fact Snapshot Pool

复用现有事实表，不复制源码事实：

- `graph_edges`：import / spawn / http 等关系边。
- `api_registry`：API 路由事实。
- `db_schema_registry`：数据库结构事实。
- `test_registry`：测试事实。
- `journey_assertion_receipts`：与 assertion revision 绑定的执行证据。
- Git provider：当前 repo SHA、文件存在性、PR changed files。

每个 snapshot 必须携带：`repo`、`source_revision`、`scanned_at`、scanner version。现有表缺字段时
以 additive migration 补齐；禁止从文件 mtime 猜 revision。

扫描触发：

- repo main SHA 变化后分钟级重拍；
- 每日全量重拍兜底；
- manifest 激活后立即检查所需 repo freshness；
- 扫描失败不清空上一份照片，但 Map 健康度必须显示 stale/failed。

### 5.3 Rebuildable Projection Pool

新增三张派生表：

1. `map_projection_runs`
   - 记录 `scope_key / manifest_digest / fact_revisions / projector_version / status / error / created_at`。
2. `map_projection_nodes`
   - 节点类型：`value_stream / capability / crosscut / prerequisite / backbone /
     feature / artifact / assertion`。
   - 保存稳定 key、展示字段、source refs 和非权威 attributes。
3. `map_projection_edges`
   - 边类型：`contains / hands_off_to / serves / requires / precedes / implements /
     proves / affects / owned_by`。
   - Boundary 是带稳定 `edge_key` 和声明 attributes 的 `hands_off_to` 边，不重复建 Boundary 节点。

投影表只写稳定引用与派生结构，不复制源码正文、测试正文或决策正文。任何 projection run 必须在
单事务内写完整节点和边，再原子切换 active run；读者不得看到半张图。

### 5.4 锚点来源

锚点不是另开一张人工登记表，而是从生产流程中自然产生：

1. `tasks.payload.anchor` 与已签 Golden Path contract。
2. PR 的 GP-Anchor 声明。
3. `journey_features.unit_test_path / workflow_ref / guard_ref` 存量锚。
4. `test_registry`、smoke allowlist、DoD/Test Contract 的机器可读引用。
5. API 与 DB schema registry 中的稳定标识。
6. assertion receipt 中绑定的 source revision。

确定性命中失败时，节点保持 `unclaimed/gray`；AI 候选进入独立 proposal 流程，不污染 active map。

---

## 六、投影与现算规则

### 6.1 结构投影

Projector 对每个 active manifest：

1. 校验稳定 key、引用完整性、无环约束及 schema。
2. 生成 Value Stream → Capability 的 `contains` 边。
3. 生成 Boundary 的 `hands_off_to` 边及双方声明。
4. 生成 Cross-cut → Value Stream/Capability 的 `serves` 边。
5. 生成 Shared Prerequisite 的 `requires` 边；`applicable=false` 时不造伪节点。
6. 从旧业务账本及锚点来源解析 Backbone/Feature/Assertion。
7. 从事实池匹配 Artifact 节点，生成 `implements/proves/affects` 边。
8. 输出 canonical projection digest；同输入必须得到同 digest。

### 6.2 状态现算

统一状态枚举：

| 状态 | 确定性判据 |
|---|---|
| `green` | 锚点目标存在，事实源新鲜，当前 source revision 有有效 PASS receipt |
| `red` | 锚点目标存在，事实源新鲜，当前 source revision 最近有效 receipt 为 FAIL |
| `gray` | 没有已批准锚点、锚点提案尚未批准，或新鲜事实已证明锚点目标不存在 |
| `unknown` | 扫描陈旧、repo revision 不可得、receipt 与当前 revision 不一致、关键数据源失败 |
| `not_applicable` | Manifest 明确声明不适用且带 reason |

聚合规则：

- Capability：任一必需子项 red → red；无 red 但有 unknown → unknown；必需子项全 green → green；
  其余 gray。
- Value Stream：按其 Capability 使用同一 fail-closed 聚合。
- Boundary：交接两端断言均 green 才 green；任一端 red 则 red；证据不全则 gray/unknown。
- Cross-cut：自身守卫状态与 serves 的影响范围分开返回；塌陷时 API 必须列出受影响节点。
- 任何旧 `cell_status=green` 在没有当前 receipt 时不得贡献 green。

### 6.3 Freshness budget

- repo graph / API / DB schema / test snapshot：默认 15 分钟；每日兜底仅用于恢复，不改变读面预算。
- CI/assertion receipt：必须绑定当前被查询 revision；不以“最近 N 小时”代替 SHA 对齐。
- 超预算统一 `unknown`，并返回 `reason_code`、`last_success_at`、`source_revision`。

---

## 七、统一 API

### 写入口

- `POST /api/brain/map/manifests/validate`：纯校验，不写库。
- `POST /api/brain/map/manifests`：提交完整 manifest draft，要求 `source_decision_id`。
- `POST /api/brain/map/manifests/:id/activate`：原子激活并触发 projector。
- `POST /api/brain/map/rebuild`：基于当前 active manifest 与最新 facts 幂等重建。

不存在 Value Stream、Capability、Boundary、Cross-cut 的独立创建端点，防止退回逐项登记。

### 读入口

- `GET /api/brain/map?scope=cecelia`：整张图、现算状态、source revisions、freshness、digest。
- `GET /api/brain/map/nodes/:key?scope=...`：节点详情、上下游、锚点、证据、受影响范围。
- `POST /api/brain/map/radius`：输入 repo + changed files，返回受影响业务节点与必跑断言。
- `GET /api/brain/map/health?scope=...`：manifest、facts、projection、state resolver 四层健康度。
- `GET /api/brain/map/unclaimed?scope=...`：图中有实现事实但尚无业务归属的 artifacts。

所有响应必须携带：

```json
{
  "scope_key": "cecelia",
  "manifest_version": 1,
  "manifest_digest": "...",
  "projection_digest": "...",
  "fact_revisions": { "cecelia": "git-sha" },
  "generated_at": "...",
  "freshness": { "status": "fresh" }
}
```

---

## 八、Dashboard 产品形态

在现有军师台增加统一 Map 入口，数据只来自 Unified Map API。

### Level 1：全局地图

- Value Stream 为一级泳道。
- Capability 按业务顺序排列在泳道内。
- Boundary 显示为两个 Capability 之间的带文字交接边。
- Cross-cut 独立横跨相关泳道，禁止伪装成 Capability。
- Shared Prerequisite 单独显示；不适用时显示“不适用”及原因，不造空卡片。
- 每个节点显示现算状态以及 freshness，而非数据库历史颜色。

### Level 2：Capability 下钻

- Backbone、Feature/Enabler、Acceptance Criteria。
- 对应代码/API/DB/测试锚点。
- 最近有效 receipt 与绑定 revision。
- 上下游、Boundary、Cross-cut、修改影响半径。

### Level 3：证据下钻

- assertion ref、source revision、最近运行、PASS/FAIL、失败原因。
- 对 unknown 必须明确指出是 snapshot stale、revision mismatch 还是数据源失败。

页面不提供直接编辑颜色或逐项登记按钮。

---

## 九、Cecelia 首个真实 Manifest

首验必须使用决策 `4bc109e9-3b70-4b17-a1b4-bcd01bfae776`，结构要求如下：

以下 JSON 是首验 manifest 的冻结输入；执行者只允许补 schema 要求的机械字段，不得改变节点数、
归属、边界声明、横切件或共享前置结论：

```json
{
  "scope_key": "cecelia",
  "schema_version": 1,
  "source_decision_id": "4bc109e9-3b70-4b17-a1b4-bcd01bfae776",
  "value_streams": [
    { "key": "factory", "name": "工厂", "perceiver": "待造软件", "order": 1 },
    { "key": "butler", "name": "管家", "perceiver": "主理人本人", "order": 2 }
  ],
  "capabilities": [
    { "key": "F0", "name": "提案打磨", "value_stream_key": "factory", "order": 1 },
    { "key": "F1", "name": "开发闭环", "value_stream_key": "factory", "order": 2 },
    { "key": "F2", "name": "部署闭环", "value_stream_key": "factory", "order": 3 },
    { "key": "F3", "name": "夜间体检", "value_stream_key": "factory", "order": 4 },
    { "key": "F4", "name": "故障自愈", "value_stream_key": "factory", "order": 5 },
    { "key": "MJ5", "name": "承诺地图", "value_stream_key": "factory", "order": 6 },
    { "key": "G1", "name": "指挥舱", "value_stream_key": "butler", "order": 1, "aliases": ["F5"] },
    { "key": "G2", "name": "收件箱", "value_stream_key": "butler", "order": 2, "aliases": ["F6"] },
    { "key": "G3", "name": "晨报感知", "value_stream_key": "butler", "order": 3 },
    { "key": "G4", "name": "记忆知识", "value_stream_key": "butler", "order": 4, "aliases": ["F7"] },
    { "key": "G5", "name": "战略 OKR", "value_stream_key": "butler", "order": 5 }
  ],
  "boundaries": [
    {
      "key": "F0_TO_G1",
      "from": "F0",
      "to": "G1",
      "statement": "提案备好呈报是 F0 终点；拍板动作归 G1"
    },
    {
      "key": "F3_TO_G3",
      "from": "F3",
      "to": "G3",
      "statement": "体检报告落账本是 F3 终点；主理人一屏消费是 G3 终点"
    }
  ],
  "crosscut_pool": [
    { "key": "heartbeat_bus", "name": "心跳传送带", "serves": ["factory", "butler"] },
    { "key": "credential_chain", "name": "凭据链", "serves": ["factory", "butler"] },
    { "key": "execution_pool", "name": "执行资源池", "aliases": ["infrastructure", "F8"], "serves": ["factory", "butler"] },
    { "key": "skill_distribution", "name": "Skill 分发链", "owner": "F1", "serves": ["factory", "butler"] },
    { "key": "alert_chain", "name": "告警链", "owner": "F4", "serves": ["factory", "butler"] },
    { "key": "database_foundation", "name": "数据库", "owner": "F1", "serves": ["factory", "butler"] },
    { "key": "network_foundation", "name": "网络", "owner": "F1", "serves": ["factory", "butler"] }
  ],
  "shared_prerequisites": {
    "applicable": false,
    "items": [],
    "reason": "工厂与管家的感知者分别为待造软件和主理人本人，不存在客户产品线式一次性入场语义"
  }
}
```

### 9.1 Value Streams 与 Capabilities

```text
factory（工厂；感知者=待造软件）
  F0  提案打磨
  F1  开发闭环
  F2  部署闭环
  F3  夜间体检
  F4  故障自愈
  MJ5 承诺地图

butler（管家；感知者=主理人本人）
  G1 指挥舱
  G2 收件箱
  G3 晨报感知
  G4 记忆知识
  G5 战略 OKR
```

断言：精确生成 2 个 Value Stream、11 个 Capability；原 F5/F6/F7 只能作为 G1/G2/G4 的
历史别名，不得生成重复节点；F8 不是 Capability。

### 9.2 Boundaries

1. `F0 → G1`：提案备好呈报是 F0 终点；拍板动作归 G1。
2. `F3 → G3`：体检报告落账本是 F3 终点；主理人一屏消费是 G3 终点。

断言：精确生成 2 条 Boundary，不得只把文字塞进 description，必须成为可查询边。

### 9.3 Cross-cut Pool

```text
heartbeat_bus       心跳传送带
credential_chain    凭据链
execution_pool      执行资源池（原 infrastructure / F8）
skill_distribution  Skill 分发链，owned_by=F1
alert_chain         告警链，owned_by=F4
database_foundation 数据库，owned_by=F1
network_foundation  网络，owned_by=F1
```

七项均服务 factory 与 butler 两条价值流；投影器据此扩展影响范围，但不得把它们计入
Capability 数。未在决策中明确主管 Capability 的前三项不生成虚假 `owned_by` 边，保留
`owner_state=unassigned`，不影响 `serves` 边生成。

### 9.4 Shared Prerequisite

```json
{
  "applicable": false,
  "items": [],
  "reason": "工厂与管家的感知者分别为待造软件和主理人本人，不存在客户产品线式一次性入场语义"
}
```

---

## 十、兼容迁移与收权

1. 首次 manifest 激活后，由旧 API 的 route adapter 对已迁移 scope 读取 active projection；禁止把
   projection 再逐行复制回 `journeys/golden_paths`。
2. 旧 F0-F7/MJ5 ID 通过稳定 alias 解析到新节点，关系可追溯；不得直接删除历史外键引用。
3. 军师台先切 Unified Map API，再取消旧表对地图语义的权威地位。
4. `cell_status` 写路径进入 deprecation：
   - 第一期仍允许旧 evaluator 写 receipt 与兼容状态；
   - 新 Map API 完全忽略其权威颜色；
   - 消费者迁移完成后，另立任务移除状态写回。
5. `capability-mapper` 改为 Manifest Authoring Assistant：只生成/修订完整 manifest 草案，
   不再逐表登记、不再直接定义红绿。
6. `acceptance_catalog` 保持 ZenithJoy 验收目录兼容用途，不作为 Universal Map 投影池。

---

## 十一、失败处理与可观测性

- Manifest 校验失败：返回全部结构错误，不创建 active version。
- Projector 失败：整次 run 回滚，旧 active projection 继续服务，Map health=red。
- Fact scan 失败：保留上一快照，相关状态转 unknown，记录 scanner error 与时间。
- Anchor 歧义：禁止任取一个；输出 `ambiguous_anchor`，节点 gray，并列候选。
- Receipt revision 不匹配：状态 unknown，禁止沿用旧 PASS。
- Projection digest 不一致：CI 红；相同输入重复重建必须得到相同 digest。
- 任何 API 都不得在 stale 时静默返回 green。

必须提供指标：

- `map_manifest_active{scope}`
- `map_projection_last_success_timestamp{scope}`
- `map_projection_duration_ms{scope}`
- `map_fact_freshness_seconds{repo,type}`
- `map_unclaimed_artifacts{scope,repo}`
- `map_ambiguous_anchors{scope}`
- `map_state_nodes{scope,state}`

---

## 十二、实施拆刀与依赖顺序

### 刀 0：事实池恢复与 freshness 真验火

- 修复 cron Node PATH，恢复四扫描器。
- snapshot 增加 source revision/scanner version 所需字段。
- 证明 main SHA 变化后分钟级重拍成功；失败时 API 返回 stale/unknown。

### 刀 1：Manifest 合同与版本化

- migration、JSON Schema、validate/submit/activate API。
- 写入 Cecelia 首验 manifest draft，暂不切消费者。

### 刀 2：Projection Core

- projection runs/nodes/edges。
- 原子构建、digest、稳定 ID、Boundary/Cross-cut 规则。
- Cecelia 2×11×2×7 结构验收。

### 刀 3：Anchor + State Resolver

- 接现有 graph/registry/receipt。
- 红绿灰未知现算、revision 对齐、影响半径。
- 删除测试→灰、当前 revision FAIL→红、事实陈旧→unknown 三个 proven-to-fire 演习。

### 刀 4：Unified Map API + 军师台

- 五个读端点与健康端点。
- 军师台三层下钻，旧接口收权。

### 刀 5：通用性验收与制度接线

- 接 `zenithjoy-workspace` 作为第二个真实 repo/scope；复用其现有
  `product-map/product-map.yaml` 作为 manifest adapter 输入，不新增第二份分类文件。
- Harness Planner/Proposer、CI Island Gate 改读 Unified Map API。
- capability-mapper 改为完整 manifest 草案入口。

每刀独立 PR、独立回归测试、独立真实产出验收；刀 0 → 1 → 2 → 3 → 4 串行，刀 5 在刀 3
之后可与刀 4 并行。

---

## 十三、最终验收标准

### A. 一次输入生成整图

- 通过一个完整 manifest 激活请求产生 Cecelia 全图。
- DB/API 精确返回：2 Value Streams、11 Capabilities、2 Boundaries、7 Cross-cuts、
  Shared Prerequisite applicable=false。
- 验证过程中没有任何逐节点创建调用。

### B. 投影可重建

- 清空 projection nodes/edges，在相同 manifest digest 与 fact revisions 上重建。
- 前后 projection digest 完全一致；旧真相源不受影响。

### C. 状态确实现算

- 测试存在且当前 revision receipt PASS → green。
- 删除或改名该测试并完成事实重扫 → 同一节点变 gray，不写颜色。
- 当前 revision receipt FAIL → red。
- 把 snapshot 推入超预算状态 → unknown，且 API 不返回 green。

### D. 边界与横切可查询

- 查询 F0 返回其到 G1 的边界声明。
- 查询 F3 返回其到 G3 的边界声明。
- 查询任一横切件返回 factory/butler 影响范围；横切件故障 radius 不为空。
- Dashboard 中横切件不计入 11 个 Capability。

### E. 通用性

- 同一 Projector 在 `zenithjoy-workspace` repo/scope 上运行，核心代码零领域硬编码。
- 新 scope 只提供 manifest + repo adapter 配置，不新增专用 route/component。

### F. 可视化真实效果

- 通过浏览器实际打开 Map 页面并逐层下钻。
- 页面显示 manifest version、projection digest、repo SHA、freshness 与现算状态。
- API 数量、DB projection 数量、页面数量三者一致。

### G. 回归与门禁

- 所有 bug 修复先有可复现 failing test，测试永久进入 CI。
- Brain 代码改动遵守 DevGate、版本同步与真实 PostgreSQL integration test 要求。
- CI 全绿；生产部署后用真实数据库、真实 API 和真实页面完成验收。

---

## 十四、执行者启动指令

新 session 启动后：

1. 读取本 PRD、`docs/handoffs/202607181100-info-logic-rebuild.md`、
   `docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md`、
   `docs/superpowers/specs/2026-07-18-graph-query-api-design.md`。
2. 读取 decisions：`4bc109e9`、`d533e634`、`af3a5374`，不得凭摘要重造架构。
3. 先跑 Brain 三项 DevGate；失败先修门禁问题。
4. 按刀 0 开始，先证明事实池恢复新鲜，再写 Projector。
5. 不得以补 2×11 的数据库行冒充项目完成；Final 必须通过第十三节全部验收。

项目完成的判据不是“表里有数据”，而是：**业务意图输入一次后，代码现实持续自动流入，任意
消费者查询同一 Map API 都看到同一张、可追溯、不会腐烂的当前地图。**
