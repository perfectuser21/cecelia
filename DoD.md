# Contract DoD — Hotfix: 修 detached spawn prompt 文件旧命名（P0 pipeline 全瘫）

**范围**: `packages/brain/src/spawn/detached.js` 删除重复的本地 `writePromptFile`，prompt 落盘统一走 `buildDockerArgs` 返回的 `forensics.promptFile`（与注入容器的 `CECELIA_PROMPT_FILE` env 共享同一 runInstance）。新增复现单测 + 真实容器集成 smoke。
**大小**: S

> 根因：PR #3345 给 buildDockerArgs 引入 runInstance 唯一命名（写 `${taskId}.${inst}.prompt` + 注入 env 同名），但 detached.js 仍有一份旧 writePromptFile 写 `${taskId}.prompt`。容器按 env 找新名文件 → 不存在 → claude 报 "Input must be provided either through stdin or as a prompt argument" → exit 1，所有 detached spawn（planner/generator/evaluator）全瘫。

## BEHAVIOR 条目

- [x] [BEHAVIOR] detached.js 删除本地 writePromptFile/DEFAULT_PROMPT_DIR，prompt 落盘改用 built.forensics.promptFile（与容器 env 同源）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/detached.js','utf8'); if(/function\s+writePromptFile/.test(c)) process.exit(1); if(c.includes('DEFAULT_PROMPT_DIR')) process.exit(1); if(!c.includes('built.forensics.promptFile')) process.exit(1);"

- [x] [BEHAVIOR] 复现单测存在：断言磁盘写入路径 basename 与注入容器 CECELIA_PROMPT_FILE basename 逐字一致
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/__tests__/detached-prompt-naming.test.js','utf8'); if(!c.includes('CECELIA_PROMPT_FILE')) process.exit(1); if(!c.includes('spawnDockerDetached')) process.exit(1);"

- [x] [BEHAVIOR] 集成 smoke 真实 docker spawn 容器，断言容器报告 PROMPT_FILE 与宿主磁盘文件一致（含 runInstance 后缀）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/detached-prompt-naming-smoke.sh','utf8'); if(!c.includes('spawnDockerDetached')) process.exit(1); if(!c.includes('PROMPT_FILE')) process.exit(1); if(!c.includes('CECELIA_ENTRYPOINT_TEST')) process.exit(1);"
