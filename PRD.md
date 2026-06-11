# PRD — Hotfix: 修 detached spawn prompt 文件旧命名（P0 pipeline 全瘫）

## 背景

PR #3345 给 `packages/brain/src/docker-executor.js` 的 `buildDockerArgs` 引入「取证文件按运行实例唯一命名」协议：每次 spawn 生成 `runInstance`，prompt 文件写 `${taskId}.${runInstance}.prompt`，并注入容器 env `CECELIA_PROMPT_FILE` 指向同名路径。

但 `packages/brain/src/spawn/detached.js` 有一份**重复的本地 `writePromptFile`**，仍写旧命名 `${taskId}.prompt`（无 runInstance）。`spawnDockerDetached` 先用本地函数写旧名文件，再经 `buildDockerArgs` 注入新名 env → 容器 entrypoint 按 env 找新名文件 → 不存在 → claude 报 `Input must be provided either through stdin or as a prompt argument` → exit 1。

影响所有 detached spawn（planner / generator / evaluator）= harness pipeline 全瘫。生产实证：task 4795f72e 的 planner 连续两个 attempt 秒退，磁盘上 `4795f72e-….prompt`（旧名）与 `.4b797a59.stdout`（新名）并存。

## 范围

- 删除 `detached.js` 的本地 `writePromptFile` + `DEFAULT_PROMPT_DIR` 常量（消灭重复实现）。
- `spawnDockerDetached` 先调 `buildDockerArgs(opts)`，再把 `opts.prompt` 写到 `built.forensics.promptFile`（与容器 `CECELIA_PROMPT_FILE` env 共享同一 runInstance，HOST_PROMPT_DIR 解析同源）。
- 新增复现单测（mock docker spawn，断言落盘 basename == 注入 env basename）。
- 新增真实容器集成 smoke（`spawnDockerDetached` + `CECELIA_ENTRYPOINT_TEST=1` 最小容器，断言容器 stdout PROMPT_FILE 与磁盘真实文件一致）。

## 成功标准

- `detached.js` 不再含本地 `writePromptFile` / `DEFAULT_PROMPT_DIR`；prompt 落盘路径 == `buildDockerArgs.forensics.promptFile`。
- 复现单测先红（旧命名 → env-named 文件不存在）、改后转绿。
- `packages/brain/src/spawn/` 下全部 vitest 通过。
- 宿主集成 smoke 真实 spawn 容器：容器报告的 `PROMPT_FILE`（含 runInstance 后缀）与 `spawnDockerDetached` 在宿主磁盘写入的文件 basename 逐字一致、内容正确。
