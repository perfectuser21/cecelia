---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: kill-resume on 14-node graph 验收

**范围**：新增 kill-resume runner 助手模块（spawn brain 子进程跑图 → 在指定节点完成后 SIGKILL → 同 thread_id 重新 invoke 续跑）+ smoke 脚本 + Vitest 验收测试，断言 RESUME_OK、节点幂等（无副作用重复）、dev_records=1、brain_tasks 终态可达。
**大小**：M
**依赖**：Workstream 1 完成后（共享 observer 与 smoke 基础设施）

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/workflows/acceptance/kill-resume-runner.js` 模块存在并导出 `runWithKillAfterNode(opts)` 函数
  Test: node -e "const m=require('./packages/brain/src/workflows/acceptance/kill-resume-runner.js');if(typeof m.runWithKillAfterNode!=='function')process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs` smoke 脚本存在并接受 `--task-id` `--thread-id` `--kill-after-node` 三个参数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs','utf8');if(!c.includes('--task-id')||!c.includes('--thread-id')||!c.includes('--kill-after-node'))process.exit(1)"

- [ ] [ARTIFACT] kill-resume smoke 输出 `RESUME_OK` 与 `NO_DUPLICATE_SIDE_EFFECT` 两行机器可解析标记
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs','utf8');if(!c.includes('RESUME_OK')||!c.includes('NO_DUPLICATE_SIDE_EFFECT'))process.exit(1)"

- [ ] [ARTIFACT] kill-resume runner 不修改图源码（git diff 验证）
  Test: bash -c "git diff origin/main -- packages/brain/src/workflows/harness-initiative.graph.js | wc -l | awk '{ if ($1 != 0) exit 1 }'"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/acceptance-kill-resume.test.js`，覆盖：
- runWithKillAfterNode 在 'evaluate' 节点完成后中断子进程，再用同 threadId resume，最终 task 状态 ∈ {completed, failed}
- resume 后 `dev_records` 表针对本 task_id 行数恰好为 1（节点幂等门生效，无副作用重复）
- resume 后 `brain_tasks` 子任务表中针对本 initiative 的 sub_tasks 行数 = inferTaskPlan 切出的子任务数（不重复 upsert）
- runWithKillAfterNode 在传入未知节点名（不在 14 节点表）时抛出 `UnknownNodeError`，避免静默通过
