# 设计：九要素T9 — learnings 表噪音过滤 + 摘要生成可靠性修复

日期：2026-07-10
Brain task：4662db14-beb1-4769-974a-edc0f9af7b93（plan=nine-elements-integrity, seq=9）
上游设计：docs/architecture/2026-07-10-nine-elements-integrity/addendum-01-execution-telemetry-and-inbox.md
PrepPRD：sprints/07102000-t9-learnings-noise-summary/prep-prd.md

## 问题

learnings 表 8,307 行仅 482 行（6%）有 summary；事件层噪音（"任务完成/失败：<uuid>"）
淹没原子准则层真 learning，反刍/dreaming 无法消化。

## 排查结论（实测 2026-07-10）

| 来源 | 行数 | summary | 写入点 |
|---|---|---|---|
| dev_experience/learnings_received | 6,211 | 0 | routes/tasks.js:280（INSERT 缺 summary 列）|
| failure_pattern/task_failed_auto | 849 | 0 | auto-learning.js（缺 summary 列）|
| failure_pattern/watchdog_kill | 419 | 0 | executor.js:1105（缺 summary 列）|
| execution_result/task_completed_auto | 87 | 0 | auto-learning.js |
| task_completion/task_completed | 19 | 0 | routes/execution.js:561（纯噪音）|
| cortex_insight 等 | 482 | 482 | cortex.js / learning.js（调了 generateL0Summary）|

- `generateL0Summary` 是纯字符串截断（memory-utils.js:13-16），不会失败；"低成功率"
  根因 = 多数 INSERT 路径没写 summary 列。
- **dispatch-helpers.js RCA 路径评估（任务描述假设被数据证伪）**：recordLearning 经
  requires_learning 路径仅产出 4 行 systemic_failure，不是噪音主因；真主因是
  auto-learning 事件层（936 行）与 execution.js task_completion。但 recordLearning
  每次落库无条件建 P2 [Insight修复] dev 任务，是任务队列侧噪音，需 confidence 门槛。
- 既有 `parent_id` 列 = migration 063 去重版本链；与新列 `parent_learning_id`
  （事件层→原子准则层归纳链）语义不同，并存不冲突。

## 变更清单

1. **learning.js**：导出 `NOISE_LEARNING_CATEGORIES = ['task_completion']`；
   `recordLearning()` 入口守卫（纵深防御，当前 category 硬编码 failure_pattern 不会触发）。
2. **auto-learning.js `createAutoLearning()`**：引用 NOISE_LEARNING_CATEGORIES 拦截
   （真实执行点）；INSERT 补 `summary`（generateL0Summary）。
3. **auto-learning.js `handleTaskCompletedLearning()`**：停写（return null）——
   execution_result/task_completed_auto 与 tasks 表 result 完全重复，零准则价值；
   task_failed_auto 保留（喂反刍）。同步改 auto-learning.test.js 两条 completed 用例
   （行73/484）断言 return null 且不写库。
4. **routes/execution.js**：删除"任务完成 → learnings 闭环"try 块（~:534-577，
   task_completion 写入源头）。全仓无消费方按该 category 过滤，安全。
5. **executor.js watchdog_kill 写入 + routes/tasks.js dev_experience 写入**：补 summary 列。
6. **learning.js [Insight修复] 自动建任务**：加 `analysis.confidence >= 0.7` 门槛，
   低置信只落 learning 不建任务（cortex performRCA 确有 confidence 字段，兜底 0.3）。
7. **migration 330_learnings_lineage.sql**（Brain 启动 runMigrations 自动跑，事务包裹）：
   - `ADD COLUMN IF NOT EXISTS parent_learning_id UUID REFERENCES learnings(id)` + 索引
   - `ADD COLUMN IF NOT EXISTS verified_effective BOOLEAN`（NULL=未验证）
   - backfill：`UPDATE learnings SET summary = LEFT(COALESCE(title,'')||' '||COALESCE(content,''),100) WHERE summary IS NULL`
   - `DELETE FROM learnings WHERE category='task_completion'`
8. **selfcheck.js**：EXPECTED_SCHEMA_VERSION '326' → '330'（顺手校正滞后）。
9. **brain package.json** version bump（patch）+ DevGate 三查。

## 测试策略（integration/unit 档）

- unit：createAutoLearning 拦截噪音类目；createAutoLearning INSERT 参数含非空 summary；
  handleTaskCompletedLearning 返回 null 不写库；recordLearning confidence<0.7 不建任务、
  >=0.7 建任务；watchdog_kill / learnings-received INSERT 含 summary（mock pool 捕参断言）。
- migration：幂等（IF NOT EXISTS / WHERE 限定）；本地库跑后验证
  `count(summary)=count(*)`、task_completion 归零、两新列存在。
- 现有测试修复：auto-learning.test.js 行73/484。

## 风险

- migration backfill UPDATE ~7,800 行 + DELETE 19 行，单事务内秒级，无业务高峰顾虑。
- 停写 task_completed_auto 影响面：其唯一调用方 processExecutionAutoLearning，
  下游反刍消费的是 digested=false 通查，行为只减噪不改逻辑。
