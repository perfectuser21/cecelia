## Brain {VERSION} — 秋米 agent 不再见执行参数块自派子会话；yield 收尾不判完成

- openclaw-agent-executor.js promptOf：正文带已应用的执行参数块时，prompt 顶部声明「执行参数已由 Brain 应用：你就是 <agent>，本次模型 <model>，超时 <N> 分钟。直接在本会话完成任务，不要 sessions_spawn 子会话，不要 sessions_yield 等待。」并摘掉参数块（验收/设备要求转述保留）；无参数块时 prompt 逐字不变。
- reapOpenclawAgentRuns：exit 0 但日志显示 `yielded: true`，或无最终文本且 `result.payloads` 为空 → failed(agent_yielded_without_result)，result 留 receipt + yield_summary（子会话键），不自动重排。修 09-29 任务 55c2e84b 空报告被收割为完成、真机活在追踪外跑完。
