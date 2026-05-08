---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: kill-resume on 14-node graph 验收（hook 精准触发 + 60s timeout 兜底）

**范围**：新增 kill-resume runner 助手模块（spawn brain 子进程跑图 → **同时**订阅 LangGraph node enter/exit 事件流的 `streamMode: "updates"` 与 `streamMode: "values"` → 在指定节点完成后 SIGKILL → 同 thread_id 重新 invoke 续跑；**60s 超时回退**：未观测到 killAfterNode exit 时 stdout 输出 `KILL_TIMING_TIMEOUT` + exit 2）+ smoke 脚本 + Vitest 验收测试，断言 RESUME_OK、节点幂等（无副作用重复）、dev_records=1、brain_tasks 终态可达、timeout 不被视为合法旁路。
**大小**：M
**依赖**：Workstream 1 完成后（共享 observer 与 smoke 基础设施）

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/workflows/acceptance/kill-resume-runner.js` 模块存在并导出 `runWithKillAfterNode(opts)` 函数
  Test: node -e "const m=require('./packages/brain/src/workflows/acceptance/kill-resume-runner.js');if(typeof m.runWithKillAfterNode!=='function')process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs` smoke 脚本存在并接受 `--task-id` `--thread-id` `--kill-after-node` 三个参数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs','utf8');if(!c.includes('--task-id')||!c.includes('--thread-id')||!c.includes('--kill-after-node'))process.exit(1)"

- [ ] [ARTIFACT] kill-resume smoke 输出 `KILL_TIMING:`、`RESUME_OK`、`NO_DUPLICATE_SIDE_EFFECT`、`KILL_TIMING_TIMEOUT` 四类机器可解析标记（前三个 happy path，最后一个为 60s 超时失败路径标识）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs','utf8');if(!c.includes('KILL_TIMING')||!c.includes('RESUME_OK')||!c.includes('NO_DUPLICATE_SIDE_EFFECT')||!c.includes('KILL_TIMING_TIMEOUT'))process.exit(1)"

- [ ] [ARTIFACT] kill-resume runner 通过 LangGraph node-exit hook 触发 SIGKILL（禁止 setTimeout 时间近似作为 kill 触发器；setTimeout 仅允许用作 60s 超时兜底）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/acceptance/kill-resume-runner.js','utf8');if(!/onNodeExit|node-exit|onExit|streamMode/.test(c))process.exit(1);if(!/KILL_TIMING_TIMEOUT/.test(c))process.exit(1)"

- [ ] [ARTIFACT] kill-resume runner 同时订阅 `streamMode: "updates"` 与 `streamMode: "values"` 两路事件流（R-A mitigation：防单 streamMode 在 ganLoop 流式更新内漏 evaluate exit 信号）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/acceptance/kill-resume-runner.js','utf8');if(!/streamMode\s*:\s*['\"]updates['\"]/.test(c))process.exit(1);if(!/streamMode\s*:\s*['\"]values['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] kill-resume runner 含 60 秒超时兜底（R-A mitigation）：源码含 `60` 秒级 setTimeout 配 `KILL_TIMING_TIMEOUT` 输出与 exit 2（或 process.exit(2) / throw timeout）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/acceptance/kill-resume-runner.js','utf8');if(!/(60\s*\*\s*1000|60000)/.test(c))process.exit(1);if(!/KILL_TIMING_TIMEOUT/.test(c))process.exit(1)"

- [ ] [ARTIFACT] kill-resume runner 不修改图源码（git diff 验证）
  Test: bash -c "git diff origin/main -- packages/brain/src/workflows/harness-initiative.graph.js | wc -l | awk '{ if ($1 != 0) exit 1 }'"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/acceptance-kill-resume.test.js`，覆盖：
- runWithKillAfterNode 在 'evaluate' 节点完成后中断子进程，再用同 threadId resume，最终 task 状态 ∈ {completed, failed}
- resume 后 `dev_records` 表针对本 task_id 行数恰好为 1（节点幂等门生效，无副作用重复）
- resume 后 `brain_tasks` 子任务表中针对本 initiative 的 sub_tasks 行数 = inferTaskPlan 切出的子任务数（不重复 upsert）
- kill 由 LangGraph node-exit hook 触发（非 sleep 时间近似）：`result.killTrigger === 'node-exit-hook'` 且 `result.killNode === 'evaluate'` 且 `result.killTimingLine === 'KILL_TIMING: evaluate'`
- runWithKillAfterNode 在传入未知节点名（不在 14 节点表）时抛出 `UnknownNodeError`，避免静默通过
- **R-A timeout 行为**：runWithKillAfterNode 在 60s 内未观测到 killAfterNode exit 事件时返回 `result.timedOut === true` 且 `result.killTrigger === 'timeout'` 且 stdout 含 `KILL_TIMING_TIMEOUT` 行；测试断言不接受该路径为 happy path 等价（即 timeout 视为合同失败）
