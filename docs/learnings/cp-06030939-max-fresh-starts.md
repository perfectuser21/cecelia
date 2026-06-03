# Learning：harness_initiative 无限 fresh-start → 加全局上限

分支: cp-06030939-max-fresh-starts
Brain task: 65b4e93a-731a-4a45-a595-42761a893757
日期: 2026-06-03

## 现象

本机 Docker 抽风时，某个 harness_initiative 任务反复重跑 planner，`execution_attempts` 一路涨到 20+，
同时起 20+ planner 容器，永不收敛。重启 Brain 也无济于事——一上来又是从头重跑。

## 根本原因

`runHarnessInitiativeRouter`（executor.js）的坏 checkpoint 处理逻辑：当 resume 的 checkpoint
处于 error 状态（`channel_values.error` 有值）时，会升 `attemptN` 做 fresh-start 从头重跑 planner。
这一步本身是对的（B57 修复 resume→END 死循环），但**只有"重跑"动作，没有"重跑次数上限"判定**。

`execution_attempts` 在两个"有 existing checkpoint"分支里各 +1，但全函数没有任何地方读它来止损。
于是只要坏 checkpoint 一直在（Docker 抽风导致每次 planner 都崩），就会无限 fresh-start：
attempt 4 → 5 → 6 …，每次都是一个新容器，永不 terminal。系统缺少"试够 N 次就认输"的收敛点。

## 修复

1. 加导出常量 `MAX_INITIATIVE_FRESH_STARTS = 3`。
2. 函数顶部、invoke graph 之前：`(task.execution_attempts || 0) >= MAX_INITIATIVE_FRESH_STARTS`
   → 不 invoke graph，标 task `status='failed'` + `failure_class='max_fresh_starts_exceeded'`，
   返回 `{ ok:false, error:'max_fresh_starts_exceeded', terminal:true }`。task 进终态，
   consciousness-loop 不再 retry。
3. resume 分支加 Wave 2b 钩子：`existing.channel_values?.error?.terminal === true` → 同样 terminal
   （failure_class='checkpoint_terminal'）。现在没人 set 也无害，给未来标记永久失败留接口。

只动 `runHarnessInitiativeRouter` 顶部 + 一个常量 + 一个 `markInitiativeTerminalFailed` 私有 helper，
没碰节点 catch→error→END / GAN / interrupt()（那些是 Wave 2b）。

## 下次预防

- 任何"失败 → 重试/重跑"的循环，落地时必须同时落地"重试上限 + 超限后的 terminal 终态"，
  不能只写重试动作。无界重试 = 资源黑洞（容器/token/DB 行）。
- 重试计数器（execution_attempts/retry_count）只要存在，就必须有一处代码读它做止损判定，
  否则就是"涨着好看"的死字段。
- terminal 失败要写明确的 `failure_class`，方便巡检/告警区分"该重试的失败"和"已认输的失败"。

### checklist

- [ ] 新增 retry/fresh-start 循环时，确认有 MAX 上限常量
- [ ] 确认超限后 task 进 terminal 终态（status=failed），不会被 consciousness-loop 再捞起
- [ ] 确认 terminal 失败写了 failure_class
- [ ] 确认计数器字段（execution_attempts 等）有代码读它做判定，不是只写不读
