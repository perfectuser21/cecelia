# Sprint PRD — 修复 never_started 假杀失败模式（queued 未 spawn 任务被 liveness watchdog 杀死）

## OKR 对齐

- **对应 KR**：O「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **本次推进预期**：消除 Brain 派发/liveness 链一个已实证的假杀失败模式，任务调度回归可信

## 背景

原任务 b35bfa0c（dev/P0/headed_manual=true）status=queued、从未被 spawn（Brain 日志零 dispatch 记录、
task_events/dispatch_events/failure_events 全 0 行、日志文件从未创建），却被 liveness watchdog 双确认探测
判 never_started 杀死（kill ts=2026-08-07T02:01:08Z）。本 sprint 修这个失败模式本身，不做 D1 工程本体
（由原任务自己的重试链承担，next_run_at=2026-08-07T02:16:08Z，不得抢做）。
需求唯一来源：`.harness/task-94ee0ec4-context.md`（controller 一手调查简报，payload.prep_prd_body 为空）。

## Golden Path（核心场景）

系统从 [任务入队 queued] → 经过 [派发认领→spawn 有回执留痕；liveness 只探测已真实 spawn 的任务] → 到达 [未 spawn 任务绝不被判 never_started 杀死]

具体步骤（FR，逐条可验证）：
1. **FR-根因实证**：对候选根因链逐一用一手证据证实/证伪（禁止猜测），结论与证据写入 `<SPRINT_DIR>/root-cause.md`：
   - a) liveness 探测集合的任务选择谓词过宽（或某处把任务错标"运行中"），使未 spawn 任务进入探测集——查探测选择 SQL/谓词；
   - b) dispatcher claim 了任务但 spawn 静默失败、无日志无回执——查 claim→spawn 之间是否缺 fail-closed 回执；
   - c) headed_manual 旗标语义悬空（全 monorepo 源码零命中）：预期人工有头执行的任务被当普通 dev 任务对待。
   三条各给"证实/证伪 + 证据（代码位置/DB 查询/日志）"结论；起点：packages/brain/src/executor.js:4043-4052 与 liveness 契约文档。
2. **FR-失败复现测试先行**：先写 failing regression test，复现「queued 且从未 spawn 的任务被 liveness 判 never_started 杀死」；
   修复前 Red、修复后 Green，永久进 CI（对齐既有 liveness-never-started.integration.test.js 所在测试族，不能删）。
3. **FR-根因修复**：按实证根因修复（如收窄 liveness 探测谓词至"已确认 spawn 过的任务"，和/或 claim→spawn 加 fail-closed 回执留痕）；
   watchdog kill / spawn 失败必须留下可查证据（Brain 日志 + task 相关事件表），杜绝"零留痕被杀"。
4. **FR-headed_manual 语义落地**：二选一拍板并实现——消费（headed_manual=true 任务不进入无头自动派发与 liveness 假杀路径，
   走有头等待语义）或拒绝（建单/派发入口显式校验并报错）；不许继续悬空；拍板结论写 Brain decisions 表留痕。
5. **FR-原任务处置留痕**：若修复需变更 b35bfa0c 任务数据（改标/清 watchdog 计数/换派发形态），变更留痕；不改其 D1 工程范围。
6. **FR-假杀不再发生断言**：在测试/E2E 中重放事故形态（queued、无进程、无日志文件、headed_manual=true 的任务），断言
   经过 ≥1 个完整 liveness 探测周期后该任务不被判 never_started、status 不被 watchdog 置 failed、无新增 watchdog_kill payload。

## 边界情况

- 真实 spawn 后进程立死的任务：仍必须被 watchdog 正常捕获（修复不得把真 never_started/真死进程放过——回归测试须含此反例）
- headed_manual 任务与普通 dev 任务并存队列时，普通任务派发不受影响
- watchdog kill 不得覆盖已有 error_message/failure_class（invariant 56a0ba9f）

## 范围限定

**在范围内**：Brain 派发/liveness/watchdog 链（packages/brain）根因实证与修复、回归测试、headed_manual 语义落地、决策留痕
**不在范围内**：D1 数据层工程本体（AI四列/UNIQUE/run状态机/建单生成器）、watchdog 大架构重构、其他失败分类逻辑改动

## 假设

- [ASSUMPTION: 根因以 generator 一手实证为准，a/b/c 可能多条同时部分成立；修复须覆盖全部被证实项]
- [ASSUMPTION: headed_manual 语义拍板若无用户新输入，默认取「消费」方向（有头任务不进无头派发/liveness 假杀路径），拍板过程留痕 decisions]

## 预期受影响文件

- `packages/brain/src/executor.js`: never_started 分类与 liveness 探测选择逻辑（4043-4052 一带）
- `packages/brain/src/__tests__/integration/liveness-never-started.integration.test.js`（或同族新测试文件）: failing regression test
- `packages/brain/src/`（dispatcher/claim 路径）: fail-closed 回执（若根因 b 被证实）
- `docs/architecture/2026-07-10-executor-liveness-contract/architecture.md`: 契约若变更需同步
- Brain 改动走 DevGate 三件套（facts-check / check-version-sync / check-dod-mapping）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 两源均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（简报未指定；liveness 探测周期沿用现值，不新增配置）
- 可观测: watchdog kill 与 spawn 失败必须在 Brain 日志 + 事件表双留痕（本次事故零留痕即缺口，属修复验收面）
- 版本要求: 无
- 频控: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 两源为空（ability_id/journey_id 空）；area 级 76 条，仅注入与本 sprint 域相关 5 条，其余 71 条为 capture-triage learning 回流与 smoke 噪声行（smoke-invariant-*），与本域无关未注入 -->
- [never_started兜底] watchdog 对「从未启动的进程」必须走 never_started 分类兜底且不覆盖已有 error_message/failure_class，防假标签污染 urgent 学习流（来源: area, 56a0ba9f）
- [headed点火写worktree] headed 前台点火任务必须在点火时用 Brain 同款 jsonb merge 把 worktree_path 写进 task payload，且路径在受控 Harness 根目录内（来源: area, 17722a93）
- [urgent建单查重] capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重，同根因已有 open 任务时合并而非裂变新单（来源: area, 81294701）
- [失败分支显式] 调用"失败不抛异常、返回 null/false"契约的函数必须显式写 else 失败分支，不能只依赖外层 try/catch（来源: area, e9c7752f）
- [headed场景核对] 起草 host/环境白名单类断言时强制核对 headed 人工接管场景（来源: area, 9f14c074）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史——task.payload.journey_id 为空，非路径 C 点火，无已验收 ability golden_path）

## E2E 验收

> 占位：最终可执行脚本由 proposer 按 target_environment=local_api 产出（curl localhost:5221 + psql cecelia + npm test）。

```bash
# 期望验收点（自然语言）：
# 1. 回归测试文件存在且在 CI 内运行：复现「queued 未 spawn 任务被判 never_started」的测试，修复后 Green
# 2. 重放事故形态（插入 queued、无进程、headed_manual=true 的任务）→ 跨 ≥1 个 liveness 探测周期后：
#    psql 断言该任务 status 仍非 failed、payload 无新增 watchdog_kill、error_message 未被覆盖
# 3. 反例：真实 spawn 后立死的进程仍被 watchdog 正常判定（防修过头）
# 4. root-cause.md 存在且 a/b/c 三条各有"证实/证伪+证据"结论；headed_manual 拍板已写 decisions 表（psql 可查）
# 5. DevGate 三件套通过（facts-check / check-version-sync / check-dod-mapping）
```

## journey_type: autonomous
## journey_type_reason: 改动全部落在 packages/brain（派发/liveness/watchdog 链），纯后端无 UI
## target_environment: local_api
## target_environment_reason: Brain 内部逻辑，本机 cecelia 侧 evaluator 用 curl localhost:5221 + psql + npm test 验收，无需浏览器
## journey_id: none
## step_id: none（PrepPRD 未锚定——payload 无 journey/step，来源为 capture_atoms urgent 路由）
