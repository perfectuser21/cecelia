# Bug PrepPRD：harness generator/fix 节点缺 mac_web 宿主逃逸（真 run 阻断）

## 症状
target_environment=mac_web 的 harness initiative 点火后，generator（spawnNode）无条件走 docker 容器派发。容器内无真实浏览器，generator 跑 Playwright 自验跑不通；evaluator 永远 FAIL → 进 fix loop，fix 也走 docker 同样跑不通 → 空转烧轮次，run 永远到不了 merge/staging/promote。

唯一做了 mac_web→宿主 ssh 逃逸的是 evaluate_contract 节点（harness-task.graph.js 约行 1284，`executeOnHost`）。spawnNode（约行 199）和 fix（复用 spawnNode）没有这条分支。

## 根因假设
- spawnNode 设计为 detached docker spawn + 写 thread_lookup + awaitCallbackNode interrupt 等 callback router 唤回（两段式异步）。
- mac_web 物理上必须在宿主 Mac 跑（要真实浏览器 + localhost:5174/5221 直达），不能进无浏览器容器。
- spawnNode 从未实现 host 同步分支 → mac_web generator 走错执行器。

## 关联上下文
- 相关 Journey：Cecelia Harness Pipeline（唯一内部线）
- 相关历史决策：decision b60b4404（本次）；harness-host-executor-ssh-escape（evaluator 已修，PR #3441）
- 审计来源：2026-06-27 20-agent 深度审计「执行层环境错配」根因 #3；handoff docs/harness-pipeline-handoff-2026-06-27-slices.md Slice 4

## 修法
1. **抽共享 helper `extractTargetEnv(state, payload)`**（纯函数 SSOT）：消除 spawnNode 与 evaluate_contract 两处 target_environment 提取漂移。逻辑同现有行 1112-1114（prdContent 正则 → payload → 'local_api'）。
2. **抽共享 helper `buildHostLocalEnv(baseEnv, containerId)`**：返回 host 专用 env 覆盖（BRAIN_URL=http://localhost:5221 / HARNESS_CALLBACK_URL=localhost / DB=postgresql://localhost/cecelia）。evaluate_contract host 分支（行 1294-1299）与 generator host 分支共用。
3. **spawnNode 加 mac_web 同步 host 分支**（在 resolveExecutor/spawnFn 派发之前、prompt/env/worktree 就绪后）：
   - `targetEnv === 'mac_web'` → 同步 `executeOnHost({ task, prompt, worktreePath, env: buildHostLocalEnv(generatorEnv, finalContainerId) })`。
   - 成功（exit_code===0）→ return `{ containerId, worktreePath, githubToken, generator_output: hostResult.stdout, spawnedAt, executor:'claude', accountId }`。`generator_output` 命中 awaitCallbackNode 已有幂等门 `if (state.generator_output) return passthrough` → 自动跳过 interrupt → 直接进 parse_callback。**无需改 graph 边**（routeAfterSpawn 只看 state.error）。
   - 失败（exit_code!==0 / timed_out）→ return `{ containerId, ci_status:'fail', ci_fail_type:'container_exit', failed_checks:[detail] }`。
4. **awaitCallbackNode 幂等门扩展**：开头加 `if (state.ci_status === 'fail') return { ci_status, ci_fail_type, failed_checks }`（在 generator_output 幂等门之前），让 host 同步失败也 passthrough 不死等 interrupt → routeAfterCallback 走 fix_dispatch 重试。

> 不动 host-executor.js：DEFAULT_HOST_SSH_KEYS（firstExisting 自动选实际存在的 id_rsa，id_ed25519 不存在但被跳过）+ PATH/timeout 已由 P1#4 审计 #3445 修好且 evaluator 用它跑通。本 slice 聚焦 spawnNode，避免无谓 churn。

## Regression Test 计划（配对并入 `__tests__/harness-task.graph.test.js`）
1. `extractTargetEnv`：prdContent 含 `## target_environment: mac_web` → 'mac_web'；无 → payload → 'local_api' 默认。（纯函数）
2. spawnNode(targetEnv=mac_web)：注入 `opts.executeOnHost` mock（return exit_code:0, stdout:'PR_URL=...'）→ 断言调了 executeOnHost **而非** spawnDetached，且返回 `generator_output` === stdout。
3. spawnNode(targetEnv=mac_web) host 失败（exit_code:1）→ 断言返回 `ci_status:'fail'`、`ci_fail_type:'container_exit'`，**不**带 generator_output。
4. spawnNode(targetEnv=local_api / 缺省)：断言仍走 spawnDetached（docker 路径不回归）。
5. awaitCallbackNode：state.ci_status==='fail' 时 passthrough 返回 ci_status，不调 interrupt。

> 守卫种类：逻辑接缝（graph 节点路由 + 纯函数）→ CI regression test 足够。真机 ssh 逃逸接缝由 evaluator 已有 PR #3441 守卫覆盖，本 slice 复用同一 executeOnHost。

## 验收标准
- [ ] failing test 先 commit（commit-1，含真 it/expect，红）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] DevGate 全过（facts-check / check-version-sync / check-dod-mapping）+ Brain 版本 4 处同步 bump
- [ ] CI 全绿
