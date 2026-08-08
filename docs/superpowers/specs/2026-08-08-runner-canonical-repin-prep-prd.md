# Bug PrepPRD：fleet 准入 pin 的 runner digest 与 canonical 镜像漂移，三机准入全挂致 kernel 卡死

## 症状
kernel 任务永卡 planning：admission preflight 判 all_execution_targets_exhausted，三台机器无一通过 fleet-node 准入；installer 探测 `docker image inspect <旧digest 349c40cc>` 失败 → docker.available=false → worker 装不上/更新不了。

## 根因
1. **主根因**：#4720 重建 runner 镜像时绕过 `docker/build.sh`（直接 docker build，无 cecelia.entrypoint.sha256/build.head label，未走 tar 发布链），产出 84018cb1 只存在于 us-mac-m4 本地；canonical pin（10 个代码/配置文件 + DEFINITION.md）仍指旧 349c40cc → 镜像与 pin 漂移，准入静默失效。
2. **流程缺口**：rebuild runner 镜像没有守卫强制同步 pin，漂移无人报警。
3. **次因**：install-fleet-worker.sh:87 ORBSTACK_HOME 默认 `/var/empty`，_cecelia 探测不到 OrbStack，需手动传 FLEET_WORKER_ORBSTACK_HOME。

## 关联上下文
- 任务：Brain task 65334686（TOP2 战役临门主刀）；前序 task ad270f15（#4721 刀0 观测）
- 交接单：docs/handoffs/202608082010-kernel-base-handoff.md
- 相关 PR：#4720（凭据单链）、#4721（kernel stdio 落盘）；sprint 08042132-runner-digest-repin2（建立 build.sh label + verify_runner_label 机制）

## 已完成的前置事实（本 session 验证）
- 分发链真相：**无 registry**。canonical 发布 = fleet-rollout.sh 在 us-mac-m4 `docker save` runner.tar → ssh 流式推三台 → 远端 `docker load` → reconcile 按 pin digest 校验 + verify_runner_label 校验 entrypoint label。
- 新 canonical 候选已构建并验证：`cecelia/runner:canonical-candidate = sha256:08c904ff0dc216229b84d2ce7216760fcb9968a43351916f8495265b3956bd4f`
  - 从 main HEAD aa4e45ee 用 docker/build.sh 构建，label 齐全（entrypoint.sha256=03f2cf16…与 repo 一致）
  - 全部 20 层与真机四测过的 84018cb1 逐层一致（缓存命中，内容零变化）
  - 凭据合同探针 PASS（runner-credential-contract-ok）
- 84018cb1 不能直接封 canonical：无 label，过不了 verify_runner_label（交接单警告成立且比字面更硬）。
- 西安两台 ssh 均可达（xian-m4 / xian-m1，OS 15.6.1 符合 baseline）。
- admission 严格比对 worker.version === version_policy.worker（现 pin 1.267.100）→ repin PR 必须同步 bump worker pin 到本 PR 合并后的 brain 版本，rollout 必须在该 commit 执行。

## 修法（PR 范围）
1. repin `runner_image_digest` 349c40cc → 08c904ff：node-profile.js / node-profile.test.js / config/fleet-node-profiles.json / fleet-rollout.sh + .test.sh / reconcile-fleet-node-baseline.sh + .test.sh / install-fleet-worker.test.sh / provider-neutral-phase4a-node-smoke.sh / DEFINITION.md（facts-check 校验对象）
2. version_policy.worker 同步 bump 到本 PR 版本（node-profile.js + fleet-node-profiles.json，三机同值）
3. installer ORBSTACK_HOME 默认值改为从 /var/run/docker.sock 属主自动推导（保留 FLEET_WORKER_ORBSTACK_HOME 覆盖）
4. 守卫（rebuild 必同步 pin）：docker/build.sh 构建完成后对比产出 digest 与 node-profile.js pin，不一致 loud-fail 并打印 repin 指引（proven-to-fire：用旧 pin 亲眼看它报红）

## Regression Test 计划
- failing test 先行：install-fleet-worker.test.sh 新增「ORBSTACK_HOME 默认值从 docker.sock 属主推导」用例（先红后绿，永留 CI）
- build.sh 漂移守卫用例（bats/sh test，mock docker inspect 输出）
- 既有 9 处交叉校验测试随 repin 同步更新，保持互锁

## 合并后 Ops（不在 PR 内，本 session 接着执行）
1. brain-deploy.sh 重建部署 Brain（admission 用新 pin）
2. 在合并 commit 的干净树上 CECELIA_MACHINE_ID=us-mac-m4 fleet-rollout.sh all --apply（先 us-mac-m4 单机验证再全量亦可）
3. 三机 worker health + admission 验证（getMachineHealth 全绿）
4. 重跑 kernel 验证任务（harness_runtime:kernel-v1, target_environment:playground），tail /tmp/cecelia-kernel-logs/ 确认 planner 推进过 planning

## 验收标准
- [ ] failing test 先 commit（commit-1），修复代码变绿（commit-2）
- [ ] build.sh 守卫 proven-to-fire（报红截图/日志留档）
- [ ] CI 全绿，PR 合并
- [ ] 三机 fleet-node 准入通过（admission 不再 all_execution_targets_exhausted）
- [ ] kernel 验证任务 planner 推进出 planning（日志实证）
