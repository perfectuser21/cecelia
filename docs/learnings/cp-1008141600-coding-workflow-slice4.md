## coding workflow 第四刀：执行机 runner 自动认领带开关的任务（2026-10-08）

### 根本原因

- 前三刀的 coding 链只能手工喂信封跑，Brain 任务与执行机之间没有"谁来认领、在哪跑、跑完怎么收账"的接线；现有 dev 类任务会被 Work Router 改道进 kernel 流水线，不能直接复用。
- Brain 的 `PATCH /tasks/:id` 状态机只允许 queued→in_progress→completed/failed：认领后若 in_progress 写不进去，任务就无法再转 failed（queued→failed 不合法），只能停在"已认领的 queued"。
- 执行器的 `--receipt` 文件是进度快照与终态共用的：同一任务重跑时，上一次的终态回执会在本次崩溃时被误读成结果。
- bash 双引号里 `$VAR` 紧跟全角标点（如 `$DEST：`）会被当成变量名的一部分，`set -u` 下直接 unbound variable。
- 新 feat PR 只要触及 packages/brain/src（哪怕只改一个名单数组），lint-feature-has-smoke 就要求新增 scripts/smoke/*.sh。

### 下次预防

- [ ] 新执行面接 Brain 任务一律用显式开关（payload 字段）+ 不被 tick 派发的 task_type，不改既有路由
- [ ] 认领后第一时间置 in_progress，失败即不开跑；之后任何异常都走"尽力回写 failed"的单一出口
- [ ] 执行器启动前删除旧回执文件；只认 stdout 终态或无 last_event 的终态文件
- [ ] shell 脚本里变量后接中文标点一律写 `${VAR}`
- [ ] 改 brain/src 的 feat PR 提前规划 smoke.sh（真实运行被改链路，不写空架子）
