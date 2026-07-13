# 小改动 PrepPRD：dreaming L1 —— line 级夜间蒸馏 job

## 改什么

1. **新增 scheduler job `line-dreaming`**（`packages/brain/src/line-dreaming.js` + 注册进 `packages/brain/src/scheduler-jobs.js` 的 `JOBS` 数组，位置在 `battle-report` 条目**之前**）。
   - 触发窗口：每晚北京 05:00（UTC 21:00），仿 `battle-report.js` 的 `isInBattleReportWindow` / `alreadyGeneratedToday` 模式（20h 去重，自 gate，不依赖外部 cron）。
   - 60s loop 会每轮无脑调用，job 内部自己判断"该不该真正执行"。

2. **对每条 `journeys.status='active'` 的 journey（line），拉取 24h 切片**：
   - `decisions`：经 `target_id → journey_features.journey_id` 关联（`decisions.target_type='journey_feature'`）过滤出属于本 line 的决策
   - `journey_features`：`journey_id = 本 line`，24h 内 `updated_at` 有变化的
   - `advancement_items`（推进项）：`journey_id = 本 line`，24h 内状态变化的
   - `issues`：`journey_id = 本 line`，24h 内新建/更新的
   - `initiative_runs`（runs）：`journey_id = 本 line`，24h 内的（同 `battle-report.js` 现有查询口径）
   - `learnings`：经关联 `task_id → tasks.payload->>'journey_id'` 尽力关联（无法关联的不纳入，不报错）
   - 军师留痕：`notes` 表标题前缀 `军师决策[<line名>]` 的记录（24h 内）

3. **写入 `design_docs` 新类型 `line_ledger`**：
   - 新 migration（仿 316）给 `design_docs_type_check` 白名单加 `line_ledger`
   - 每条 journey 一条记录，20h 内已存在则 UPDATE（不新建），保证同一 line 同一天只有一条最新账本
   - `content` = 蒸馏后的 markdown 摘要（各段落：本 line 24h 决策 / 推进项变化 / issue 变化 / run 战况 / 军师决策摘要；每段空则渲染"暂无"，抄 `battle-report.js` 的 `renderBattleReportMarkdown` 写法）
   - 记录关联 `journey_id`（`design_docs` 表若无此列需一并加，供 L3 消费方按 line 查询）

4. **L3 三文档改吃 L2 摘要**（不再各自重新拉一遍 24h 原始切片）：
   - `diary-scheduler.js`：生成日报涉及跨 line 数据的段落时，改为查 `design_docs(type='line_ledger', created_at>=NOW()-20h)` 汇总，而非独立查询
   - `daily-review-scheduler.js` 的 `triggerArchReview`：建 `arch_review` 任务时，把对应 line 的 `line_ledger` 摘要文本注入任务 `payload`/`description`，供 arch-review skill 直接读取而非重新调研
   - `daily-review-scheduler.js` 的 `maybeTriggerStrategySession`：同上，把相关 line 的 `line_ledger` 摘要注入 `strategy_session` 任务 payload

## 为什么改

现状：`diary`/`arch_review`/`strategy_session` 三个日级文档各自独立重新查询 24h 原始数据（decisions/issues/runs/…），存在重复计算、口径可能漂移、且随 line 数增多查询成本线性增长。`line-dreaming` L1 job 把"按 line 蒸馏 24h 事实"做成唯一事实源（L2 摘要），下游 L3 文档改为消费这份摘要，保证口径统一、减少重复查询、也为未来更多"按 line 消费 24h 事实"的场景（如晨间对齐会、军师月级重构 tick）提供复用点。

## 关联上下文

- 相关 Journey：Cecelia Harness Pipeline（`bb8cc561-b3ee-4fec-b74d-2255694bd963`），本任务本身是该 journey 下 dev_pipeline 基础设施改动
- 相关历史决策：`ac2af31b`（日报系统定形：两层下钻）、`e1eed454`（军师双频）——本任务是这两个决策的支撑基建
- 相关既有代码模式：`battle-report.js`（design_docs 写入 + 窗口/去重 gate 的标准范式）、`line-strategist` skill（军师留痕的写入格式）

## 前置工作（已核对）

- [x] `design_docs` 表已存在，类型白名单机制已验证（migration 195/316 先例可复用）
- [x] `advancement_items`/`issues` 已有 `journey_id` 列（migration 325/322）
- [x] `initiative_runs` 已有 `journey_id`（`battle-report.js` 现有查询已验证可用）
- [x] `notes` 表 + 军师留痕标题格式已由 `line-strategist` skill 确认（标题前缀 `军师决策[`）
- [x] `scheduler-jobs.js` 注册表机制已验证可用（现有 7 个 job 同模式）

## 影响范围

- 新文件：`packages/brain/src/line-dreaming.js` + 对应 `__tests__`
- 改动文件：`scheduler-jobs.js`（注册新 job）、`diary-scheduler.js`、`daily-review-scheduler.js`（改数据源）
- 新 migration：`design_docs_type_check` 加 `line_ledger`；`design_docs` 表若无 `journey_id` 列需新增
- 不影响现有 diary/arch_review/strategy_session 的输出**结构**，只改数据来源，行为对用户不可见（内部管道优化）
- 风险：line 数量增长后 `line-dreaming` job 需在 5 分钟 timeout 内跑完所有 active line；本次先按现有 active journey 数量（个位数）实现，不做分批优化

## 验收标准

- [ ] `line-dreaming` job 注册进 `scheduler-jobs.js`，单测覆盖窗口判断 + 去重 + 24h 切片查询（mock pool）
- [ ] 手动触发一轮后，`design_docs` 表出现 `type='line_ledger'` 记录，`journey_id` 正确、内容包含各段落（含"暂无"兜底）
- [ ] `diary-scheduler.js` / `daily-review-scheduler.js` 改动后单测通过，确认改为读 `line_ledger` 而非重新查原始表（可用 mock 断言 SQL 调用变化）
- [ ] CI 全绿
