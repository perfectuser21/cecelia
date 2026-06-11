contract_branch: cp-06111642-ws-cf9ce514-ws1
sprint_dir: sprints/06111555-forensics-no-overwrite-r2

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Agent 取证文件按运行实例唯一命名（防覆盖 R2）

**范围**: spawn 侧（docker-executor.js / host-executor.js）三类取证路径（prompt/stdout/cid）按运行实例唯一命名；entrypoint.sh 按注入 env（CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE）读完整文件名、缺失回退旧拼接；新增 host-docker post-deploy smoke。
**大小**: M

> 被测真实系统 = 仓库真实文件本身（`packages/brain/src/docker-executor.js` 的 `__test__` 导出 + `docker/cecelia-runner/entrypoint.sh` 当 bash 跑），无 mock/stub/副本。本能力无 HTTP 表面，故不 curl localhost:5221；真实容器闭环下沉 post-deploy smoke（evaluator 无 docker）。每条 [BEHAVIOR] 1:1 对应一个 Golden Path 步骤，未实现则真红 FAIL。

## ARTIFACT 条目

- [ ] [ARTIFACT] post-deploy smoke `forensics-no-overwrite-smoke.sh` 存在且为真实 host-docker spawn（非环境占位）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh','utf8'); if(!/docker run|docker[^\n]*spawn|executeInDocker/.test(c)) process.exit(1); if(!c.includes('.prompt')) process.exit(1);"

- [ ] [ARTIFACT] host-executor.js prompt 取证路径按运行实例唯一（去掉裸 `${taskId}-host.prompt` 覆盖写法）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/host-executor.js','utf8'); if(c.includes('\`${taskId}-host.prompt\`')) process.exit(1); if(!/randomBytes|runInstance|\.host\.|-host\.\$\{/.test(c)) process.exit(1);"

- [ ] [ARTIFACT] entrypoint.sh 含 env-优先解析（CECELIA_PROMPT_FILE + CECELIA_STDOUT_FILE）+ 旧拼接回退表达式
  Test: node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8'); if(!c.includes('CECELIA_PROMPT_FILE')) process.exit(1); if(!c.includes('CECELIA_STDOUT_FILE')) process.exit(1); if(!c.includes('CECELIA_ENTRYPOINT_TEST')) process.exit(1); if(!/cecelia-prompts\/\$\{CECELIA_TASK_ID/.test(c)) process.exit(1);"

## BEHAVIOR 条目（内嵌可执行 manual:bash，evaluator 直接跑；journey_type=autonomous，测真实模块/脚本，无 docker）

- [ ] [BEHAVIOR] Golden Path Step 1 — 同一 taskId 写两次 prompt 取证，两组文件并存、第一组不被覆盖
  Test: manual:bash -c 'node sprints/06111555-forensics-no-overwrite-r2/tests/check-step1-no-overwrite.mjs'
  期望: exit 0 + "OK step1"

- [ ] [BEHAVIOR] Golden Path Step 2 — ls | grep <taskId 前缀> 两组取证文件均可检索（批量清理习惯不破坏）
  Test: manual:bash -c 'bash sprints/06111555-forensics-no-overwrite-r2/tests/check-step2-prefix-retrieval.sh'
  期望: exit 0 + "OK step2"

- [ ] [BEHAVIOR] Golden Path Step 3a — entrypoint 注入 CECELIA_PROMPT_FILE + CECELIA_STDOUT_FILE 时两者均采用注入的唯一文件（非旧拼接，prompt+stdout 双验）
  Test: manual:bash -c 'bash sprints/06111555-forensics-no-overwrite-r2/tests/check-step3-entrypoint-resolve.sh priority'
  期望: exit 0 + "OK step3/priority: entrypoint 采用注入的唯一文件（prompt+stdout）"

- [ ] [BEHAVIOR] Golden Path Step 3b（边界·向后兼容）— env 缺失时 entrypoint 回退旧拼接 <taskId>.prompt 和 <taskId>.stdout
  Test: manual:bash -c 'bash sprints/06111555-forensics-no-overwrite-r2/tests/check-step3-entrypoint-resolve.sh fallback'
  期望: exit 0 + "OK step3/fallback"

- [ ] [BEHAVIOR] Golden Path Step 4 — docker run 三类路径（prompt/stdout/cid）共享同一实例后缀且跨 spawn 唯一
  Test: manual:bash -c 'node sprints/06111555-forensics-no-overwrite-r2/tests/check-step4-docker-args-suffix.mjs'
  期望: exit 0 + "OK step4"
