---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Generator/Publisher 权限边界生产回归（server-owned PostgreSQL runtime resource）

**范围**: Dispatcher 为 role=generator 注入 server-owned `runtime_resources.postgres=true`（caller false 不降权）；保持 Generator 只产本地候选 / Publisher 唯一远端发布 objective 边界；新增 RED 回归单测 + 可执行 smoke 接入 smoke_pool ratchet。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] dispatcher.js 将 generator 纳入 server-owned runtime_resources.postgres 注入
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/dispatcher.js','utf8');if(!/\['proposer', 'reviewer', 'evaluator', 'generator'\]\.includes\(spec\.role\)/.test(c)||!/postgres: \['evaluator', 'generator'\]\.includes\(spec\.role\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 永久回归单测存在于 orchestrator __tests__ 永久落点
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js','utf8');if(!c.includes('runtime_resources')||!c.includes('spawn:generator'))process.exit(1)"

- [ ] [ARTIFACT] 权威 smoke 存在且可执行
  Test: node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh';const c=fs.readFileSync(p,'utf8');if(!c.includes('gen-pub-boundary-smoke'))process.exit(1);if(!(fs.statSync(p).mode&0o111))process.exit(1)"

- [ ] [ARTIFACT] top-level 委派 wrapper 存在（真实文件，供 smoke_pool 计数）
  Test: node -e "const fs=require('fs');const p='scripts/smoke/generator-publisher-boundary-smoke.sh';if(fs.lstatSync(p).isSymbolicLink())process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh'))process.exit(1)"

- [ ] [ARTIFACT] smoke_pool ratchet watermark 由 13 上调至 >=14
  Test: node -e "const r=require('./scripts/ratchet-registry.json');const sp=r.find(x=>x.name==='smoke_pool');if(!sp||sp.watermark<14||sp.direction!=='only_up')process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 永久回归单测绿——generator server-owned postgres + caller false 不降权 + generator-fix
  动作: 运行永久回归单测 `generator-runtime-resource-boundary.test.js`
  预期观察: 3 tests passed（generator/caller-false/generator-fix 三态 postgres===true）
  等待预算: 0s
  留证: vitest reporter 输出末 5 行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: caller postgres:false 不降权（真 buildInputs 行为断言，非替身）
  动作: 用真实 dispatcher `__test__.buildInputs` 组装 generator bundle，payload 注入 runtime_resources.postgres:false
  预期观察: 组装结果 runtime_resources.postgres===true（server-owned，caller 无法降权）
  等待预算: 0s
  留证: node stdout "OK: caller false 未降权 postgres===true"
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/orchestrator/dispatcher.js\").then(function(m){var b=m.__test__.buildInputs;var s=m.resolveAction(\"spawn:generator\");var ctx={taskId:\"t\",worktreePath:\"/tmp/w\",observed:{task:{id:\"t\",title:\"t\",description:\"d\",payload:{sprint_dir:\"s\",runtime_resources:{postgres:false}}},contract:{approved:true,row:{propose_branch:\"cp-x\"}}}};var i=b(\"spawn:generator\",s,ctx,{logicalCycleId:\"i\",attemptKind:\"initial\",workstreamKey:\"ws1\"});if(i.runtime_resources&&i.runtime_resources.postgres===true){console.log(\"OK: caller false 未降权 postgres===true\");}else{console.error(\"FAIL\");process.exit(1);}}).catch(function(e){console.error(\"FAIL:\",e.message);process.exit(1);});"'

- [ ] [BEHAVIOR] [L2] B-03: 权限边界 smoke 三条边界全过退出 0
  动作: 执行权威 smoke `packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh`
  预期观察: 打印「三条边界全过 ✓」，退出码 0
  等待预算: 0s
  留证: smoke stdout 末 5 行
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-04: top-level 委派 wrapper 依赖免装退出 0
  动作: 执行 `scripts/smoke/generator-publisher-boundary-smoke.sh`（无 npm ci / 无 DB 环境）
  预期观察: 委派权威 smoke 后退出码 0
  等待预算: 0s
  留证: wrapper stdout 末 5 行
  Test: manual:bash -c 'bash scripts/smoke/generator-publisher-boundary-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-05: smoke 已接入 smoke_pool ratchet（status=pass 且 watermark 上调至 >=14）
  动作: 运行 ratchet-guard 并解析 smoke_pool 指标
  预期观察: smoke_pool status=pass、watermark>=14、value 已计入新 wrapper
  等待预算: 0s
  留证: node stdout "OK smoke_pool watermark=.. value=.."
  Test: manual:bash -c 'node scripts/ratchet-guard.mjs --json 2>/dev/null | node -e "var s=\"\";process.stdin.on(\"data\",function(d){s+=d;}).on(\"end\",function(){var sp=JSON.parse(s).results.find(function(r){return r.name===\"smoke_pool\";});if(!sp||sp.status!==\"pass\"||sp.watermark<14){console.error(\"FAIL \"+JSON.stringify(sp));process.exit(1);}console.log(\"OK smoke_pool watermark=\"+sp.watermark+\" value=\"+sp.value);});"'

- [ ] [BEHAVIOR] [L2] B-06: 既有冲突单测已更新为新期望，dispatcher.test.js 全绿
  动作: 运行既有 `dispatcher.test.js`（generator 旧「无 runtime_resources」断言必须已改为新期望）
  预期观察: 全部 test passed（含 proposer/reviewer/evaluator 三态不回退 + generator 新期望）
  等待预算: 0s
  留证: vitest reporter 输出末 5 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-07 INV-4[smoke 铁律]: smoke ENOENT 降级——源缺失时退出 0 跳过不假红、失败时非零退出打印边界名
  动作: 在临时空目录（无 dispatcher.js）跑权威 smoke 副本，断言 ENOENT 降级放行；另用非 git 目录验证 SKIP 语义
  预期观察: 源缺失 → 打印 SKIP 且 exit 0（不假红）；正常源在位 → exit 0；边界破坏 → 非零 + 打印失败边界名
  等待预算: 0s
  留证: 两次运行的 stdout（SKIP 行 + 三条边界全过行）
  Test: manual:bash -c 'D=$(mktemp -d); cp packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh "$D/s.sh"; ( cd "$D" && bash s.sh | grep -q "SKIP" ) && echo "OK ENOENT 降级放行" || { echo "FAIL: 未走 ENOENT 降级"; rm -rf "$D"; exit 1; }; rm -rf "$D"'

## 历史约束映射（Invariant 铁律逐条）

- INV-1 [Generator 重试身份]: N/A —— 本 sprint 不改重试派发（仅新增 runtime_resources 注入 + smoke），不触及 generator/generator-fix 重派身份。
- INV-2 [Fleet Generator Brain URL 权威]: N/A —— 不改 HARNESS_BRAIN_URL 注入/预检。
- INV-3 [Planner 分支锁定]: N/A —— 不改 Planner workspace/branch。
- INV-4 [smoke 铁律]: 见 B-07（smoke 失败非零退出 + 打印边界名 + ENOENT 降级放行 + 幂等可长期反复运行）。
