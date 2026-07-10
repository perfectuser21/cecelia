# 小改动 PrepPRD：九要素T10 统一收件箱通电（capture_atoms 三入口写入 + 分诊 tick + Invariant Gate）

## 改什么
依据已批准设计 `docs/architecture/2026-07-10-nine-elements-integrity/addendum-01-execution-telemetry-and-inbox.md`（T10 部分）：

1. `packages/brain/src/handoff.js` — `saveHandoff()` 收尾时顺手 `INSERT INTO capture_atoms`（content=handoff 摘要，source_type='handoff'，routed_to_table='tasks'，routed_to_id=task_id）
2. `packages/brain/src/learning.js` — `recordLearning()` 成功落库后（非 task_completion 噪音，T9 已过滤）顺手写一条 capture_atoms
3. issue 创建入口（`packages/brain/src/routes/issues.js` 或等价位置）— 创建 issue 时顺手写一条 capture_atoms
4. 新建 `packages/brain/src/capture-triage.js` — tick job：读 `capture_atoms WHERE status='pending_review'`，先过便宜规则表（见设计文档），规则打不中的调 LLM 分类；四路分诊（紧急插队/挂Line backlog/候选铁律/OKR）结果写回 `routed_to_table`/`routed_to_id` + 更新 status；LLM confidence < 0.7 一律留 pending_review
5. 新建 `packages/brain/src/invariant-gate.js` — 四查（与既有铁律冲突/可验证/scope恰当/与累积FR矛盾）单次 LLM 调用，PASS 才允许分诊结果写 `decisions category=invariant`，否则落 pending_review
6. `packages/brain/src/tick-runner.js` — 注册 `runCaptureTriageIfNeeded`（复用 scheduler-jobs 注册表模式，同 T5 line-dreaming）

无新表、无 migration（capture_atoms schema 已存在，07-07 决策 928c6054 设计）。

## 为什么改
capture_atoms 表结构完备但仅 1 条记录——handoff/learning/issue 产出后不进箱，分诊逻辑从未实现，统一收件箱空转。T8/T9 已把 decisions/learnings 治理干净，"变铁律"路径的脏数据污染风险已解除，T10 可通电。

## 关联上下文
- Brain 任务：f9b58d4a-1c11-499b-b74c-176028848f3f（nine-elements-integrity plan_seq=10，depends_on_seq=9 已完成）
- 设计：addendum-01（关键决策：进箱用"推"、分诊用异步 tick、铁律写入前置 Invariant Gate 四查）
- 历史决策：928c6054（想法收件箱设计）、1ef6ec3e（四查原案）、06f78c9a（禁建平行表）

## 影响范围
- handoff/learning/issue 三条写入路径各加几行推送，进箱写入失败必须不阻塞主流程（try/catch 降级为日志）
- 新增 tick job 一个；LLM 调用仅在便宜规则打不中 + 候选铁律 Gate 时发生
- Brain 版本 bump + brain-deploy 重建镜像

## 验收标准
- [ ] 单测：三处写入函数正确调用 capture_atoms 插入（失败不阻塞主流程）
- [ ] 集成测试：capture-triage 对四类样例数据分诊结果符合便宜规则表
- [ ] 单测：Invariant Gate 四查各自独立可控（mock LLM 输出），FAIL 时落 pending_review 不写 decisions
- [ ] tick-runner 注册 runCaptureTriageIfNeeded，模式与既有 scheduler-jobs 一致
- [ ] CI 全绿
