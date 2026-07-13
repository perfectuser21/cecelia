# golden_path_proposal 任务补 orchestrator=skill-relay

## 问题
`executor.js:3219` 把 `golden_path_proposal` 和 `harness_initiative` 并列走同一个 `runHarnessInitiativeRouter` → `_driveHarnessInitiative`。该函数（`executor.js:2958`）硬校验 `payload.orchestrator === 'skill-relay'`，不满足直接 `markInitiativeTerminalFailed`。

`golden-paths.js` 的 `/select`（约162-173行）与 `/approve`（约233-249行）两处 `INSERT INTO tasks` 建 `golden_path_proposal` 任务时，payload 都只写了 `{golden_path_id, title, one_liner, ...}`，缺 `orchestrator` 字段，导致任务派发后立即 terminal failed。GP 模式 2026-07-12 上线以来首次真实调用 `/select` 才暴露（此前 6 条 candidate 从未被 select 过）。

## 修复范围
- `/select` 建任务的 payload 对象加 `orchestrator: 'skill-relay'`
- `/approve` 建任务的 payload 对象加 `orchestrator: 'skill-relay'`
- 不改 `executor.js` 硬校验逻辑本身（该校验是对的，07-05 拍板，问题在上游漏传）

## 测试策略
Integration test（真实 pool，golden-paths 路由已有测试文件模式）：POST `/select` 一条 candidate 状态的 golden_path，断言创建出的 task 的 `payload.orchestrator === 'skill-relay'`；同样对 `/approve`（从 converged 状态）断言一次。纯逻辑接缝（JSON 拼装是否带某字段），CI test 即可，不需要环境自检/运行时自检。

## 不包含
- 不改状态机流转规则
- 不改其他 task_type 的 payload 拼装
- 不处理已经 failed 的历史任务（`8405972e`）的自动重试机制——修复后手动重新走一次 select 验证即可，不需要专门的重试/恢复功能
