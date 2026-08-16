---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Fleet Runner run 级双容器（工作容器常驻 + 干净评估容器）

**范围**: fleet-worker run 级容器生命周期（创建/复用/exec/销毁/reconcile）+ 候选 git bundle→quarantine 卷 + Evaluator 干净容器从 bundle clone + 容量按并发 run 计 + `autonomous_singleton` per-run + feature flag `FLEET_RUN_SCOPED_CONTAINER`（默认 on，off 回退）+ migration 431（container_id 列）+ Brain semver。
**大小**: L

> **格式说明（跨闸兼容）**：仓库 required DevGate `check-dod-mapping.cjs` 要求 `Test:` 紧跟 `- [ ]` 行的**下一行**且前缀为 `manual:`/`tests/`/`contract:`。因此本文件把 `Test:` 置于标题下一行，五行剧本其余字段（动作/预期观察/等待预算/留证）紧随 Test 之后——五要素齐全，仅物理顺序为迁就机械闸调整。

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 431 建 container_id 列（initiative_runs.work_container_id + harness_attempts.container_id）
  Test: manual:bash -c "test -f packages/brain/migrations/431_run_container_id.sql && grep -q container_id packages/brain/migrations/431_run_container_id.sql && grep -q initiative_runs packages/brain/migrations/431_run_container_id.sql"

- [ ] [ARTIFACT] pg-integration 测试已登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS（否则 CI 不跑）
  Test: manual:bash -c "grep -q migration-431-run-container-id.pg.integration.test.js packages/brain/vitest.config.js"

- [ ] [ARTIFACT] feature flag FLEET_RUN_SCOPED_CONTAINER 在 fleet-worker.cjs 的 main(env) 读取并透传（cjs 内部不直接读 process.env）
  Test: manual:bash -c "grep -q FLEET_RUN_SCOPED_CONTAINER packages/brain/scripts/fleet-worker/fleet-worker.cjs"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 同一 run 连续两个 attempt 复用同一工作容器，不同 run 不同容器
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "复用同一工作容器" --reporter=dot 2>&1); echo "$out" | tee /tmp/b01.log | tail -4; echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 单测对同一 run_id 派两个 attempt（首个 + Generator），再对另一 run_id 派一个 attempt
  预期观察: 首 attempt 触发 docker.prepare(create) 恰 1 次，第二个同 run attempt 不 create（走 exec）、container_id 与首个相等；不同 run 的工作容器名（cecelia-fleet-run-<run8>）不同
  等待预算: 0s（同步命令，vitest 阻塞返回）
  留证: /tmp/b01.log（vitest 末 4 行，含 passed 计数）

- [ ] [BEHAVIOR] [L2] B-02: reconcile 按 run_id 找回活跃 run 的工作容器不误删，run 终态才销毁
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "reconcile 按 run_id" --reporter=dot 2>&1); echo "$out" | tee /tmp/b02.log | tail -4; echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 单测让 docker.listOwned 返回一个带 cecelia.fleet.run_id label 的工作容器，分别在「该 run 活跃」与「该 run 终态」两种活跃 run 集合下调 runner.reconcile()
  预期观察: run 活跃 → docker.remove 不被调用、不新建容器；run 终态 → docker.remove 被调用恰 1 次
  等待预算: 0s
  留证: /tmp/b02.log

- [ ] [BEHAVIOR] [L2] B-03: FLEET_RUN_SCOPED_CONTAINER=off 回退单 attempt 容器命名 cecelia-fleet-<attemptId>
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "回退单 attempt 容器" --reporter=dot 2>&1); echo "$out" | tee /tmp/b03.log | tail -4; echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 单测以 runScoped=false 调 resolveContainerNames，并跑 adapter 层 create/start argv 断言
  预期观察: 容器名回落 legacy cecelia-fleet-<attemptId>，行为与今日一致（旧断言全绿）
  等待预算: 0s
  留证: /tmp/b03.log

- [ ] [BEHAVIOR] [L2] B-04: Generator 候选 git bundle 落 quarantine，Evaluator 从 bundle 干净 clone 后 HEAD==候选 SHA
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t "干净 clone 后 HEAD" --reporter=dot 2>&1); echo "$out" | tee /tmp/b04.log | tail -4; echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 真 git tmp fixture：Generator 提交候选 commit → bundle 到 quarantine 卷 → Evaluator 从 bundle clone（不 fetch 远端）
  预期观察: eval 工作区 git rev-parse HEAD == 候选 SHA；git bundle verify 通过且含候选 SHA
  等待预算: 0s
  留证: /tmp/b04.log

- [ ] [BEHAVIOR] [L2] B-05: Evaluator 容器不继承工作容器标记文件（防污染断言为真）
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t "防污染" --reporter=dot 2>&1); echo "$out" | tee /tmp/b05.log | tail -4; echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 真 git fixture：工作容器工作区写入标记文件后，Evaluator 从 bundle clone 到全新工作区
  预期观察: eval 工作区中工作容器标记文件不存在（test -e 为假）；clone 源是 bundle 而非工作容器目录
  等待预算: 0s
  留证: /tmp/b05.log

- [ ] [BEHAVIOR] [L2] B-06: quarantine bundle 缺失/损坏 → Evaluator 显式失败，不 fetch 远端
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t "bundle 缺失" --reporter=dot 2>&1); echo "$out" | tee /tmp/b06.log | tail -4; echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 真 git fixture：删除/截断 bundle 后触发 Evaluator clone
  预期观察: 抛显式错误（bundle 不可用），无 fetch 远端调用，不回退复用工作容器文件
  等待预算: 0s
  留证: /tmp/b06.log

- [ ] [BEHAVIOR] [L2] B-07: 容量按并发 run 容器计——5GB VM / 每 run 2GB 得 ≥2
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run src/orchestrator/fleet-node/node-profile.test.js -t "并发 run 容器" --reporter=dot 2>&1); echo "$out" | tee /tmp/b07.log | tail -4; echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 纯函数直调 maxConcurrentRunContainers({memoryBytes:5GiB, cpuCores:8})，并验边界（恰 2GB→1、<2GB→0）
  预期观察: 5GB/8core 返回 ≥2；边界不产出负数/NaN
  等待预算: 0s
  留证: /tmp/b07.log

- [ ] [BEHAVIOR] [L2] B-08: autonomous_singleton per-run——同 run 第二个 attempt 不判 contended
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run src/orchestrator/attempt-machine-capacity.test.js -t "per-run" --reporter=dot 2>&1); echo "$out" | tee /tmp/b08.log | tail -4; echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 纯函数直调 prepareAttemptMachineCapacity，构造同 run 已有活动 attempt 场景
  预期观察: 同 run 第二个 attempt 不返回 autonomous_singleton_capacity_contended（同 run 串行复用容器，跨 run 才排他）
  等待预算: 0s
  留证: /tmp/b08.log

- [ ] [BEHAVIOR] [L2] B-09: 信任回归全绿（INV-3/INV-5/INV-6）——非 root/仅 evaluator root/push 拒绝/token 独立
  Test: manual:bash -c 'cd packages/brain && out=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs --reporter=dot 2>&1); echo "$out" | tee /tmp/b09.log | tail -5; echo "$out" | grep -qE "Test Files  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 跑 attempt-runner.test.cjs 整文件（含 blocked-by-harness pushurl、仅 evaluator --user root、tmpfs uid 5999、callback token 不复用断言）
  预期观察: 整文件 0 failed；run-scoped 改造未破坏任一信任断言
  等待预算: 0s
  留证: /tmp/b09.log

- [ ] [BEHAVIOR] [L2] B-10: container_id 落库——同 run attempt 共享 container_id（真 PG，migration 431）
  Test: manual:bash -c 'cd packages/brain; [ -n "${DB_URL:-}" ] || [ -n "${DB_HOST:-}" ] || { echo "FAIL: local_api 未注入 DB"; exit 1; }; node -e "import(\"./src/migrate.js\").then(m=>m.runMigrations()).then(()=>console.log(\"mig OK\")).catch(e=>{console.error(e);process.exit(1)})"; out=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-431-run-container-id.pg.integration.test.js --reporter=dot 2>&1); echo "$out" | tee /tmp/b10.log | tail -5; echo "$out" | grep -qE "Test Files  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"'
  动作: 评估环境注入 DB；空库先跑真实 migration（含 431），再跑 pg-integration 断言同 run 两 attempt 的 harness_attempts.container_id 相等、initiative_runs.work_container_id 落值
  预期观察: pg-integration 0 failed；同 run 两 attempt container_id 相等
  等待预算: 60s（migration + pg 建 schema，超时=FAIL）
  留证: /tmp/b10.log

- [ ] [BEHAVIOR] [L2] B-11: Brain semver bump + DevGate 三件套全过
  Test: manual:bash -c 'NEWV=$(node -e "process.stdout.write(require(\"./packages/brain/package.json\").version)"); node -e "const s=process.argv[1].split(\".\").map(Number),b=[1,273,59];process.exit((s[0]>b[0]||(s[0]==b[0]&&(s[1]>b[1]||(s[1]==b[1]&&s[2]>b[2]))))?0:1)" "$NEWV" || { echo "FAIL: 版本未 bump $NEWV"; exit 1; }; bash scripts/check-version-sync.sh && node scripts/facts-check.mjs && node packages/quality/scripts/devgate/check-dod-mapping.cjs sprints/08161258-kernel-56a1e68d/contract-dod.md | tee /tmp/b11.log'
  动作: 校验 packages/brain/package.json 版本 > 1.273.59 且四处同步，跑 facts-check / version-sync / dod-mapping
  预期观察: 版本已 bump、四处同步、三件套 exit 0
  等待预算: 0s
  留证: /tmp/b11.log

## Invariant（铁律 → INV 映射；执行断言并入上方 BEHAVIOR）

| 铁律 | INV | 覆盖方式 |
|---|---|---|
| 单slot串行 | INV-1 | B-08（per-run fence：同 run 串行、跨 run 才并行） |
| 禁写死环境 | INV-2 | B-07（mem/cpu 走命名常量、容量从 profile 推导；探索提示验边界） |
| 真环境验证 | — | 接缝清单 1-3 真 Fleet 宿主验（logic-done-pending，见 contract-draft.md） |
| 多租户默认 | — | N/A：fleet 基础设施，无业务租户数据面 |
| 凭据安全 | INV-3 | B-09（容器级凭据 broker + token 独立不落盘） |
| 日志脱敏 | INV-4 | B-09（沿用 FIFO 凭据不落盘；无新增日志打印 token） |
| 端点鉴权 | — | N/A：无新增 HTTP 端点 |
| 租户隔离 | — | N/A：无租户资源改动 |
| FleetGeneratorBrainURL | INV-5 | B-09（不改 Brain URL 注入路径，容器内不自改） |
| generator重试身份 | INV-6 | B-01/B-09（run 容器复用下重试仍复用同 attempt 身份） |
| planner分支 | — | N/A：不改 planner 分支绑定 |
| evaluator临时脚本隔离 | INV-7 | B-04/B-05（eval 容器全新隔离、不共享工作容器 /tmp） |
| generator不自merge | — | N/A：不改 merge 权 |
| Kernel校验时钟 | — | N/A：不改校验时钟 |
