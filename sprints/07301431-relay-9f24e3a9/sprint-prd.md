# Sprint PRD — T10 统一收件箱完整性缺口修复（learnings → capture_atoms 路由补齐）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：账本保鲜守卫 m7 探针本次误报，暴露 T10 统一收件箱路由存在系统性缺口
- **本次推进预期**：消除 m7 探针"capture 零增长"误报的根因，让 T10 收件箱成为 learnings 产出的忠实镜像

## 背景

`packages/brain/src/ledger-hygiene.js` 的 m7 指标（"自主循环零产出"）2026-07-29 21:10 UTC 棘轮击穿，
判据是 `capture_atoms` 表近 24h 行数为 0。但同一窗口 `learnings` 表实际新增 10 行（watchdog_kill 失败
记录、对话决策固化、行为纠偏），证明自主循环并未停摆，是一次误报。

已用 grep + 代码走读核实：仓库内非测试代码共有 **13 处** `INSERT INTO learnings` 调用点，仅 2 处
（`learning.js::recordLearning()`；`routes/tasks.js` learnings-received 端点）已接入 T10 统一收件箱，
其余 **11 处均未调用 `pushCaptureAtom`**，是路由缺口本体。经逐条比对调用栈特征（title/category/
trigger_event），确认本次误报的 10 行 learnings 实际来自 3 个未接入点——`executor.js:1106`（watchdog
失败记录，2 行）、`conversation-consolidator.js:161`（对话决策固化，6 行）、`learning.js:728`
`extractConversationLearning()`（行为纠偏，1 行）、`auto-learning.js:98`（1 行）——**没有一行来自最初
怀疑的 `cortex.js::recordLearnings()`**（该函数是另一处独立、本次未触发但静态确认零接入的同类缺口，
line 890，被 line 726 `_processSuccessfulResponse` 调用）。其余未接入点：`learning.js:779`
`upsertLearning()`、`chat-action-dispatcher.js:126`/`:267`、`decision-executor.js:321`/`:400`、
`fact-extractor.js:384`。

## Golden Path（核心场景）

系统内任意代码路径写入 `learnings` 表 → 该写入必须同步产出一条 `capture_atoms` 记录（T10 统一收件箱）
→ `ledger-hygiene.js` m7 探针据此正确反映自主循环真实产出，不再误报。

具体：
1. [触发条件] 上述 11 处任一调用点执行 `INSERT INTO learnings` 成功
2. [系统处理] 该调用点在同一函数内追加调用 `pushCaptureAtom(pool, { targetType: 'learning', targetSubtype, routedToTable: 'learnings', routedToId: <新插入行 id> })`，失败按现有 wired 路径（`learning.js:121`）的容错模式处理（不阻断 learnings 主写入）
3. [可观测结果] `capture_atoms` 表在同一 24h 窗口内的行数与 `learnings` 表新增行数一致（允许合理去重差异），m7 探针不再误判

## 边界情况

- 已接入的 2 处（`learning.js::recordLearning`、`routes/tasks.js` learnings-received）不得重复接入或改动其现有 `pushCaptureAtom` 调用
- `pushCaptureAtom` 调用失败不得抛出未捕获异常导致 learnings 主事务回滚（对齐 `learning.js:121` 既有容错模式）
- 测试文件（`__tests__/*.test.js`）内的 `INSERT INTO learnings` mock 断言不在本次改动范围

## 范围限定

**在范围内**：
- 为上表 11 处未接入的调用点逐一补齐 `pushCaptureAtom` 调用
- 一条能复现"写 learnings 但 capture_atoms 零增长"的回归测试，永久保留在 CI（覆盖 `cortex.js::recordLearnings` 这一 issue 原始怀疑点，以及其余 10 处的结构性缺口）

**不在范围内**：
- 修改 `ledger-hygiene.js` m7 探针的判定逻辑本身（诊断结论倾向修源头而非绕过指标，最终取舍留给 proposer/reviewer GAN）
- capture-triage 分诊侧对新增 capture_atoms 记录的下游消费逻辑
- 本 worktree 内另一独立 issue（headed relay session "实际完成但记账为 failed"）——不同故障点，另开 issue 处理

## 假设

- [ASSUMPTION: `pushCaptureAtom` 的 `targetSubtype` 沿用各调用点现有 `category` 字段语义，不新增枚举]
- [ASSUMPTION: 11 处调用点全部在 `packages/brain/src/` 内，无需跨包改动]
- [ASSUMPTION: 回归测试优先采用 source-code inspection（对齐已有 invariant c674ab49），辅以至少一条针对 `cortex.js::recordLearnings` 的行为级测试，直接复现 issue 原始怀疑点]

## 预期受影响文件

- `packages/brain/src/{cortex,executor,conversation-consolidator,learning,auto-learning,chat-action-dispatcher,decision-executor,fact-extractor}.js`：各自补齐 `pushCaptureAtom` 调用（11 处，见背景表）
- 新增/扩展回归测试文件（结构性 source-inspection + 行为级 cortex.js 复现，各至少一条，永久入 CI）

## NFR 约束

<!-- 来源: decisions 表 category=nfr 查询为空（golden-path-decisions 与 ability decisions 均无返回），PrepPRD 亦未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: `pushCaptureAtom` 调用失败必须 catch 并 console.warn/error，不得吞错静默（对齐已有 wired 路径容错模式，最终措辞由 proposer 在 GAN 阶段确认）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 级查询为空（task 无 ability_id），area 级共 60 条，
     本段选录与本 sprint 直接相关的条目 + 全部 8 条系统级铁律；其余为跨领域历史 learning 不逐条注入 -->
- [单slot串行] 一个 slot/会话内严格串行执行任务，需要并行用多个 slot（来源: area/系统）
- [禁止写死环境假设值] 环境假设值禁止写死，要么从环境推导要么真机校准（来源: area/系统）
- [真环境验证才算done] 依赖真机/生产env的接缝断言必须真验证过才算done（来源: area/系统）
- [测试默认多租户] 单元/E2E 测试默认种≥2租户并断言互不串（来源: area/系统）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area/系统）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area/系统）
- [端点鉴权] 每个 API 端点必须有 auth（来源: area/系统）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户（来源: area/系统）
- [表名认领冲突] 建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area/capture-triage）
- [无消费方不上线] 新增后台落库路由必须有真实消费者，T10 收件箱统一设计已立死规矩（来源: area/capture-triage）
- [错误码契约需显式 else] 调用"失败返回 null/false"契约的函数需显式处理失败分支，不能只靠外层 try/catch（来源: area/capture-triage）
- [语义字段判定成功] 写库/通知接口成功判定必须看语义字段而非只 grep ok:true（来源: area/capture-triage）
- [回归测试用 source-code inspection] 验证调度接线比 mock 覆盖更直接有效（来源: area/capture-triage）
- [catch吞错需告警] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area/capture-triage）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: task.payload 无 journey_id（thin payload，非 /dev 路径 C 点火），无法查询 journeys/:id/golden-paths -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空，proposer 在 GAN 阶段按 target_environment=local_api 填入 curl + psql 脚本。
> 期望验收点（自然语言）：

```bash
# 1.【行为级】复现 cortex.js::recordLearnings 写 learnings 但不调用 pushCaptureAtom（修复前 FAIL）
# 2.【结构性,永久CI】断言 packages/brain/src/ 下每个含 INSERT INTO learnings 的非测试文件，
#    其所在函数体内必含 pushCaptureAtom（修复前 11 文件 FAIL → 修复后全 PASS）
# 3.【psql实证】合并后新触发一次 learnings 写入，capture_atoms 同步新增对应行
```

## journey_type: autonomous
## journey_type_reason: 无 apps/dashboard/、无远端 agent 协议/bridge、无 packages/engine/ 涉及，纯 packages/brain/ 后端数据写入路由修复
## target_environment: local_api
## target_environment_reason: 纯 Node.js 单测 + psql 直连验证（localhost:5221 + 本地 postgres），不涉及浏览器/UI
## journey_id: none
## step_id: none（PrepPRD 未锚定，task payload 为紧急 issue 直派，无 ability_id/journey_id）
