# Design: Harness 点火路径隔离——废弃 LangGraph 兜底

## 背景

2026-07-04 主理人已拍板：harness 点火全面转向"单 session skill-relay 接力"模式（见 memory `harness-skill-relay-pivot`）。实测数据：skill-relay 3/3~4/4 merged，旧 LangGraph 图路径 30 天基线成功率仅 21.7%。

当前 `packages/brain/src/executor.js` 的 `_driveHarnessInitiative`（第 2887-2901 行）用一个 if 分支双轨并存：`payload.orchestrator === 'skill-relay'` 走新路径，否则默认 fallthrough 到 `compileHarnessFullGraph()`（LangGraph 图）。这个"缺省兜底"是隐患——任何调用方忘记带 flag，任务会悄悄退化到已验证更差的旧路径，而不会报错提醒。

## 目标

把"非 skill-relay"从一个隐式的默认路径，变成一个显式的拒绝路径。旧图代码本次不删除（保留观察期，后续单独清理）。

## 方案

**在 `_driveHarnessInitiative` 现有 if 判断前插入硬校验**：

```js
if (task?.payload?.orchestrator !== 'skill-relay') {
  await markInitiativeTerminalFailed(
    dbPool, task.id, 'missing_orchestrator_flag',
    `harness_initiative requires payload.orchestrator==='skill-relay'; got: ${task?.payload?.orchestrator ?? '(missing)'}`
  );
  return { ok: false, error: 'missing_orchestrator_flag', terminal: true };
}

// 原有 skill-relay 分支保留（此时判断恒真，但保留以维持代码可读性和最小 diff）
const { spawnSkillRelaySession } = await import('./harness-skill-relay.js');
...
```

复用既有的 `markInitiativeTerminalFailed` 失败模式（`executor.js:2820-2838`），和现有 `MAX_INITIATIVE_FRESH_STARTS` 超限分支（`executor.js:2914-2919`）完全同构：同样的 helper、同样的返回值形状 `{ ok:false, error, terminal:true }`，与调用方 `executeTask`（`executor.js:3254-3282`）按 `result.ok` 三态处理的既有契约兼容，不需要改调用方。

`compileHarnessFullGraph()` 及 `harness-initiative.graph.js` 整个文件本次不删除、不修改——它变成代码里的死路径（无调用点能到达），保留供观察期后续物理清理。

## 必须同步的调用点（防止新校验把自己人挡死）

硬校验一旦生效，所有创建 `task_type=harness_initiative` 任务但没带 `orchestrator:'skill-relay'` 的调用方都会被拒绝。逐一核对：

1. **`packages/engine/skills/dev/SKILL.md`（第 305-322 行，路径 C 点火 curl 模板）**——这是 `/dev` 的唯一正常触发入口，当前 payload 没有 `orchestrator` 字段，必须加 `"orchestrator": "skill-relay"`，否则主入口自锁。
2. **`packages/brain/scripts/smoke/dispatcher-real-paths.sh`**（`register_task` 调用）——需要确认拼的 payload 是否带 flag，缺则补上。
3. **`packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh`**——同上，需要核对 JSON body。
4. **`packages/brain/scripts/smoke/reportnode-task-writeback-smoke.sh`**——直接 `psql INSERT INTO tasks`，不经过 API payload 校验层，需要确认这个 smoke 测的是 executor 直接读 DB 行为，若测的是 report 阶段（发生在 orchestrator 分流之后），可能不受影响；若测的是完整流程需要同步加 payload。

以上三个 smoke 脚本需要实现阶段实际打开确认，不能只凭 grep 结果假设。

## 测试策略

- **单元测试**（新增）：照抄 `packages/brain/src/__tests__/harness-max-fresh-starts.test.js` 的 mock 骨架（mock `../db.js` / `../task-updater.js` / `../task-router.js` / `../task-type-config-cache.js` / `../trace.js` / `../event-bus.js`），构造两类 task：
  - `payload.orchestrator` 缺失或为其他值 → 断言 `markInitiativeTerminalFailed` 效果生效（`updateTaskStatus`/DB 更新被调用，`failure_class='missing_orchestrator_flag'`），断言 `compileHarnessFullGraph` 未被 import/调用，返回值 `{ok:false, terminal:true}`。
  - `payload.orchestrator === 'skill-relay'` → 行为不变，仍正常调用 `spawnSkillRelaySession`。
- **静态断言测试**（可选，参考 `executor-harness-initiative-default-fullgraph.test.js` 的 `fs.readFileSync` + 字符串匹配模式）：确认硬校验的 if 语句确实存在于 `_driveHarnessInitiative` 内、且位于 `compileHarnessFullGraph` import 之前。
- **CI smoke**：核对第 4 节列出的三个 smoke 脚本，缺 flag 的补上，避免 CI 先挂。

这是纯逻辑接缝（task payload 校验 + 分支路由），regression test 即可覆盖，不需要环境类自检守卫。

## 影响范围与不做的事

- 不删除 `harness-initiative.graph.js` / `compileHarnessFullGraph` 代码，只让它不可达。
- 不改动 `runHarnessInitiativeRouter`（外层并发互斥包装）和 `executeTask`（外层路由），因为返回值契约不变，两者无需改动。
- 不改 `harness-skill-relay.js` 内部实现。

## 验收标准

- [ ] 不带 `orchestrator` 或 `orchestrator !== 'skill-relay'` 的 `task_type=harness_initiative` 任务被拒绝：task 状态标记 `failed`，`failure_class='missing_orchestrator_flag'`，返回 `{ok:false, terminal:true}`
- [ ] 带 `orchestrator: 'skill-relay'` 的任务行为不变，正常走 `spawnSkillRelaySession`
- [ ] `/dev` SKILL.md 路径 C 的 curl 模板已同步加 `orchestrator` 字段
- [ ] 三个相关 smoke 脚本已核对/同步
- [ ] 新增 regression test 覆盖拒绝分支 + 正常分支
- [ ] CI 全绿
