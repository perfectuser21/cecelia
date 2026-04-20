# Harness v2 Phase Advancer

### 根本原因

Harness v2 `initiative_runs.phase` 定义了 A_contract/B_task_loop/C_final_e2e 三态，但没有代码推进——合同 approved 后不会进 B，所有子 Task completed 后也不会调 `runPhaseCIfReady`。runner 只做一次性入口动作；Phase 推进器空缺，Initiative 从 Planner 完成后永远卡在 A_contract。

### 下次预防

- [ ] 设计状态机必须同时设计"推进器"（谁在什么时机转移状态），不只定义状态枚举
- [ ] 任何后台 tick 钩子都要跑"异常隔离"（单 run 抛错不能污染其他 run）+"tick 重叠防御"（updated_at 窗口过滤）
- [ ] 推进器必须全部 DI 可测（`nextRunnableTask` / `checkAllTasksCompleted` / `runPhaseCIfReady` 都暴露依赖注入）
- [ ] 新增 tick hook 一律 dynamic import + try/catch 包裹，避免启动时依赖加载失败 kill tick
