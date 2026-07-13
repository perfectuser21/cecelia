# Design: 能力轴层级重定义（领域→子领域→Golden Path→step→feature）+ Golden Path 生命周期统一

> 主理人拍板（2026-07-13，长对话收敛）。本稿只出定义 + schema 对账待决项，不含代码改动。
> 定稿后走 /architect→decomp→dev。昨天（2026-07-12）GP-loop merge 的代码在本稿阶段一行不碰。
> 关联：`docs/architecture/2026-07-12-golden-path-mode/architecture.md`（GP-loop 原始立项）。
> 最终落点：cecelia repo `docs/superpowers/specs/`（现暂存 scratchpad，主仓有写保护，定稿走 worktree 落地）。

## 1. 问题背景

主理人反馈"Line 里 Golden Path 的分级很模糊"。三路排查确认根因**不是用词问题，是结构问题**：

1. **4~5 层现实塞进 2~3 个名字**：产品真实嵌套是 领域→子领域→能力→步骤→使能件，但系统只有 Journey / Golden Path / Step / Feature 几个名字，每次塞法不一，就每次都糊。
2. **"Golden Path" 一词四义并存**：(a) `golden_paths`(334) 方向级提案实体；(b) `golden_path`(303) 挂 Task 的 step 台账；(c) db-update 里"ability+feature 有序组合"；(d) QA/architect 里"E2E 关键链路"。
3. **L2 子领域是孤儿层**：`journey_features.group`（migration 295）有槽位，但全仓无代码消费、Notion 从不推送。
4. **L3 能力散在三张表无主**：`journey_features kind='ability'` / `abilities`(294) / `golden_paths`(334)。
5. **"FR" 名字贴错表**：`golden_path`(303) 被 GP-loop 架构文档叫"FR 台账"，但其 sprint 验收用例（`sprints/06171509-golden-path-step-nfr-decisions`）从头到尾管每行叫 "Golden Path Step"——它是 **step 表**，不是 FR。

## 2. 锁定定义：能力轴 5 层

| 层 | 命名 | 系统落点 | 例子（智能客服） |
|---|---|---|---|
| L1 | **领域** | Journey / `journeys` | 智能客服、智能获客 |
| L2 | **子领域** | Ability Group / `journey_features.group` | 微信客户沟通、社群运营 |
| L3 | **Golden Path = Ability = function** | Golden Path 主表（见 §4 归并） | 被动回复、建群 |
| L4 | **step** | `golden_path`(303，正名为 step 表) | step1 接收理解 → step2 生成回复 → step3 发送 |
| L5 | **feature（使能件）** | `journey_features kind='feature'`（经 step_id 挂 L4） | 调 LLM、套知识库、敏感词过滤 |

判据（一条 Golden Path 的边界）：**独立触发 + 独立交付一个客户可见结果 + 独立可验收**，三问全 yes。板块（L2）不满足"独立交付"，故是筐不是路。

## 3. 一条 Golden Path 的内部构造与两根轴

一条 Golden Path（= 一个 Ability = 一个 function）挂在子领域下，内部：

- **FR = 功能定义**（这个 ability 干什么）。**不单独立表/立层**（YAGNI）——就是 ability 的功能描述，落在 ability 记录 / PrePRD 上；步骤本身即功能展开。
- **steps 1..N**（L4）：有序阶段，家 = `golden_path`(303) 表（正名 step 表）。
  - 每个 step 指向一个/多个 **feature**（L5）。
  - 每个 step 可挂 **NFR 决策**：`decisions`（`category='nfr'`, `level='step'`, `target_type='golden_path'`, `target_id=<step>`），如 topic=`前后台`/decision=`后台静默`。**NFR 已存在、不用新建。**
- **thickness / maturity**（深度轴）：thin→mature，"打深 1-5→6-10" = 往 step 清单追加 step，做完一批升一档。
- **一个 E2E**：1 条 Golden Path = 1 个端到端测试 = 这个 ability 的验收。

**两根轴分清（这是"分级模糊"的解药）**：
- **广度/组成** = step 清单（这条路走哪几步、每步哪些 feature）。
- **深度/成熟度** = thickness（这条路做到多熟）。
一个记"由什么组成"，一个记"做到多熟"，不再混为一谈。

## 4. Golden Path 生命周期统一（消解"提案 vs Golden Path"之争）

**结论：不设独立"提案"实体。一张 Golden Path 表（= Ability）+ 一个状态字段。** 提议只是这条 Golden Path 处在早期状态。AI（GP-loop/direction-proposer）和主理人**都能提**（新建行为提议态）；主理人**批准 + 排序**。

用户可见状态生命周期：

```
AI提议 / 人提议 ──批准──▶ 未开始 ──▶ 进行中 ──▶ 已完成 ──▶ 已上线
   (source: ai/人)   (主理人排序 priority)
```

- `source` 字段区分 AI 提 / 人提。
- 批准 = 状态流转（提议→批准）。
- 排序 = 新增 `priority` 字段，主理人排优先级。
- "加深老 GP" = 追加 step（状态回进行中）；"开新方向" = 新建 GP（提议态）。两者都能提。

**好处**：昨天 `golden_paths`(334) 那套状态机（candidate→approved→in_dev→delivered…）**基本就是这个**，认它为 Golden Path 主表即可，不用从零建；顺手灭掉 §1.4 的三表无主问题。GP-loop 不改名、不推翻，它就是"AI 往主表提议新 GP"的自动流水线。

## 5. 与现状 schema 的差 —— 待决项（逐条带推荐）

| # | 待决项 | 推荐方案 | 影响面 |
|---|---|---|---|
| D1 | **L3 三表理顺**（⚠️调查修正见 §8，原"以 golden_paths 为主表迁行"方向反了） | **不物理迁行**：`journey_features(kind='ability')` 保留为交付/FK 锚层（tasks/advancement_items/initiative_runs 3 条硬 FK + 49 引用）；`golden_paths`(334) 只补提案态语义，用一条 FK `golden_paths.delivered_ability_id → journey_features.id` 对齐；"归一"落在读视图/Notion 层。`abilities`(294) 死表单独 DROP | 🔴高，须 /architect 定"补字段 vs 迁行" |
| D2 | **golden_paths 挂载层级**：现 `journey_id` 直连 L1，跳过 L2 | 改挂 **子领域(L2 Ability Group)**，L2 再挂 L1 | 中，改 FK + GP-loop 写入 |
| D3 | **L2 子领域激活**：group 字段是孤儿 | 把 group 提升为一等实体/维度，代码消费 + Notion 推送 | 中 |
| D4 | **`golden_path`(303) 正名 step 表**，且改挂 Golden Path 而非 Task | 正名为 step；`owner_task_id` 语义澄清（Task 是执行视图，Golden Path 是产品实体）；step→feature 支持"一 step 多 feature" | 中，动 303 语义 + 端点 |
| D5 | **状态机对齐 + priority**：334 状态机映射为用户 6 档 + 加 priority 排序字段 | 见 §4 映射；补 `已上线` 态 + `priority` 列 | 小 |
| D6 | **Notion 侧缺 L2/L3 独立库**：现 L3/L4 挤一个 Feature 库、无 L2 库、group 从不推送 | Notion 重建：领域库/子领域库/Golden Path 库分离 | 中，Notion 建模 + 同步脚本 |
| D7 | **文档/skill 事实订正**：db-update 说"abilities 表已删"但没 DROP；"FR 台账"错名；Journey/Step/Feature 措辞 | 术语裁定后批量订正 db-update / notion / harness-report / DEFINITION.md | 小，纯文档 |
| D8 | **术语撞车**：`DEFINITION.md` areas="PARA 领域"占用"领域"；journey_steps 表的"Step"；warroom"四板块" | 先定术语表；areas 的"领域"与能力轴"领域"用限定词区分（PARA 领域 vs 能力领域） | 小 |

**FR 不立层**（§3）：确认不新增 FR 表，避免与 step 再重叠。

## 6. 范围外（本轮不做）

- 不重构 GP-loop 的对抗/晨报/报备逻辑（只改"提案=Golden Path 早期状态"的定位与挂载层）。
- 不动 harness 的 per-Task 验收视图语义（D4 只澄清 step 表的产品身份，Task 仍是执行视图）。
- (c)(d) 两个 "Golden Path" 同名词（ability+feature 组合 / E2E 链路）保留为不同语境同名，不硬统一。

## 7. 后续

定稿 → 写 `decisions` 记录（能力轴 5 层 + Golden Path 生命周期）→ 立 Initiative → 按 §8 migration 拆分逐条 PR → 每条走 migration + DevGate。

## 8. 实施调查修正（2026-07-13 schema 只读调查）

**⚠️ 修正 D1 方向**：原稿"以 golden_paths 为主表、journey_features kind=ability 归并进去"**方向反了**。实证：`journey_features` 是全系统能力轴 FK 锚（`tasks.ability_id`/`advancement_items.ability_id`/`initiative_runs.ability_id` 3 条硬 FK + 49 处引用），`golden_paths`(334) 零入站 FK。迁行会砸断这些 FK（advancement_items 会 CASCADE 删）。
**正确做法**：不物理迁行——journey_features(kind=ability) 保留交付/锚层；golden_paths 只补提案态语义 + 一条 FK `delivered_ability_id → journey_features.id` 对齐；"归一"落读视图/Notion 层。此点须 /architect 阶段定"补字段 vs 迁行"。

**abilities(294) 确认死表可 DROP**：全仓零活引用（唯一入站 FK 早在 303 `DROP...CASCADE` 清掉）；`routes/abilities.js` 名叫 abilities 但全程操作 journey_features。DROP 前 `SELECT count(*)` 验 0 行即可。

**migration 拆分与顺序（风险 🟢低/🟡中/🔴高）**：

| # | migration | 依赖 | 风险 | 备注 |
|---|---|---|---|---|
| M1 | `DROP TABLE abilities`（294 死表） | 无 | 🟢 | 零引用，可立即独立做 |
| M2 | journey_features.group（L2）激活：代码消费 + Notion 建库/同步 | 无 | 🟡 | 纯新增，列已存在 |
| M3 | golden_paths 加 `priority` + `已上线` 态（D5） | 无 | 🟢 | 纯 ALTER 向后兼容 |
| M4 | golden_paths.journey_id 改挂 L2（D2） | M2 | 🟡 | 写入侧 3 处：direction-proposer.js:228 / capture-triage.js:116 / golden-paths.js:56；读取侧零改。**碰 GP-loop 代码，需回归 GP-loop E2E** |
| M5 | L3 三表理顺（D1，补字段非迁行） | M4 | 🔴 | /architect 先定方案，单独 initiative |

**会碰昨天 GP-loop merge 的点**（M4/M5）：direction-proposer.js、capture-triage.js、routes/golden-paths.js、334 表结构。**本轮建议不碰**（§6 范围外）：battle-report.js、gp-shelf-life.js、状态机流转、dashboard ReportDetailPage——它们只按 status 读，M1~M4 对其透明。

**推荐执行**：M1+M2+M3（互不依赖、低风险，先落）→ M4（中风险、碰 GP-loop 写入侧）→ M5（架构阶段定方案再拆，最高风险）。
