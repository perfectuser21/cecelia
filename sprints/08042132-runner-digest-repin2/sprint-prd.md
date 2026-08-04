# Sprint PRD: Runner digest 二次重钉

**任务**: hotfix: Runner digest二次重钉——替换毒镜像pin为main构建镜像+构建来源label守卫  
**Task ID**: 93161b22-9478-4695-b3e2-a01eddce78f8  
**gear**: hotfix  
**journey_type**: fix  
**target_environment**: local_api

---

## 根因（已实锤，勿重查）

当前 pin 的 `sha256:5c202d56e8697fff18d12733fc5d44aef8edf1949f2a90ddc537ff67e2b15465` 是 08-04 15:57 在过时 worktree（7月29日代码）构建的镜像，其 entrypoint 缺 Phase 4C github-credential-envelope FIFO 消费端（实测 grep credential 仅5处 vs main 44处）。fleet attempt 的 writeGitHubCredential 写 FIFO 无读者 → 60s 超时 → `attempt_github_credential_fifo_write_failed` → `remote_bridge_start_http_500`。r20-r26 七轮全灭同此因。

## 修法（照 PR #4613 先例，机械替换）

好镜像已在本机构建完成：`sha256:ae2eaabba48301fa0820b0fd92054f561b0faf9837f1cb0fca874a34690bfcd3`  
来源：origin/main@bdbf09ab5 干净 worktree 构建，entrypoint 消费端 138 处已验证。

把旧 digest 全量替换为新 digest，涉及文件（以 git grep -l 5c202d56 实际结果为准）：
- `packages/brain/src/orchestrator/fleet-node/node-profile.js` — CANONICAL_BASELINE
- `packages/brain/src/orchestrator/fleet-node/node-profile.test.js` — EXPECTED_RUNNER_DIGEST
- `packages/brain/config/fleet-node-profiles.json` — 三机 us-mac-m4/xian-mac-m4/xian-mac-m1
- `packages/brain/scripts/fleet-worker/fleet-rollout.sh` — RUNNER_DIGEST
- `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh` — expected_runner_digest
- `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh` — RUNNER_DIGEST
- `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh`
- `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- `packages/brain/scripts/smoke/provider-neutral-phase4a-node-smoke.sh`
- `DEFINITION.md` — 历史条目不动，只追加新条目（含毒镜像原因一句话）
- Brain 版本 bump（1.267.215 → 1.267.216）

新增防复发机制（TDD）：
- `docker/build.sh` 增加 `--label cecelia.build.head=<git-HEAD>` 和 `--label cecelia.entrypoint.sha256=<sha256>` 到构建命令
- `packages/brain/scripts/fleet-worker/fleet-rollout.sh` 增加 `verify_runner_label` 函数——docker inspect 检查 `cecelia.entrypoint.sha256` 与 repo 内 `docker/cecelia-runner/entrypoint.sh` 实际 sha256 一致，不一致 loud-fail
- TDD：先写 failing test（当前无 label → 函数不存在 → 测试红），实现后绿，proven-to-fire

## 锚定声明

1. 全仓 `git grep 5c202d56` 仅剩 `DEFINITION.md` 历史条目与 `docs/handoffs/` 历史文档（不出现在任何可执行路径）
2. `fleet-rollout.sh` 含 `verify_runner_label` 函数；已有 failing test 在实现前跑红、实现后跑绿（proven-to-fire）
3. `docker/build.sh` 在构建时写入 `cecelia.entrypoint.sha256` label（包含 entrypoint.sh 的 sha256）
4. `verify_runner_label` 检查 label 中 sha256 与 repo 内 `docker/cecelia-runner/entrypoint.sh` 实际 sha256 一致，不一致 loud-fail
5. Brain 版本同步 bump（package.json / package-lock.json / .brain-versions 三处）
6. CI 全绿

## NFR

N/A（无性能/安全/并发 NFR，纯配置数据更正 + 机制守卫）
