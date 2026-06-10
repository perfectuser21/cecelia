# 设计文档：双轴工作模型 + Initiative 合一 + 层级时间模型

- 日期：2026-06-10
- 状态：设计待评审（第 2 版，整篇重写）
- 触发起点：用户要"定义 ZenithJoy 的 OKR"，挖掘中发现数据模型存在多套半建/重复/断裂的层级结构，遂重定义为数据模型治理。
- 范围：Brain DB schema + Brain 上卷/盖戳逻辑 + 调度（decomp/harness）接线。**不含**本轮 OKR 内容定义（见"不在范围内"）。

> 注：本版推翻了第 1 版的两个错误结论——① 误把 Ability/Feature 当成 Notion Task（实为能力台账，与 Task 是两套）；② 误把 okr_projects/okr_initiatives 当"死树"要退役（实为执行轴 Project/Initiative 层，只是没接线）。

---

## 1. 背景：挖掘出的三个真实缺陷（均有 SQL 证据）

### 缺陷 A — Ability 与 Task 被混为一谈，其实是两套系统
- **Ability/Feature = 能力台账**：描述两个 repo/area "具备什么能力"。DB：`journey_features`（kind=ability 22 / feature 68）。是记录表，不是活儿。
- **Task = GTD 活儿**：描述"我要去实现某个 ability"。DB：`tasks`（9603）。
- 现状：`tasks` **没有任何列**指向"它在实现哪个 ability"——两套之间的连接边不存在。

### 缺陷 B — "Initiative" 裂成两个，规划侧与执行侧从未接上
| | `okr_initiatives`(495) | `harness_initiative` 任务(227) + `initiative_runs`(149) |
|---|---|---|
| 出身 | 自顶向下·规划侧（/decomp 拆解） | 自底向上·执行侧（/harness 管道） |
| 最近写入 | 2026-05-29 | 2026-06-08（更新，仍在跑） |
| 状态 | 340 active，但 **0 个 task 挂上去**（纸面台账） | 145 failed / 45 completed（执行实况） |
| 互指 | — | 149 个 run 仅 8 个回指 okr_initiatives，137 个指向 harness_initiative 任务 |
- 根因：规划路径（decomp）与执行路径（harness）各自发明了一个 "Initiative"，中间生命周期线从未连接。

### 缺陷 C — 层级缺统一时间模型
- `objectives`/`key_results` 仅有计划日期（start_date/end_date），无实际起止；`journeys`/`journey_features` 四个时间字段全无。无法算延期 / 实际工期 / 按时启动。

---

## 2. 目标

1. 确立**双轴工作模型**：能力台账轴 + 目标/执行轴，十字交叉。
2. **Initiative 合一**：两表并一表，一条生命周期线（planned→running→done）。
3. **去掉 Scope 层**：执行轴收敛为 3 层 Project→Initiative→Task。
4. **补两条断边**：Task→实现→Ability（十字）；Task→Initiative（执行轴下接）。
5. **铺统一时间模型**（计划/实际/预测），任一层可算延期与工期。
6. 不引入新的并行表；以连接、合并、折叠现有表为主。

---

## 3. 双轴工作模型

```
                              Area (areas, 19)
            ┌───────────────────────┴───────────────────────────┐
   【能力轴 · 台账"有什么"】                     【目标/执行轴 · GTD"在做什么"】
   Line / Sub-Area (journeys, 21)                Objective (objectives, 28)
        └ Ability Group = group 字段                 └ Key Result (key_results, 38)
           └ Ability/Feature                            └ Project (okr_projects, 217)
             (journey_features, 90)                        └ Initiative = Harness（合一）
                   ▲                                          └ Run/Sprint (initiative_runs, 149)
                   │                                          └ Task (tasks, 9603)
                   └──────── Task 实现 Ability ──────────────────┘
                            (tasks.ability_id，新增的十字边)
```

- **能力轴**（描述性台账）：`Area → Line/Sub-Area → Ability/Feature`。记录已具备/在建的能力。
  - L3 "Ability Group" 由 `journey_features.group` 字段聚合（与执行轴的 Project 是**不同概念**，勿混：Ability Group 聚合相关能力，Project 是 KR 下的执行项目）。
- **目标/执行轴**（GTD）：`Area → Objective → KR → Project → Initiative(=Harness) → Task`。
- **十字边**：`Task 实现 Ability`——一条 GTD 活儿推进台账上的某项能力。

### 边清单：已连 vs 待动

| 边 | 现状 | 动作 |
|----|------|------|
| areas ← objectives (area_id) | ✅ 存在 | 回填孤儿（28 中仅 9 挂 area） |
| objectives ← key_results (objective_id) | ✅ 存在 | — |
| key_results ← okr_projects (kr_id) | ✅ 存在 | — |
| areas ← journeys (area_id) | ✅ 存在 | 回填孤儿（21 中仅 2 挂 area） |
| journeys ← journey_features (journey_id) | ✅ 存在 | — |
| okr_projects ← Scope ← Initiative | ⚠️ 经 okr_scopes 中转 | **折叠 Scope**：Initiative 直挂 Project |
| Initiative（两表） | ❌ 裂成两个 | **合一**（见 §4） |
| tasks ← Initiative | ❌ okr_initiative_id 全空 | 改挂合一后的 Initiative |
| **tasks → Ability** | ❌ 不存在 | **新增 `tasks.ability_id` → journey_features** |

---

## 4. Initiative 合一（一张表，一条生命周期线）

一个 Initiative 的正常一生：

```
/decomp 拆出 →【planned】→ 排期【queued】→ harness 认领开跑【running】→【done / failed】
```

- 现状把前半截（planned/queued）放 `okr_initiatives`、后半截（running/done）放 `harness_initiative` 任务，中间断开 → 340 个永远 active 却没人执行。
- **合一方案**：以 `okr_initiatives` 为底，清洗后改名 `initiatives`（或在其上加生命周期状态机）；
  - 加 `project_id → okr_projects`（折叠 Scope 后直挂 Project）；
  - 加完整生命周期 `status`：planned/queued/running/done/failed；
  - **harness 不再 mint 新的 harness_initiative 任务**，改为**认领一个已存在的 planned initiative**，把它推进到 running，并在其下创建 `initiative_runs`（Run/Sprint）；
  - 历史 `harness_initiative` 任务（227）迁入新表对应行，`initiative_runs.initiative_id` 重指向。
- 迁移机制（哪表为底、数据搬运、双跑兼容期）在 writing-plans 阶段细化。

---

## 5. 去掉 Scope 层

- 用户模型为 3 层 `Project → Initiative → Task`，无 Scope。
- `okr_scopes`（144，107 active）作为 Project 与 Initiative 之间的中转层**折叠**：Initiative 改为直挂 Project；okr_scopes 归档（重命名，不硬删，保留历史）。

---

## 6. 时间模型（统一 5 字段）

| 字段 | 语义 | 谁填 |
|------|------|------|
| `planned_start_at` | 计划开始 | 人 |
| `planned_end_at` | 计划结束 / deadline | 人 |
| `actual_start_at` | 实际开始 | 系统自动盖戳 |
| `actual_end_at` | 实际结束 | 系统自动盖戳 |
| `forecast_end_at` | 预测完成日（仅 OKR/KR） | 系统自动算 |

- 类型统一 `timestamptz`。
- **盖戳**：`actual_start_at` = 实体首次进入执行态（逐层上推）；`actual_end_at` = status→done。
- **forecast**（仅 Objective/KR）：每 tick 重算 = `actual_start_at + 已耗时/progress`；progress=0 回落 planned_end；`forecast_end_at > planned_end_at` → 延期预警。
- **各层字段配置**：

| 层 | 表 | 字段集 |
|----|----|--------|
| Objective / KR | objectives / key_results | 全 5 个 |
| Line / Ability·Feature | journeys / journey_features | 4 个（能力轴也要算交付节奏） |
| Project | okr_projects | 4 个 |
| Initiative | initiatives（合一后） | 4 个 |
| Run | initiative_runs | 现有 3 个（deadline/started/completed）→ 视图映射 |
| Task | tasks | 现有 planned+actual → 视图映射，**物理列不动** |

---

## 7. 统一视图 work_nodes + 自动上卷（档位 B，不物理合并）

- **不**把所有层合成单一物理表（tasks 85 列 9603 行的执行机器不能与 28 行 objectives 挤一张表）。
- 建 `work_nodes` 视图：把各层 UNION 成统一查询面，列归一为
  `id, axis(capability|execution), node_type, parent_id, title, status, progress, planned_start_at, planned_end_at, actual_start_at, actual_end_at, forecast_end_at`。
  - 命名在**视图层归一**：`tasks.due_at`/`initiative_runs.deadline_at` 等 `AS planned_end_at`，**物理列不改名**。
- 物理重命名只在小表（objectives/key_results/journeys/journey_features/okr_projects）做；tasks/initiative_runs 物理列保持原样，仅视图映射。
- **上卷规则**（Brain tick，对 NULL 安全）：
  - 执行轴：Project ← 其 Initiative；Initiative ← 其 Run/Task；`actual_start=min(子)`、`actual_end=max(子，全完成才填)`、`progress=子加权`。
  - 目标轴：KR ← 服务它的 Project / 经十字边的交付；Objective ← 其 KR。
  - 能力轴：Line ← 其 Ability/Feature。
  - 各轴独立计算，互不干扰。

---

## 8. 迁移分期（migration 起始号 296）

- **Phase 1 — 双轴接线（高价值，独立可上）**
  - 新增 `tasks.ability_id`（FK→journey_features，nullable，十字边）；回填孤儿 area_id；折叠 Scope（Initiative 直挂 Project 的准备列）。
- **Phase 2 — Initiative 合一**
  - 建/改 `initiatives` 表（生命周期状态机 + project_id）；迁移 okr_initiatives + harness_initiative 数据；改 harness 调度为"认领 planned"；`initiative_runs`/`tasks` 重指向；归档 okr_scopes。
- **Phase 3 — 时间字段 + 类型归一**
  - 各表加 5/4 个统一命名时间字段；objectives/KR 旧 start_date/end_date 迁入后删旧列。
- **Phase 4 — work_nodes 视图 + 上卷 + 盖戳 + forecast**
  - 建视图；Brain tick 加盖戳/上卷/forecast/延期预警；OKR API 返回新字段。
- **Phase 5 — 消费端**
  - Dashboard / Notion 同步映射；甘特/延期看板（前端，独立排期）。

每个 Phase 走 `/dev` + 对应 migration；Phase 1、2 可分别独立交付见效。

---

## 9. 风险

- **Initiative 合一是最重的一步**：涉及 harness 调度改造（不再 mint，改认领）+ 227 任务 + 149 run 重指向。必须双跑兼容期，灰度切换。
- **退役/折叠误删**：归档前 `grep -r okr_scopes|okr_initiatives|harness_initiative` 全仓确认引用；用重命名而非 drop，保留回滚。
- **tasks 不可动物理列**：85 列 9603 行被调度代码全引用，任何阶段不得改其时间列名或合并，违反即大面积回归。
- **过渡期空值**：新边/时间字段过渡期大量为空，所有上卷/forecast 逻辑必须 NULL 安全。
- **两个 "Project" 概念**：能力轴 Ability Group（group 字段）vs 执行轴 Project（okr_projects），文档与 UI 必须明确区分，勿重蹈 Ability=Task 的混淆。

---

## 10. 不在范围内（本轮明确推迟）

- **ZenithJoy OKR 内容定义**（具体 Objective/KR 文案与押注）：地基统一后再做。
- **档位 C（物理合并单表）**：评估后否决。
- **一个 Ability 服务多个 KR / 一个 Task 实现多个 Ability**：本轮单值，未来按需扩展。
- **前端甘特/延期看板**：Phase 5 之后独立排期。

---

## 11. 决策记录（待用户最终确认后写入 decisions 表）

1. 双轴工作模型：能力轴（Area→Line/Sub-Area→Ability/Feature 台账）+ 执行轴（Area→Objective→KR→Project→Initiative→Task GTD），十字边 Task 实现 Ability。
2. **Line = Journey = Notion Sub-Area = L2**；OKR 是执行轴，挂在 Area 下。
3. Ability/Feature 是能力台账（journey_features），与 Task（tasks）是两套，不可混。
4. Initiative 合一：okr_initiatives（规划侧）+ harness_initiative/initiative_runs（执行侧）并为一张表一条生命周期线；Harness = 执行中的 Initiative；harness 改为认领 planned initiative 而非另造。
5. 执行轴 3 层 Project→Initiative→Task，折叠 Scope（okr_scopes 归档）。
6. 新增十字边 `tasks.ability_id`。
7. 时间模型 5 字段，actual 自动盖戳，forecast 仅 OKR/KR 自动算。
8. 统一命名在 work_nodes 视图层达成，物理重命名仅限小表，tasks/initiative_runs 物理列不动（档位 B）。
