# Learning: cp-05062125-w1-w3-w4-executor-reliability

## 事件

`packages/brain/src/executor.js:2820` 的 `harness_initiative` 路由分支永远用固定
`thread_id: 'harness-initiative:<id>:1'` 调 LangGraph，没有 AbortSignal、没有节点级事件流，
也没有任何机制识别"已 stuck 的旧 checkpoint"。MJ1 initiative `b10de974` 在
step 75 docker-executor OOM 后 invoke 永久 hang，Brain 重启又从同一 stuck checkpoint 续跑，
形成死循环。用户被迫 `DELETE FROM checkpoints WHERE thread_id LIKE '%b10de974%'` 才解开。

## 根本原因

**LangGraph 默认行为是 "thread_id 已有 checkpoint → resume from last"。** 当 caller
用单调不变的 thread_id 调 invoke，每一次重新 dispatch 都被库视作"续跑"。这不是 bug，是
LangGraph 设计契约——但 caller 必须显式控制 fresh vs resume，否则 stuck 永远复活。

executor.js 的实现没有：
1. 把 attemptN 编进 thread_id（让 retry 自动落到新 thread）
2. 显式的 resume 信号（`payload.resume_from_checkpoint`）
3. AbortSignal 作 deadline 兜底（invoke 卡住没人能 kill）
4. streamMode 给 LiveMonitor 推进度（看不到节点执行到哪里）

这都是 LangGraph 1.2.9 已有但未启用的原语。Spec
`docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md`
盘清"已用对的 80%"vs"5 件缺漏"。

## 下次预防

- [ ] **任何 LangGraph 调用必须 caller 显式控制 fresh vs resume**：thread_id 永远
  含 attemptN（`<workflow>:<id>:<attemptN>`），且当 caller 没传
  `resume_from_checkpoint=true` 时自动升 N，新建 thread 跑 fresh。绝不写死 `:1`
- [ ] **任何长跑 LangGraph invoke 必须配 AbortSignal + deadline 兜底**：进程内
  `setTimeout` 是第一道防线，但 Brain 进程级 watchdog（5min 扫
  `initiative_runs.deadline_at`）是兜底，缺一不可
- [ ] **stream 取代 invoke 是默认选项**：streamMode='updates' 给 LiveMonitor 实时
  节点进度，不损耗性能，唯一成本是写 `task_events` 表，cap 100 防写爆
- [ ] **测试用 fakeTimers 跨过最小 floor**：watchdog 实现用 `Math.max(60_000, ...)`
  防误用，测试时必须用 `vi.useFakeTimers()` + `advanceTimersByTimeAsync(60_001)`
  才能在合理时间内验证 abort 路径。第一次写测试漏了这一步直接 timeout
- [ ] **可测函数化是 spec 内嵌要求**：把 inline 路由分支抽成 export 函数是 §W1
  Task 1.2 的明确指令。不抽出来无法用 mock 隔离 PostgresSaver 单例
- [ ] **schema_version 三处同步**：新增 migration → 更
  `selfcheck.js` `EXPECTED_SCHEMA_VERSION` + `DEFINITION.md` schema_version 行，
  否则 facts-check.mjs 红
