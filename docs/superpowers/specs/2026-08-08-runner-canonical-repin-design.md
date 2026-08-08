# 设计：runner 镜像 canonical 发布链修复（digest repin + 漂移守卫 + installer 推导）

任务：Brain task 65334686 ｜ 决策：6c74f34f ｜ PrepPRD：docs/superpowers/specs/2026-08-08-runner-canonical-repin-prep-prd.md

## 问题

#4720 重建 runner 镜像时绕过 `docker/build.sh`，产出无 label 的 84018cb1 且未走 tar 发布链分发；canonical pin 仍指旧 349c40cc。fleet 三机准入全挂（installer `docker image inspect <旧digest>` 失败 → docker.available=false），kernel 永卡 planning（all_execution_targets_exhausted）。

## 已验证前提（本 session 实证）

- 系统**无 registry**：canonical 发布链 = `fleet-rollout.sh`（us-mac-m4 控制机）`docker save` → ssh 推三台 → `docker load` → reconcile 按 pin 校验 digest + `verify_runner_label` 校验 entrypoint label。
- 新 canonical 候选：`cecelia/runner:canonical-candidate = sha256:08c904ff0dc216229b84d2ce7216760fcb9968a43351916f8495265b3956bd4f`——从 main HEAD aa4e45ee 经 build.sh 构建，label 齐（entrypoint.sha256=03f2cf16 与 repo 一致），全部 20 层与真机四测过的 84018cb1 逐层相同（缓存全命中），凭据合同探针 PASS。
- 西安两台 ssh 可达，OS 15.6.1 合 baseline。
- admission 严格比对 `worker.version === version_policy.worker`；worker 上报版本来自 `node-probe.cjs DEFAULT_WORKER_VERSION`（非 package.json）。

## 变更设计

### A. digest repin（一次性、全互锁点）

`349c40cc…` → `08c904ff0dc216229b84d2ce7216760fcb9968a43351916f8495265b3956bd4f`，共 11 处：

1. `packages/brain/src/orchestrator/fleet-node/node-profile.js`（CANONICAL_BASELINE.runner_image_digest）
2. `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
3. `packages/brain/config/fleet-node-profiles.json`（三机各一处）
4. `packages/brain/scripts/fleet-worker/fleet-rollout.sh`
5. `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh`
6. `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh`（RUNNER_DIGEST）
7. `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh`
8. `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
9. `packages/brain/scripts/smoke/provider-neutral-phase4a-node-smoke.sh`
10. `DEFINITION.md`（facts-check 校验对象）
11. （worker 版本联动，见 B）

### B. worker 版本 pin 同步 bump

本 PR 按 semver bump brain 版本（check-version-sync.sh 的四处），并把以下三组 pin 同步到该新版本号：
- `node-profile.js` version_policy.worker（1.267.100 → 新版本）
- `config/fleet-node-profiles.json` 三机 version_policy.worker
- `node-probe.cjs` DEFAULT_WORKER_VERSION

约束：rollout 必须在本 PR 合并 commit 上执行（后续 PR 再 bump 版本会重新漂移——这正是守卫 C 要看住的常态）。

### C. 漂移守卫（rebuild 必同步 pin，proven-to-fire）

新增 `docker/verify-digest-pin.sh`：
- 输入：镜像 tag（默认 cecelia/runner:latest）
- 读 `node-profile.js` 的 pin digest，`docker image inspect` 读实际 Id，不一致 → exit 3，打印新 digest + 全部 pin 文件清单 + repin 指引
- `docker/build.sh` 构建完成后调用它；合法 repin 流程 = 构建见红 → 更 pin → 重跑 build（缓存秒回）见绿
- proven-to-fire：实现时先用旧 pin 亲眼看它报红（记录在 PR）

### D. pin 互锁一致性测试（防局部 repin）

新增 `packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh`（CI glob 自动接线）：
- 断言上述全部 pin 文件中的 runner digest 字符串完全一致（以 node-profile.js 为基准）
- 断言 node-probe.cjs DEFAULT_WORKER_VERSION === node-profile.js version_policy.worker === fleet-node-profiles.json 三机 worker
- 纯 grep/文本断言，CI 可跑，无需 docker

### E. installer ORBSTACK_HOME 自动推导

`install-fleet-worker.sh:87` 默认值推导链（保留 env 覆盖）：
1. `FLEET_WORKER_ORBSTACK_HOME`（显式覆盖，最高优先）
2. `/var/run/docker.sock` 存在 → `stat -f %Su` 取属主（拒 root/_cecelia）→ `/Users/<owner>`
3. `SUDO_USER`（非 root/_cecelia）→ `/Users/$SUDO_USER`
4. 兜底 `/var/empty`（现状）

注：rollout 正链（reconcile→installer）已显式传 FLEET_WORKER_ORBSTACK_HOME，本修复只救手动直跑 installer 的路径。

## 测试策略

- **unit（.test.sh，CI glob 自动接线）**：
  - E 的推导逻辑——install-fleet-worker.test.sh 新增用例，TDD 先红后绿（regression test，永留 CI）
  - C 的守卫——mock docker inspect，断言 match=0 / mismatch=exit 3
  - D 的互锁一致性测试（新增当日即防住"漏改一处"）
- **既有测试同步**：9 处交叉校验测试随 repin 更新（属 A 范围）
- **integration**：既有 fleet-worker 测试套不回归
- **E2E（合并后 ops，非 CI）**：brain 部署 → fleet-rollout all --apply → 三机 admission 全绿 → kernel 验证任务 planner 推进出 planning（tail /tmp/cecelia-kernel-logs/）

## 不做

- 不动 GAN/kernel 编排逻辑（刀1 kernel 逃出 Brain 容器另立任务）
- 不建 registry（tar 链即正式渠道，够用且已被 08042132 sprint 加固）
- 不改 reconcile/nodectl 的校验逻辑（它们是对的，问题在源头流程）
