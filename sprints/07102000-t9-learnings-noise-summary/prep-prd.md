# 小改动 PrepPRD：九要素T9 — learnings表噪音过滤 + 摘要生成可靠性修复

Brain task: 4662db14-beb1-4769-974a-edc0f9af7b93（plan=nine-elements-integrity, seq=9）
设计依据: docs/architecture/2026-07-10-nine-elements-integrity/addendum-01-execution-telemetry-and-inbox.md

## 排查结论（实测数据，2026-07-10）

learnings 表 8,307 行，仅 482 行有 summary（6%）。分来源：
- `dev_experience/learnings_received` 6,211 行 0 summary（routes/tasks.js:280 INSERT 不带 summary 列）
- `failure_pattern/task_failed_auto` 849 行 0 summary（auto-learning.js 不带 summary）
- `failure_pattern/watchdog_kill` 419 行 0 summary（executor.js:1105 不带 summary）
- `execution_result/task_completed_auto` 87 行 0 summary（auto-learning.js）
- `task_completion/task_completed` 19 行 0 summary（routes/execution.js:561，任务描述点名的纯噪音）
- 有 summary 的全部来自 cortex.js / learning.js recordLearning（调了 generateL0Summary）

**generateL0Summary"低成功率"根因**：函数本身是纯字符串截断（memory-utils.js:13-16），不会失败；
低覆盖率 = 多数 INSERT 路径根本没写 summary 列。

**dispatch-helpers.js RCA 路径评估**：数据证伪"主因"假设——recordLearning（经
processCortexTask requires_learning 路径）产出 systemic_failure 仅 4 行。真正噪音主因是
auto-learning.js 事件层记录（936 行"任务失败/完成：<uuid>"，与 tasks 表信息完全重复）
和 execution.js 的 task_completion。但 recordLearning 每次落库都无条件建 P2 [Insight修复]
dev task，这是任务队列侧噪音，需收窄。

## 改什么

1. **learning.js**：导出 `NOISE_LEARNING_CATEGORIES = ['task_completion']` + 守卫；
   `recordLearning()` 入口对噪音类目直接 return null 不落库（设计决策：应用层拦截，可调黑名单）。
2. **routes/execution.js**：删除 task_completion learnings 写入块（约 :534-577 的"任务完成 →
   learnings 闭环"try 块）——纯噪音源头，与 tasks 表重复。
3. **摘要可靠性**：以下 INSERT 路径补 `summary`（generateL0Summary）：
   - auto-learning.js `createAutoLearning()`
   - executor.js watchdog_kill failure_pattern 写入
   - routes/tasks.js learnings-received dev_experience 写入
4. **migration 330_learnings_lineage.sql**：
   - `ALTER TABLE learnings ADD COLUMN parent_learning_id UUID REFERENCES learnings(id)`（自引用：事件层→原子准则层归纳链，区别于既有 parent_id 版本链）+ 索引
   - `ADD COLUMN verified_effective BOOLEAN`（NULL=未验证，true/false=验证结果）
   - 存量 backfill：`UPDATE learnings SET summary = left(...title||content..., 100) WHERE summary IS NULL`
   - `DELETE FROM learnings WHERE category='task_completion'`（19 行历史噪音）
   - 同步 bump selfcheck.js EXPECTED_SCHEMA_VERSION
5. **dispatch-helpers RCA 收窄**：learning.js recordLearning 的 [Insight修复] 自动建任务加
   confidence 门槛（rcaResult.confidence >= 0.7 才建，低置信只落 learning 不建任务）。
6. **auto-learning.js 收窄**：task_completed_auto（execution_result）事件层记录停写
   （与 tasks 表 result 完全重复，零原子准则价值）；task_failed_auto 保留（喂反刍系统）。

## 为什么改
九要素账本保鲜：learnings 表是"原子准则层"账本，事件层噪音淹没真 learning，摘要缺失让
反刍/dreaming 无法消化。新增两列为后续事件层→准则层提炼（T10/dreaming）铺数据模型。

## 影响范围
- learnings 表消费方：rumination/dreaming、memory 搜索——只减噪音不改既有行为
- migration 为纯增列+backfill+删19行，无破坏性；parent_learning_id 与 parent_id 并存语义已核实不冲突
- Brain 改动走 DevGate（facts-check / version-sync / dod-mapping），brain package.json bump

## 验收标准
- [ ] 单测：recordLearning 对噪音类目直接跳过不落库（failing test 先行）
- [ ] 单测：createAutoLearning / watchdog_kill / learnings-received 写入均含非空 summary
- [ ] 单测：recordLearning confidence < 0.7 不建 [Insight修复] 任务，>= 0.7 建
- [ ] 单测：task_completed_auto 不再落库
- [ ] migration 330 幂等可重跑；本地库执行后 `count(summary)=count(*)`、task_completion 行归零、两新列存在
- [ ] DevGate 三查通过 + CI 全绿
