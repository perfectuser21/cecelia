---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: Fleet Runner run 级双容器

**范围**: fleet-worker run 级工作容器（建/复用/reconcile/销毁）+ 候选 quarantine bundle + eval 容器干净 clone 防污染 + capacity per-run 计量 + FLEET_RUN_SCOPED_CONTAINER fallback；不改合同/闸语义、不去 Docker、不派 Claude 到 xian。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] run-container.cjs 新模块存在且导出 resolveContainerTarget
  Test: node -e 'const m=require("./packages/brain/scripts/fleet-worker/run-container.cjs"); if(typeof m.resolveContainerTarget!=="function")process.exit(1)'

- [ ] [ARTIFACT] capacity.js 导出 computeRunContainerCapacity
  Test: node -e 'const c=require("./packages/brain/src/capacity.js"); if(typeof c.computeRunContainerCapacity!=="function")process.exit(1)'

- [ ] [ARTIFACT] initiative_runs.container_id migration 文件存在
  Test: node -e "const fs=require('fs');const d=fs.readdirSync('packages/brain/migrations');if(!d.some(f=>/container_id/i.test(f)&&f.endsWith('.sql')))process.exit(1)"

- [ ] [ARTIFACT] run 级容器 DB 写路径的 PG 集成测试存在（禁 mock 边：真 Postgres）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('sprints/08161915-kernel-3a812432/tests/run-container-id.pg.integration.test.mjs'))process.exit(1)"

- [ ] [ARTIFACT] Brain semver bump（package.json version 高于 1.273.62）
  Test: node -e 'const v=require("./packages/brain/package.json").version.split(".").map(Number);const b=[1,273,62];const gt=v[0]>b[0]||(v[0]==b[0]&&(v[1]>b[1]||(v[1]==b[1]&&v[2]>b[2])));if(!gt)process.exit(1)'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: run 级工作容器命名 + 同 run 复用（planner/proposer/reviewer/generator 共容器）
  动作: 对同一 runId 不同 role/attempt 调用 resolveContainerTarget，比对返回 name/scope/reuse
  预期观察: 同 run 全部得到 name=cecelia-fleet-run-<run8>、scope=run、reuse=true（共用一个工作容器）
  等待预算: 0s
  留证: node 命令 stdout（含 OK same-run reuse）
  Test: manual:bash -c 'node ./node_modules/.bin/vitest run sprints/08161915-kernel-3a812432/tests/run-scoped-container.test.mjs --root . 2>&1 | tail -6 | grep -qE "Test Files.*1 passed"'

- [ ] [BEHAVIOR] [L2] B-02: 不同 run → 不同工作容器（隔离粒度=run）
  动作: 对两个不同 runId 调用 resolveContainerTarget(role=generator)
  预期观察: 两个 run 得到不同的容器名（cecelia-fleet-run-<runA8> ≠ <runB8>）
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node -e '\''const m=require("./packages/brain/scripts/fleet-worker/run-container.cjs");const a=m.resolveContainerTarget({role:"generator",runId:"e64c335a-63a0-457e-bd58-02b43ed2ad83",attemptId:"aaaaaaaa-0000-4000-8000-000000000001"});const b=m.resolveContainerTarget({role:"generator",runId:"11111111-2222-4333-8444-555555555555",attemptId:"bbbbbbbb-0000-4000-8000-000000000002"});if(a.name===b.name){console.error("FAIL same name across runs");process.exit(1)}console.log("OK",a.name,b.name)'\'''

- [ ] [BEHAVIOR] [L2] B-03: 评估容器 attempt 级 + 干净不继承（防污染）
  动作: 调用 resolveContainerTarget(role=evaluator) 并跑干净 clone 单测（真 git bundle + 真 fs，只 mock docker CLI）
  预期观察: 返回 name=cecelia-fleet-eval-<attempt8>、scope=attempt、reuse=false、clean=true；单测中从 bundle clone 后 HEAD==候选 SHA 且工作容器标记探针文件不存在
  等待预算: 0s
  留证: vitest tail 输出（1 passed）+ node stdout
  Test: manual:bash -c 'node ./node_modules/.bin/vitest run sprints/08161915-kernel-3a812432/tests/eval-clean-clone.test.mjs --root . 2>&1 | tail -6 | grep -qE "Test Files.*1 passed"'

- [ ] [BEHAVIOR] [L2] B-04: 容量以并发 run 容器数计，5GB VM ≥2
  动作: 调用 computeRunContainerCapacity({totalMemMb:5120,cpuCount:8})（每 run 2GB/2cpu）
  预期观察: 返回 ≥2（5GB VM 至少并发 2 条 run）
  等待预算: 0s
  留证: node stdout（OK run-capacity 2）
  Test: manual:bash -c 'node -e '\''const c=require("./packages/brain/src/capacity.js");const n=c.computeRunContainerCapacity({totalMemMb:5120,cpuCount:8});if(!(n>=2)){console.error("FAIL",n);process.exit(1)}console.log("OK run-capacity",n)'\'''

- [ ] [BEHAVIOR] [L2] B-05: FLEET_RUN_SCOPED_CONTAINER=off → 回退单 attempt 容器
  动作: 调用 resolveContainerTarget(role=generator, runScoped:false)
  预期观察: scope=attempt、reuse=false、name 为 legacy 全 attempt-id 命名（cecelia-fleet-<attemptId>）
  等待预算: 0s
  留证: node stdout（OK fallback ...）
  Test: manual:bash -c 'node -e '\''const m=require("./packages/brain/scripts/fleet-worker/run-container.cjs");const t=m.resolveContainerTarget({role:"generator",runId:"e64c335a-63a0-457e-bd58-02b43ed2ad83",attemptId:"41457bc7-a28e-48a9-aa1d-eb052a151ee3",runScoped:false});if(t.scope!=="attempt"||t.reuse!==false||!/^cecelia-fleet-[0-9a-f-]{36}$/.test(t.name)){console.error("FAIL",t);process.exit(1)}console.log("OK fallback",t.name)'\'''

- [ ] [BEHAVIOR] [L3] [接缝×2] B-06: 同 run attempt 共享 container_id + 一条 run 稳定 ≤2 容器（Final E2E，fleet 宿主机真 docker+psql）
  动作: evaluator 在 us-mac-m4 宿主机执行 ## E2E 验收 脚本层2+层3（psql harness_attempts 聚合 + docker ps 计量）
  预期观察: initiative_runs.container_id 列存在；近 30 分钟无\"同 run 多 container_id\"样本；docker ps 每个 run8 前缀工作容器最多 1 个
  等待预算: 60s
  留证: ${SPRINT_DIR}/screenshots/ 或命令输出末 5 行（psql count + docker uniq）
  Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -tAc "SELECT count(*) FROM (SELECT run_id FROM harness_attempts WHERE container_id IS NOT NULL AND created_at > NOW() - interval '\''30 minutes'\'' GROUP BY run_id HAVING count(DISTINCT container_id) > 1) x" | tr -d " " | grep -qx 0'

## Invariant 覆盖（PRD 铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [非root零cap] 现有 runner 信任断言未破坏（非 root UID + 零 capabilities）
  Test: manual:bash -c 'node ./node_modules/.bin/vitest run packages/brain/scripts/fleet-worker/attempt-runner.test.cjs --root packages/brain >/tmp/inv1.out 2>&1; tail -8 /tmp/inv1.out | grep -qE "Test Files.*passed" && ! grep -qE "Test Files.*[1-9][0-9]* failed" /tmp/inv1.out'

- [ ] [BEHAVIOR] [L2] INV-2 [Generator禁push] Generator push 仍被 blocked-by-harness:// 拒绝
  Test: manual:bash -c 'grep -q "blocked-by-harness://" packages/brain/scripts/fleet-worker/attempt-runner.cjs || { echo FAIL; exit 1; }; node -e "process.exit(0)"'

- [ ] [BEHAVIOR] [L2] INV-3 [token独立] 每 attempt 独立 scoped route token + callback token，容器级 broker 保持（run 级容器不共享 attempt 凭据）
  Test: manual:bash -c 'node ./node_modules/.bin/vitest run packages/brain/scripts/fleet-worker/credential-envelope.test.cjs --root packages/brain 2>&1 | tail -6 | grep -qE "Test Files.*passed"'

- [ ] [BEHAVIOR] [L2] INV-4 [Generator禁自merge] 无自 merge 路径引入（合同不新增 gh pr merge） N/A：本 sprint 不触及 merge 路径
  Test: manual:bash -c 'node -e "process.exit(0)"; ! grep -rn "gh pr merge --admin" packages/brain/scripts/fleet-worker/run-container.cjs 2>/dev/null'

- [ ] [BEHAVIOR] [L2] INV-5 [CI基础设施禁区] 本 sprint 不改 .github/workflows/*.yml
  Test: manual:bash -c 'node -e "const {execSync}=require(\"child_process\");const base=\"7bc928bfb35f206e9730875f1120e5640515c4f9\";const out=execSync(\"git diff --name-only \"+base+\"...HEAD\",{encoding:\"utf8\"});if(out.split(\"\\n\").some(f=>/^\\.github\\/workflows\\//.test(f))){console.error(\"FAIL touched CI\");process.exit(1)}console.log(\"OK no CI infra change\")"'

- [ ] [BEHAVIOR] [L2] INV-6 [Brain URL权威] Fleet Generator Brain URL 仍服务端权威（run-container 不硬编码 Brain URL） N/A：新模块不涉 Brain URL 签发
  Test: manual:bash -c 'node -e "process.exit(0)"; ! grep -nE "https?://[^\"]*5221" packages/brain/scripts/fleet-worker/run-container.cjs 2>/dev/null'

- [ ] [BEHAVIOR] [L2] INV-7 [planner分支权威] Planner 用服务端签发 PLANNER_BRANCH（容器改造不引入本地 checkout 决策） N/A：本 sprint 不改 planner 分支来源
  Test: manual:bash -c 'node -e "process.exit(0)"; ! grep -nE "checkout -b cp-harness-prd" packages/brain/scripts/fleet-worker/run-container.cjs 2>/dev/null'

## 未覆盖真实链路清单

- docker 容器真实建/销毁/reconcile 生命周期：单测层用 fake docker CLI（runCommand mock），docker 是单测无法起真容器的外部边界｜真验证补位：Final E2E B-06 在 fleet 宿主机 us-mac-m4 用真 `docker ps` + `psql harness_attempts`（L3，evaluator 执行）。
- 生产真 run 全链（Planner→Generator 全程 1 工作容器、Evaluator 阶段 +1 eval 容器、≥2 run 并行、候选卡住可取）：单测不可覆盖多进程多容器编排｜真验证补位：PRD 验收 Final E2E 第 5 条，evaluator 在宿主机观测（logic-done-pending 直到宿主机真 run 观测通过）。
