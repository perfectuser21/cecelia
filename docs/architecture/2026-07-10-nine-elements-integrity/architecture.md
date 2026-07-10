# Architecture: 九要素完备化——账本通电 + 保鲜守卫 + 两轴衔接

日期：2026-07-10
状态：设计稿（/architect Mode 2 产出，待主理人批准后 Tasks 进队列）
上游决策：27b57469（八要素+五层验证阶梯）/ 06f78c9a（九要素存储：1新表+1加列+2复用）/
e035dad8（判定点显性化）/ 69b90b1d（推进项账本）/ 9c926114（A-1 Context Manifest）
关联架构：docs/architecture/2026-07-10-executor-liveness-contract/（执行者活性合同，平行推进不冲突）

## 概述

九要素（FR/NFR/Invariant/判定点/保质期/死亡告警/失败语义/效果确认/输入对抗面）的
**库骨架 07-06 后已建齐，但四处空转**：golden_path 0 行（累积 FR 断线）、judgment 0 条
（判定点模板未落）、action_receipts 无 collector（回执没人核销）、review_after 无月度扫描。
同时审计发现两个系统级缺口不在九要素内：**账本保鲜**（"该写的没写"无人报警——僵尸文档化
是整套体系最大风险）与**两轴衔接**（OKR 侧够不着 ability，季度意志无法对账成资产）。

本 Initiative 一次性把"9 个要素通电 + 2 个系统级要素补位"做完，共 6 个串行 Task（5 个
brain PR + 1 个 zenithjoy-skills PR）。核心原则延续 06f78c9a：**禁建平行表，能复用不新建**。

## 数据模型变更

| 变更 | 表 | 内容 | Task |
|---|---|---|---|
| 无新表 | — | 账本保鲜分数写 `design_docs(type='ledger_hygiene')`，复用现有表 | T1 |
| 无 migration | `key_results.metadata` | JSONB 内约定 `target_abilities: [ability_id,...]`（轻边起步，验证有用后再转正式列） | T6 |
| 无新表 | `golden_path` | 不改结构，接通写入方 | T2 |

## 关键决策

| 决策 | 选项A | 选项B | 选择 | 理由 |
|---|---|---|---|---|
| 保鲜守卫形态 | 独立巡检 skill（类 ci-patrol） | Brain tick job + 棘轮 | **B** | 卫生指标全是 SQL 可算的，不需要 LLM 探索；tick job 零调度成本，棘轮数值进 design_docs 可被晨报/军师消费 |
| golden_path 写入点 | harness-report skill 里 curl | Brain callback-processor 在 harness 任务终态(merged)时调 promoteToRegression | **B** | skill 靠自觉会重蹈"写入方挂死图"覆辙；callback 是终态唯一收口（07-10 刚做完韧性加固），代码级保证 |
| 累积 FR 读写 key | 保持 tasks.ability_id join | 读端改走 golden_path.feature_id 直连 | **B** | 写端已写 feature_id（真 FK），读端绕道 tasks.ability_id 是历史错位；对齐后少一次 join 且不依赖 tasks 挂 ability 的卫生 |
| 两轴衔接边 | key_results 加正式列 + migration | metadata JSONB 约定 key | **B（起步）** | 零 migration 零风险先验证"decomp 拆解时写、季度末对账"是否真的被使用；用起来了再转正 |
| 判定点落点 | Brain 强制校验合同段 | skill 模板 + reviewer 审查项 | **B** | 判定点是语义内容，机械闸验不了质量；e035dad8 原案即模板刀，reviewer 打回是既有 GAN 肌肉 |
| 注入扩容幅度 | 4000→32000 一步到位 | 4000→12000 + planner 接 line_ledger 蒸馏 | **B** | 真实账本现在 1.2 万字符，12000 已覆盖 3 倍余量；长期靠蒸馏层保持注入体积为常数，不靠无限放大上限 |

## 模块变更

| 模块 | 变更 | 说明 | Task |
|---|---|---|---|
| `packages/brain/src/ledger-hygiene.js` | 新建 | 每晚（line-dreaming 后）算 5 项卫生指标 + 棘轮比较 + 降分开 issue | T1 |
| `packages/brain/src/tick-runner.js` | 修改 | 注册 runLedgerHygieneIfNeeded | T1 |
| `packages/brain/src/callback-processor.js` | 修改 | harness 任务 completed 且 pr_merged → 调 promoteToRegression（fail-open，失败只 warn） | T2 |
| `packages/brain/src/harness-line-context.js` | 修改 | 累积 FR SQL 改走 golden_path.feature_id；PROMPT_MAX_LEN=12000、MAX_FR_ABILITIES=50 | T2/T3 |
| `packages/brain/src/routes/warroom.js` | 修改 | 新端点 GET /line/:id/context-manifest（含最新 line_ledger 摘要 + 增量事实，供 planner Step 0.4 一次拉全） | T3 |
| `packages/brain/src/notifier.js` + `feishu.js` + deploy webhook | 修改 | 对外动作三入口发送后写 action_receipts(pending) | T4 |
| `packages/brain/src/receipt-collector.js` | 新建 | tick job：核销 confirmed/failed，超时标 timeout；未确认段喂给 battle-report | T4 |
| `packages/brain/src/battle-report*.js` | 修改 | 战报加"未确认动作"段（与 T6 军师决策节同文件族，注意与进行中的 88e0b448 PR 合并顺序） | T4 |
| zenithjoy-skills：harness-contract-proposer / reviewer / dev | 修改（独立 repo PR） | 合同模板加「判定点登记表」段（候选方法/所选/依据/误判后果），reviewer 加审查项；判定点写 decisions category=judgment | T5 |
| decomp skill + `packages/brain/src/routes/okr.js` | 修改 | decomp 拆 KR 时写 metadata.target_abilities；新端点 GET /okr/kr/:id/ability-progress（join journey_features.thickness 出对账视图） | T6 |

## 账本保鲜守卫（T1）指标定义

每晚计算，存 design_docs(type='ledger_hygiene')，棘轮=每项"欠账数只许降不许升"：

1. **FR 沉淀率**：近 7 天 harness 终态(merged) run 中，golden_path 有对应行的比例
2. **归属完整率**：近 7 天新建 tasks/issues 中 journey_id 非空比例；harness 类任务 ability_id 非空比例
3. **回执核销率**：action_receipts 中 pending 超过时限未核销的数量（T4 上线后启用）
4. **知识保质期**：decisions 中 review_after < now 未复审的数量（补 06f78c9a 拍板但未建的月度扫描）
5. **判定点活性**：近 30 天新增 judgment 条数（T5 上线后启用；0 = 学习回路断电告警）

任一指标棘轮击穿 → 自动开 P2 issue（`[ledger-hygiene]` 前缀，复用 notion-create-issue 链路），
连续 3 天击穿升 P1 + Bark。

## 执行顺序与依赖

```
T1 保鲜守卫（先上——它是后面所有通电动作的验收仪表盘）
 → T2 累积 FR 通电（golden_path 写入 + 读写 key 对齐）
 → T3 注入扩容 + line_ledger 蒸馏接线（依赖 T5 dreaming 已上线 ✅）
 → T4 回执 collector（含战报未确认段）
 → T5 判定点模板（zenithjoy-skills repo，可与 T4 并行）
 → T6 两轴轻边 + 对账端点
```

## 测试策略

- T1：单测 mock pool 验 5 指标 SQL + 棘轮逻辑；smoke 脚本真查 DB 出分数
- T2：集成测试（brain-integration，真 postgres）：模拟 harness 任务 merged 回调 → 断言 golden_path 新增行；回归测试 harness-line-context 新 SQL
- T3：单测 formatLineContextForPrompt 12000 上限 + ledger 段注入；planner skill 侧 eval 验证 Step 0.4 消费新端点
- T4：单测三入口写 pending；集成测试 collector 超时状态机；smoke 验证战报未确认段渲染
- T5：skill eval（skill-creator 流程）+ 真实合同样例含判定点段
- T6：单测 metadata 写入/端点 join；manual 验证对账视图数字与 journey_features 一致

## 风险与缓解

- **T4 战报文件与 T6 指挥台 PR（88e0b448，进行中）改同一文件族** → T4 排在其后开工，rebase 消化
- **promoteToRegression 内含 yaml auto-merge PR 逻辑**（给 regression-contract.yaml 上 main）→ T2 首版只接 golden_path DB 写入（①），yaml PR（②）保持现状由 CI 侧消化，避免一次接通两个副作用
- **保鲜指标把历史欠账全算进来会导致首日即全线告警** → 基线取上线当天快照，棘轮从基线起算（与 ci-patrol 棘轮同法）
