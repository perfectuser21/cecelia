## harness_initiative executor 未回写 tasks.status（2026-05-07）

### 根本原因

`harness_initiative` 是唯一一种在 `triggerCeceliaRun` 内**同步阻塞**跑完整 LangGraph 的任务类型。设计上没有回调机制——其他类型（Docker spawn、Codex Bridge）在容器结束后通过 `execution-callback` API 更新状态，但 `harness_initiative` 的 `compiled.invoke()` 返回后无人调 `updateTaskStatus`。

结果：`LangGraph 完成 → reportNode 写 initiative_runs → compiled.invoke() 返回 → executor 返回 { success: true } → dispatcher 只做日志 → tasks.status 永远卡 in_progress → tick loop 30min 超时自动失败 → 重新派发 → 无限循环`。

### 下次预防

- [ ] 每次实现**新的同步阻塞式 executor 路径**（非 Docker/回调），必须在函数返回前显式调 `updateTaskStatus`
- [ ] 新增 task_type 路由时，review checklist 加一条：「executor 是否有回写终态的机制（回调 or 同步 updateTaskStatus）？」
- [ ] 测试策略：同步阻塞式 executor 必须有 unit test 静态断言验证 `updateTaskStatus` 调用存在，防止遗漏
- [ ] `dispatch-now` route 对同步执行的 task_type 同样不回写，是同类风险点——下次处理同类任务时一并检查
