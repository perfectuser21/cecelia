# Sprint PRD — Walking Skeleton P1 final happy 验证（B19 修后真验）

## OKR 对齐

- **对应 KR**：Walking Skeleton P1 — harness pipeline end-to-end happy 路径必须真过（generator commit→PR→fix 循环→evaluator 真验 PR 分支代码→final PASS）
- **当前进度**：B14–B19 系列 6 个 bug fix 已合并（evaluator regex / dbUpsert / final_evaluate PR_BRANCH env / generator self-verify / fixDispatchNode 保留 pr_url+pr_branch），但缺一次真实端到端跑通来证明所有 fix 协同生效
- **本次推进预期**：本 sprint 闭合"最后一公里"——跑一次完整 W 任务 happy 路径，证 B19 fix 后 fixDispatchNode 不再 reset pr_url，final_evaluate 拿得到 PR_BRANCH，evaluator 真在 PR 分支上跑验证命令，task graph 走到 verdict=PASS 不再循环到 MAX_FIX_ROUNDS

## 背景

- B19 之前 W40 实证：`fixDispatchNode` 把 pr_url / pr_branch 字段清空 → 进入 fix 循环后下一轮 evaluate 拿到的 PR_BRANCH 是空 → evaluator 默认在 main 分支跑，看不到本轮 PR 代码 → verdict 永远 FAIL → 循环到 MAX_FIX_ROUNDS 算失败
- B19 commit 47ad091d7 改了 `packages/brain/src/workflows/harness-task.graph.js` 的 `fixDispatchNode`，让其保留 pr_url + pr_branch 字段。带了单元测试（`fix-dispatch-keep-pr-url.test.js`）+ smoke 脚本（`b19-fix-dispatch-keep-pr-url-smoke.sh`）
- 但单元测试只能证字段在 state 里被保留——不能证 final_evaluate 节点真用上了，更不能证 evaluator 在 PR 分支上而不是 main 分支上跑。这就是本 sprint 要补的"最后一公里"

## Golden Path（核心场景）

系统从 [Brain 派发一个 harness W 任务] → 经过 [planner→proposer→generator→PR 自检 PASS→evaluator 验证 FAIL→fix 循环 N 轮（pr_url/pr_branch 在每轮 state 中保留）→final_evaluate 拿到 PR_BRANCH→checkout PR 分支→真跑验证命令→verdict=PASS] → 到达 [task graph 节点状态写回 tasks.status=completed，dev-record 留下 pr_url + merged_at]

具体：
1. **触发条件**：Brain dispatcher 选中一个 `harness_*` 任务（如 W37 playground GET /decrement 的同型任务），调用 `harness-task.graph` 工作流
2. **系统处理**：
   - planner→proposer→generator 链跑完，generator 产 commit + 推 PR
   - PR self-verify PASS（B18 已加）
   - evaluator 第一轮：checkout PR 分支，跑验证命令，假设 FAIL（演练 fix 循环）
   - 进入 fixDispatchNode：state 中 pr_url + pr_branch 必须**仍然存在**（B19 保证）
   - generator 跑 fix → 推到同 PR 分支 → 再次 evaluator 验证
   - 直到 verdict=PASS 或达 MAX_FIX_ROUNDS（=20）
   - final_evaluate 节点：读取 state 的 PR_BRANCH（必须非空），传给 evaluator skill 作为 env 变量，evaluator skill 用 `git checkout origin/$PR_BRANCH` 切到 PR 分支后跑验证命令
3. **可观测结果**：
   - `dev_records` 表中本 task_id 行 `merged_at` 非空，`pr_url` 字段非空且与 fix 循环开始时的 pr_url 一致（证 B19 fix 真生效）
   - `tasks.status='completed'`，`result.verdict='PASS'`
   - `dispatch_events` 中能看到完整 graph 节点轨迹（含至少 1 次 fixDispatch + 1 次 final_evaluate）
   - final_evaluate 派给 evaluator 的 dispatch payload `env` 字段含 `PR_BRANCH=<具体分支名>`（不是空、不是 main）
   - evaluator 容器内 `git rev-parse HEAD` 等于 PR 分支 HEAD，不等于 main HEAD

## Response Schema

N/A — 本任务无新 HTTP 响应；属 Brain 内部工作流（task graph）行为验证。验收靠数据库表（dev_records、tasks、dispatch_events）和日志，不是 API 响应。

## 边界情况

- **MAX_FIX_ROUNDS 内不收敛**：如果 generator 真改不对，verdict 永远 FAIL→循环 20 轮后退出。本 sprint 验收**不要求** verdict=PASS，要求"final_evaluate 真拿到了非空 PR_BRANCH 且 evaluator 真 checkout 到该分支跑"。verdict 本身是否 PASS 取决于 task 难度，与 B19 fix 是否生效正交
- **第一轮 evaluator 就 PASS**：fix 循环 0 次，fixDispatchNode 不被触发——本 sprint 必须**强制**至少 1 次 fix 循环（选一个第一轮易 FAIL 的演练 task，或人工注入 FAIL 信号）来覆盖 B19 修的代码路径
- **并发 W 任务**：多个 W 任务同时跑时 state 不串。dispatch_events 按 task_id 隔离应已保证
- **PR 分支被删**：若 PR 已 merge 后分支删除，evaluator checkout 失败——本 sprint 在 PR merge 前验，分支必存

## 范围限定

**在范围内**：
- 选一个真实的 harness W 任务（建议复用 W37 同型，playground 加新 endpoint），跑完整端到端
- 强制构造至少 1 轮 fix 循环（如演练 task 第一轮验证故意会失败）
- 验三件事：(1) fixDispatchNode 真保留 pr_url+pr_branch；(2) final_evaluate 真拿到非空 PR_BRANCH；(3) evaluator 真在 PR 分支上跑（不在 main）
- 输出诊断报告：从 dispatch_events / dev_records / task graph 日志抽证据链贴出来

**不在范围内**：
- 不改 Brain 代码（B19 已修完，本 sprint 是验证 sprint 不是修 bug sprint）
- 不优化 fix 循环算法（MAX_FIX_ROUNDS、retry 策略等）
- 不动 planner / proposer / generator / evaluator 任一 skill
- 不引入新 KR / 新功能

## 假设

- [ASSUMPTION: Brain (localhost:5221) 在执行时是活的，能派发任务和回写状态]
- [ASSUMPTION: 至少有一个能复现"第一轮 FAIL→fix→PASS"的演练 W 任务可用；若无，本 sprint 需先造一个最简 demo task（如 playground 加一个第一次实现故意写错、fix 后修正的 endpoint）]
- [ASSUMPTION: MAX_FIX_ROUNDS=20 在 P1 B11 已生效（commit 542f1b33f），不会因 fix 轮数限制人为打断]
- [ASSUMPTION: evaluator skill 的实现确实读 env PR_BRANCH 来 checkout（B17 commit b108eb6a0 已加 env，但 skill 端是否消费需 verify）]

## 预期受影响文件

- `sprints/w41-walking-skeleton-final-b19/sprint-prd.md`：本 PRD
- `sprints/w41-walking-skeleton-final-b19/verification-report.md`（Generator 阶段产出）：端到端跑通的证据链（PR 链接、dispatch_events 截取、dev_records 行、evaluator 容器内 git rev-parse 输出）
- 可能新增的演练 task 定义（如需）：`packages/brain/scripts/seed-w41-demo-task.js` 或类似
- 不修改任何 Brain 源码

## journey_type: autonomous
## journey_type_reason: 任务全程在 Brain 内部 task graph 中执行，无 UI 交互、无 dev pipeline 改动、无远端 agent 协议变更，纯 Brain 自治工作流的端到端验证
