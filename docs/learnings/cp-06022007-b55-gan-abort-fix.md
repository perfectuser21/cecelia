# Learning: B55 — GAN Abort 传播 + initiative_runs 早建

### 根本原因
1. OPEN-5: `runGanLoopNode` catch 只 return error，没更新 `tasks.status`，zombie-reaper 又豁免 harness → 失败任务永远 in_progress
2. OPEN-6: `initiative_runs` INSERT 在 `dbUpsertNode`（GAN 成功后），GAN abort → 无 run 记录 → 监控看不见

### 下次预防
- [ ] GAN abort / 任何 critical node catch 必须在 catch 块内 UPDATE tasks.status，不依赖上层
- [ ] initiative_runs 应在 pipeline 最早期（prep 节点）建立，tracking 与 outcome 解耦
- [ ] 新增 pipeline 节点时，先问：「这个 catch 会不会造成 task 永远 in_progress」
- [ ] DEFINITION.md 的 Brain 版本号在每次 brain-deploy 后同步更新（否则 facts-check 失败）
