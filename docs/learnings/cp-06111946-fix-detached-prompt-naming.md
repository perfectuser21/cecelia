# Learning — 修 detached spawn prompt 文件旧命名（P0 pipeline 全瘫）

分支：cp-06111946-fix-detached-prompt-naming
日期：2026-06-11

### 根本原因

PR #3345 给 `buildDockerArgs`（docker-executor.js）引入「取证文件按运行实例唯一命名」协议：
每次 spawn 生成 `runInstance`，prompt 写 `${taskId}.${runInstance}.prompt`，并注入容器 env
`CECELIA_PROMPT_FILE` 指向同名路径。但**只改了 `executeInDocker` 这一个调用方**，漏掉了
`spawn/detached.js`——它有一份**重复的本地 `writePromptFile`**，仍写旧命名 `${taskId}.prompt`。

`spawnDockerDetached` 的执行顺序是：
1. 本地 `writePromptFile` 写旧名文件 `${taskId}.prompt`（磁盘上是旧名）；
2. `buildDockerArgs` 生成新 runInstance，注入 env `CECELIA_PROMPT_FILE=…/${taskId}.${inst}.prompt`（容器要读新名）。

容器 entrypoint `[[ -f "$PROMPT_FILE" ]]`（PROMPT_FILE 取自 env，是新名）为假 → 落到无 prompt 的
`claude … "$@"` 分支 → claude 报 `Input must be provided either through stdin or as a prompt
argument` → exit 1。所有 detached spawn（planner/generator/evaluator）全瘫。生产实证：task
4795f72e 的 planner 连续两个 attempt 秒退，磁盘 `4795f72e-….prompt`（旧名）与 `.4b797a59.stdout`
（新名）并存——一眼可见两套命名打架。

**本质：同一协议有两份独立实现（docker-executor 的 writePromptFile + detached 的 writePromptFile），
改协议时只改了一份。重复实现是定时炸弹。**

### 修复

- 删除 `detached.js` 的本地 `writePromptFile` 与 `DEFAULT_PROMPT_DIR` 常量。
- `spawnDockerDetached` 先调 `buildDockerArgs(opts)`，再把 `opts.prompt` 写到 `built.forensics.promptFile`
  ——这是 runInstance 的唯一来源（SSOT），与注入容器的 `CECELIA_PROMPT_FILE` env basename 逐字一致，
  HOST_PROMPT_DIR 解析也同源（不再复制常量）。
- detached 路径本就不写 cidfile（`--cidfile` 被剥离），无独立 cid 逻辑需要对齐。
- 复现单测（mock docker spawn）先红后绿；真实容器集成 smoke 端到端验证。

### 下次预防

**协议改动必须 grep 全部调用方，重复实现是定时炸弹。**

- [ ] 改任何「文件命名 / env 注入 / 路径解析」协议时，先 `grep -rn` 整个仓库找出所有写该类文件的地方
      （`writePromptFile`、`.prompt`、`CECELIA_PROMPT_FILE` 等），逐个核对，不能只改"我正在看的那个函数"。
- [ ] 同一职责（写 prompt 取证文件）只允许一份实现。发现第二份立即合并/删除，落盘路径统一由
      `buildDockerArgs.forensics` 返回，调用方禁止自拼文件名。
- [ ] spawn 路径有两条（阻塞 `executeInDocker` + detached `spawnDockerDetached`），二者共享
      `buildDockerArgs`；任何改 buildDockerArgs 契约的 PR 必须同时验证两条路径（单测覆盖 detached）。
- [ ] 取证/命名类协议改动，post-deploy 必须有真实容器 smoke 断言"容器要读的路径 == 宿主真实写的路径"，
      不能只靠静态文件断言假绿。
