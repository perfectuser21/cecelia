# 设计：账本保鲜守卫 ledger-hygiene tick job（九要素 T1）

任务：4a47ac89-172e-46f4-a3f4-b15b1854f6a4（plan=nine-elements-integrity, seq=1）
架构依据：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md
对应 DoD：F1（每晚产出卫生分入 design_docs）、F2（棘轮击穿自动开 issue）、A3（保鲜为 tick job 非 skill）

## 目标

每晚（line-dreaming 之后、battle-report 之前）计算 5 项账本卫生指标，
落 `design_docs(type='ledger_hygiene')` 供晨报/军师消费；每项"欠账数"走棘轮
（只许降不许升），击穿自动开 `[ledger-hygiene]` P2 issue，连续 3 天击穿升 P1 + Bark。

## 组件

### 1. `packages/brain/migrations/330_design_docs_ledger_hygiene.sql`（新建）

`design_docs.type` CHECK 约束加 `'ledger_hygiene'`（先例：328 加 `line_ledger` 同法）。
零新表、golden_path 结构不动，符合 A1 精神。

### 2. `packages/brain/src/ledger-hygiene.js`（新建）

结构镜像 `line-dreaming.js`（窗口自 gate + 20h 去重 + safeRows 容错）：

- **窗口**：UTC 21:10–21:15（北京 05:10，line-dreaming 05:00 后、battle-report 06:00 前）
- **去重**：20h 内已有 `design_docs(type='ledger_hygiene')` 记录则跳过
- **5 项指标**（每项输出 `{value, debt, enabled}`；单项 SQL 失败该项 `enabled=false` 不阻断其他项）：
  1. **FR 沉淀率**：近 7 天 `tasks`（task_type='harness_initiative' AND status='completed' AND pr_merged_at IS NOT NULL）中，`golden_path.owner_task_id` 有对应行的比例；debt=无行的 run 数
  2. **归属完整率**：近 7 天新建 `tasks` 的 `payload->>'journey_id'` 非空比例、新建 `issues.journey_id` 非空比例、harness 类任务 `ability_id` 非空比例；debt=三类空归属行数之和
  3. **回执核销率**：`action_receipts` 中 `receipt_status='pending'` 且 `sent_at < NOW()-24h` 的数量（=debt）；表全空 → `enabled=false`（T4 上线后自激活）
  4. **知识保质期**：`decisions` 中 `review_after < NOW()` 的数量（=debt，补 06f78c9a 月度扫描欠账）
  5. **判定点活性**：近 30 天 `decisions(category='judgment')` 新增条数；历史一条都没有 → `enabled=false`（T5 上线后自激活）；enabled 且 30 天=0 → 视为击穿（学习回路断电）
- **棘轮状态**：存 `working_memory` key `ledger_hygiene_ratchet`
  `{baseline: {m1..m5}, last: {m1..m5}, streaks: {m1..m5}, baseline_date}`
  （scheduler 哨兵同款存储，不解析 markdown 回读）
- **基线**：首跑写快照为基线，不告警（架构风险节：历史欠账不首日全线告警）
- **击穿判定**：enabled 指标 `debt > last.debt`（首跑比 baseline）→ 击穿；streak+1，否则 streak 清零
- **告警动作**：
  - 击穿 → `INSERT INTO issues`（title 前缀 `[ledger-hygiene]`，P2，sub_area='brain'，
    body 含指标名/昨日值/今日值；每指标每日最多一条，凭当日 issue title 去重）
  - streak ≥ 3 → issue 升 P1 + `notifier.sendBark`
- **落库**：markdown 分数卡（5 指标表格 + 击穿列表）upsert 进 `design_docs(type='ledger_hygiene', title='账本卫生分 YYYY-MM-DD')`

### 3. `packages/brain/src/scheduler-jobs.js`（修改）

JOBS 注册表加一行：`{ name: 'ledger-hygiene', needsPool: true, handler: maybeRunLedgerHygiene, description: '账本保鲜守卫（北京05:10窗口+20h去重，5指标+棘轮）' }`

> 架构文档写的"tick-runner.js 注册"在当前代码中的实际注册通道即 scheduler-jobs.js JOBS
> 表（Wave 2 后定时 job 的唯一恢复通道，line-dreaming/battle-report 同位）。

### 4. `packages/brain/scripts/smoke-ledger-hygiene.mjs`（新建）

真连 DB 跑一遍 5 指标 SQL 输出分数（不写库、不走窗口 gate），部署后人工/守卫可验。

## 错误处理

- 单指标 SQL 失败 → 该指标 `enabled=false` 记入文档"指标不可用"段，不抛出
- issues/Bark 写入失败 → console.warn，不阻断落库（与 test-lifecycle-patrol 同法）
- 整个 job 由 scheduler-jobs 错误隔离 + 5min timeout 兜底

## 测试策略（integration 档）

- **单测**（mock pool，镜像 line-dreaming.test.js）：
  - 窗口 gate：非窗口不执行；窗口内执行
  - 5 指标 SQL 形状与聚合（mock rows → 断言 value/debt）
  - 棘轮：首跑建基线不告警 / debt 上升击穿开 issue / debt 下降 streak 清零 / streak=3 升 P1+Bark
  - 指标自激活：action_receipts 空表 → m3 enabled=false；出现行 → enabled=true
  - scheduler-jobs.test.js：JOBS 含 ledger-hygiene 且 handler 被调用
- **smoke**：`node packages/brain/scripts/smoke-ledger-hygiene.mjs` 真查 DB 出分数（部署后跑）
- proven-to-fire：单测中含一条"制造欠账上升 → 断言 issue INSERT 被调用"的用例（守卫报红实证）

## 不做（YAGNI）

- 不做飞书通知（Bark 仅 P1 升级时）
- 不做历史趋势图/Dashboard（分数进 design_docs 由晨报消费即可）
- 不动 golden_path/写入方（T2 范围）
