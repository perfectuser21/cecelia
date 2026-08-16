---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: Fleet Runner run 级双容器（工作容器常驻 + 干净评估容器）

**范围**: `packages/brain/scripts/fleet-worker/{attempt-runner,fleet-worker,workspace-manager}.cjs` run 级容器生命周期 + 候选 quarantine bundle/干净 clone；`packages/brain/src/orchestrator/fleet-node/node-profile.js` per-run 容量；DB container_id 持久化；feature flag FLEET_RUN_SCOPED_CONTAINER；Brain semver + DevGate 同步。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] attempt-runner 暴露 run 级工作容器命名入口（含 flag 回退）
  Test: node -e "const c=require('/workspace/packages/brain/scripts/fleet-worker/attempt-runner.cjs');if(typeof c.deriveRunContainerName!=='function')process.exit(1)"

- [ ] [ARTIFACT] workspace-manager 暴露候选 bundle + 干净 clone 入口
  Test: node -e "const s=require('fs').readFileSync('/workspace/packages/brain/scripts/fleet-worker/workspace-manager.cjs','utf8');if(!/bundleCandidate/.test(s)||!/cloneFromBundle/.test(s))process.exit(1)"

- [ ] [ARTIFACT] Brain semver bump（package.json 版本 > 1.273.60）
  Test: node -e "const v=require('/workspace/packages/brain/package.json').version.split('.').map(Number);const b=[1,273,60];const gt=v[0]>b[0]||(v[0]===b[0]&&(v[1]>b[1]||(v[1]===b[1]&&v[2]>b[2])));if(!gt)process.exit(1)"

- [ ] [ARTIFACT] 版本四处同步（package.json/package-lock/.brain-versions/DEFINITION.md）
  Test: manual:bash -c 'cd /workspace && bash scripts/check-version-sync.sh'

## BEHAVIOR 条目（五行剧本，evaluator 逐条真实执行；L2=真实模块 docker CLI 注入桩）

- [ ] [BEHAVIOR] [L2] B-01: 同 run 连续两 attempt 复用同一工作容器，不同 run 不同容器
  动作: 单测用注入 docker 桩，对同一 run_id 连续 prepare 两个 attempt，再对另一 run_id prepare 一个 attempt
  预期观察: 同 run 第一个 attempt 触发 docker create `cecelia-fleet-run-<run8>`，第二个走 exec 不再 create；两 attempt 得到同一 container_id；不同 run → 不同容器名
  等待预算: 0s
  留证: vitest -t 'B-01' 输出末 20 行（含 passed 计数）进 behavior_tests.log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "B-01" 2>&1); echo "$OUT" | tail -20; echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-02: run 终态销毁工作容器，kernel 重启后 reconcile 按 run_id 找回不新建
  动作: 单测触发 run 终态（done/failed/cancelled）与「重启后 reconcile」两条路径
  预期观察: 终态时对 `cecelia-fleet-run-<run8>` 执行且仅一次 docker rm -f；reconcile 按 run_id + label `cecelia.run_id` 命中既有容器，create 调用数=0（不新建、不蒸发候选）
  等待预算: 0s
  留证: vitest -t 'B-02' 输出末 20 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "B-02" 2>&1); echo "$OUT" | tail -20; echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-03: Generator 候选落 quarantine bundle，Evaluator 从 bundle 干净 clone 到候选 SHA 且无污染 [接缝×2]
  动作: 单测用真实 workspace-manager 对候选 SHA 执行 bundleCandidate 落 quarantine，再 cloneFromBundle 起评估工作区；在源工作区预埋一个「工作容器标记文件」作污染探针
  预期观察: quarantine 卷出现候选 bundle（幂等，二次写不重复）；clone 后 HEAD==候选 SHA；评估工作区**不含**污染探针标记文件（不继承工作容器文件）；bundle 缺失时 fail-closed 抛错不回退远端
  等待预算: 0s
  留证: vitest -t 'B-03' 输出末 20 行进 log_tail + evidence
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t "B-03" 2>&1); echo "$OUT" | tail -20; echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-04: 信任边界回归——非 root/零 cap/push 拒绝/token 独立不复用 session 全绿
  动作: 单测跑 run 级双容器下的既有信任 smoke（root 语义、push gate、每 attempt 独立 token）
  预期观察: 信任相关 it() 全部 passed，0 failed；Generator/评估路径 push gate 仍设 `remote.origin.pushurl=blocked-by-harness://`；attempt 间不复用 provider session
  等待预算: 0s
  留证: vitest -t 'B-04' 输出末 20 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "B-04" 2>&1); echo "$OUT" | tail -20; echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-05: per-run 容量对 5GB VM 得出 ≥2 个并发 run 容器，冻结常量不回退
  动作: 单测调用 per-run 容量函数（VM≈5120MiB，每容器 2048MiB），并断言三机冻结 capacity 与 role-weight 不变
  预期观察: per-run 容量返回 ≥2；node-profile 三机 capacity(us=7/xian-m4=8/xian-m1=8) 与 getRoleCapacity role-weight(generator/evaluator/judge=4,proposer=2) 语义不回退
  等待预算: 0s
  留证: vitest -t 'B-05' 输出末 20 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run src/orchestrator/fleet-node/node-profile.test.js -t "B-05" 2>&1); echo "$OUT" | tail -20; echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-06: FLEET_RUN_SCOPED_CONTAINER=off 回退单 attempt 容器命名
  动作: 单测设 flag=off，prepare 一个 attempt
  预期观察: 容器名回退旧形态 `cecelia-fleet-<attemptId>`，不触发 run 级复用/exec/bundle 分支，行为与改造前一致
  等待预算: 0s
  留证: vitest -t 'B-06' 输出末 20 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "B-06" 2>&1); echo "$OUT" | tail -20; echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

## Invariant 覆盖（铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-eval-clean: 评估容器不继承工作容器任何文件（node_modules/缓存/hooks/tmp），从候选 SHA 干净 clone
  动作: 见 B-03 污染探针（评估工作区不含工作容器标记文件 + 依赖按锁文件重装非继承）
  预期观察: B-03 防污染断言绿
  等待预算: 0s
  留证: 同 B-03 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t "B-03" 2>&1); echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] INV-non-root-zero-cap: 容器非 root UID/零 cap/push 拒绝/每 attempt 独立 token 不复用 session
  动作: 见 B-04 信任 smoke
  预期观察: B-04 信任断言绿
  等待预算: 0s
  留证: 同 B-04 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "B-04" 2>&1); echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

铁律 N/A 逐条映射（本 sprint 不触碰其覆盖模块，显式声明不回退；非可勾验收项，不占 BEHAVIOR 计数）：

- INV-no-self-merge — N/A：本 sprint 不改 merge 归属，generator 交付分支由 controller 合入（现有语义不变，无回退风险）
- INV-ci-guard — N/A：本合同未授权改 CI workflow；新增测试落 `scripts/fleet-worker/*.test.cjs` 与 `src/__tests__/integration/`，由既有 brain-unit/brain-integration job 自动纳入，不新增/改 `.github/workflows/*.yml`
- INV-generator-retry — N/A：Runner 派发/重试语义不在本 sprint 改动面（容器生命周期改造不触碰重试动作路由）
- INV-brain-url — N/A：本 sprint 不改 BRAIN_URL 注入路径（attempt env 注入既有逻辑不动，仅改容器命名/生命周期）
- INV-validation-clock — N/A：本 sprint 不触碰 validation clock 注入（既有 `injects the exact Controller-owned validation clock` 断言不回退）
- INV-session-path — N/A：本 sprint 评估容器改的是「从 bundle 干净 clone」，不改 evaluator 临时脚本落盘路径约定（既有 session-path 语义保持）

## E2E 验收（final-e2e 由 evaluator 跑 — 见 contract-draft.md `## E2E 验收` 段）

evaluator local_api 阶段执行 contract-draft.md `## E2E 验收` 段脚本（run 级双容器生命周期逻辑单测全绿 + DevGate）。生产真 run 的 docker ps / psql 共享 container_id 属**接缝断言**（见 contract-draft.md 接缝清单 #1/#2/#3），由 controller 生产真 run 验证，标 `logic-done-pending`，evaluator 沙箱内不可确定性执行（无 Docker daemon / 业务 PG）。

- [ ] [ARTIFACT] contract-draft.md 含可执行 local_api E2E 脚本（final-e2e 载体，过 bash -n）
  Test: manual:bash -c 'cd /workspace && sed -n "\@^#!/bin/bash@,/Golden Path（run 级双容器生命周期逻辑/p" sprints/08161549-kernel-b4de344a/contract-draft.md > /tmp/e2e-final.sh && test -s /tmp/e2e-final.sh && bash -n /tmp/e2e-final.sh'

- [ ] [BEHAVIOR] [L3] E2E-接缝: 生产真 run docker ps 只见 1 run 容器 + 1 eval 容器，psql 同 run 共享 container_id [接缝×2]（logic-done-pending）
  动作: controller 调度最终生产真 run（fleet us-mac-m4）跑一条 F1 任务，Planner→Generator + Evaluator 阶段
  预期观察: `docker ps` Planner→Generator 只见 1 个 `cecelia-fleet-run-<run8>`，Evaluator 阶段仅多出 1 个 `cecelia-fleet-eval-*`；`psql` 查 harness_attempts 同 run 的 attempt 共享 container_id；同时刻 ≥2 条 run 各自容器并行；候选在 Evaluator 卡住时仍在工作容器内可取
  等待预算: 1800s（一条真 run 从 Planner 到 Evaluator）
  留证: docker ps 输出 + psql harness_attempts 查询结果（接缝清单 #1/#2/#3）
  Test: manual:bash -c 'cd /workspace && sed -n "\@^#!/bin/bash@,/Golden Path（run 级双容器生命周期逻辑/p" sprints/08161549-kernel-b4de344a/contract-draft.md > /tmp/e2e-final.sh && test -s /tmp/e2e-final.sh && bash -n /tmp/e2e-final.sh'
