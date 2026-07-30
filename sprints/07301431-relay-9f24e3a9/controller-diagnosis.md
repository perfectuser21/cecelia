# Controller 前置诊断：[ledger-hygiene] 自主循环零产出 欠账上升 0→1（2026-07-30）

> 本文件由 harness-controller 在 Step 0/1 前完成的根因排查，供 harness-planner 起草 sprint-prd.md 时参考。
> planner 仍应自行核实关键事实（表结构/代码路径），不得盲信本文件未经验证的推断。

## 触发源

- issue 由 `packages/brain/src/ledger-hygiene.js` 的 m7 指标（"自主循环零产出"）在 2026-07-29 21:10:30 UTC（北京 2026-07-30 05:10）棘轮击穿产生
- m7 探针二选一：(a) `design_docs(type='strategy_session')` 近 24h 行数 (b) `capture_atoms` 近 24h 行数
- 本次击穿明细（`.harness/verdicts` 之外，来自 design_docs id=6eb8e2c7-5ad7-40a8-95a1-df253b24487c）：
  `"自主循环零产出": {"stratDebt":0,"captureDebt":1}` —— 是 **capture 探针**触穿，非 strategist

## 根因（已用 psql 直连库核实，非猜测）

**`capture_atoms` 探针在 2026-07-28 21:10 UTC ~ 2026-07-29 21:10 UTC 窗口内确实 0 行新增，
但同一窗口内 `learnings` 表实际新增 10 行**（真实产出并未停止，是"产出没被路由进 capture_atoms"）：

```
28aa5486  2026-07-28 20:37  category=failure_pattern       trigger_event=watchdog_kill
139e9330  2026-07-28 20:38  category=failure_pattern       trigger_event=task_failed_auto
342b3475  2026-07-29 01:32  category=conversation_decision trigger_event=conversation_consolidator
d12695f2  2026-07-29 01:32  category=conversation_decision trigger_event=conversation_consolidator
64b1c00a  2026-07-29 05:12  category=conversation_decision trigger_event=conversation_consolidator
93393c5d  2026-07-29 05:12  category=conversation_decision trigger_event=conversation_consolidator
5dd27375  2026-07-29 10:22  category=conversation_decision trigger_event=conversation_consolidator
4811ccb5  2026-07-29 10:22  category=conversation_decision trigger_event=conversation_consolidator
0641d658  2026-07-29 10:59  category=failure_pattern       trigger_event=watchdog_kill
cd85f9df  2026-07-29 14:09  category=behavior_correction   trigger_event=conversation
```

`learnings` 表有两条互相独立的写入路径：

1. **`packages/brain/src/learning.js::recordLearning()`**（RCA failure_pattern 专用路径）
   —— 落库后**会**调用 `pushCaptureAtom(pool, {targetType:'learning', ...})`（learning.js:121-127），
   正确进入 T10 统一收件箱 → `capture_atoms`。
2. **`packages/brain/src/cortex.js::recordLearnings()`**（Cortex 决策/洞察路径，line 868-919，
   被 `_processSuccessfulResponse` line 726 `await recordLearnings(decision.learnings, event)` 调用）
   —— 直接 `INSERT INTO learnings`，**全程未调用 `pushCaptureAtom`**（`grep -n pushCaptureAtom
   packages/brain/src/cortex.js` 零命中）。

上面 10 行 learnings 的 category（`failure_pattern`/`watchdog_kill`、`conversation_decision`、
`behavior_correction`）与 cortex.js `recordLearnings()` 的写入特征（category 硬编码
`'cortex_insight'`... 注意：实际库里这几行 category 不是 'cortex_insight'，说明还可能存在
第三条写入路径或 category 在别处被覆盖——**planner/proposer 需要用 psql 逐条核对这 10 行
learnings 各自的实际调用栈来源（cortex.js recordLearnings vs 其它未知路径），不要假设全部
10 条都来自 cortex.js**。已确认的唯一强证据是：`grep pushCaptureAtom packages/brain/src/cortex.js`
零命中，即 cortex.js 内部完全没有任何调用点会让它产出的 learnings 进入 capture_atoms。

## 结论（供 planner 转化为 FR/不变量，非最终定案）

这是一次**误报（false positive）**：ledger-hygiene m7 指标把"capture_atoms 表零增长"等同于
"自主循环零产出"，但 `learnings` 表证明自主循环（watchdog kill 处理、对话决策固化、行为纠偏）
当天实际产出了 10 条真实学习记录——只是其中至少一部分（来源待 planner 精确核实）的写入路径
未接入 T10 统一收件箱，导致对 capture_atoms 的观测失真。

可能的修复方向（不代表最终合同范围，proposer 起草时定夺）：
- 让所有写入 `learnings` 表的路径都调用 `pushCaptureAtom`（补齐 cortex.js 缺口，对齐
  learning.js 已有做法），使 T10 收件箱成为 learnings 产出的忠实镜像
- 或者：m7 指标改为直接探测 `learnings` 表近 24h 行数，而不是通过 `capture_atoms` 间接推断
  （绕过路由问题，但不解决 T10 收件箱本身的完整性缺口——其它下游消费者，如 capture-triage 分诊，
  同样会漏掉这批 learnings）

**倾向第一种**：T10 收件箱设计初衷就是"统一"入口（design doc:
docs/superpowers/specs/2026-07-10-capture-inbox-t10-design.md），cortex.js 路径未接入
是该设计的完整性缺口，修复应该在源头补齐，而非在下游指标层面绕过。但最终判断权在
proposer/reviewer GAN 阶段，本文件仅供参考。

## 相关但非本次范围

- 本 worktree 内曾有另一独立任务 `b62e3dc3`（sprint 07291205-ci-auto-merge-token-fix）的 relay-run
  显示 `phase='failed'`（`failure_reason='task_failed_upstream'`）但其 PR #4445 实际已 MERGED——
  暴露 headed/skill-relay session 有"实际完成但记账为 failed"的另一类问题，与本次 m7 capture 探针
  误报是两个不同故障点，**不在本 sprint 范围内**，如需处理应另开 issue。
