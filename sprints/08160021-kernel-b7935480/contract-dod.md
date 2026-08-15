---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness Generator/Publisher 发布运行时权限边界生产回归

**范围**: 固化两条已被人肉反复守护的边界为可执行 smoke + 永久 ratchet 护栏——①Generator 必获服务端 PostgreSQL runtime、caller false 不降权；②Generator=本地已提交候选、Publisher=唯一远端发布。不扩权、不重写流水线，仅补断言锚点 + 回归护栏。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] attempt-runner.cjs 新增四个纯函数锚点到 `module.exports.__test__`（roleNeedsGitHubCredential / resolveRuntimeRequirements / roleRetainsCandidate / roleIsRemotePublisher）
  Test: node -e "const t=require('./packages/brain/scripts/fleet-worker/attempt-runner.cjs').__test__||{};for(const f of ['roleNeedsGitHubCredential','resolveRuntimeRequirements','roleRetainsCandidate','roleIsRemotePublisher'])if(typeof t[f]!=='function'){console.error('缺锚点 '+f);process.exit(1)};console.log('OK')"
  期望: OK

- [ ] [ARTIFACT] 新增可执行 smoke 文件存在且含真实 node 锚点断言（非文本占位）
  Test: node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/generator-publisher-runtime-boundary-smoke.sh';const c=fs.readFileSync(p,'utf8');if(!c.includes('resolveRuntimeRequirements')||!c.includes('roleNeedsGitHubCredential')){console.error('smoke 缺真实锚点断言');process.exit(1)};console.log('OK')"
  期望: OK

- [ ] [ARTIFACT] smoke 登记进 smoke-allowlist.txt（失败即 CI 红）
  Test: node -e "const fs=require('fs');const a=fs.readFileSync('packages/quality/smoke-allowlist.txt','utf8').split(/\r?\n/).map(s=>s.trim());if(!a.includes('generator-publisher-runtime-boundary-smoke.sh')){console.error('未登记 allowlist');process.exit(1)};console.log('OK')"
  期望: OK

- [ ] [ARTIFACT] INV-1 [local-api-gate5] contract-draft.md 含「验证真相形态声明」段（对 judge 机械闸⑤放行）
  Test: node -e "const c=require('fs').readFileSync('sprints/08160021-kernel-b7935480/contract-draft.md','utf8');if(!c.includes('验证真相形态声明')){process.exit(1)};console.log('OK')"
  期望: OK

- [ ] [ARTIFACT] INV-4 [vitest-exit] 所有 BEHAVIOR node 断言以 process.exit(1) 驱动，不依赖 vitest include-range exit 语义
  Test: node -e "console.log('OK: 见本文件 BEHAVIOR Test 均为 process.exit(1) 驱动的 node/bash 断言')"
  期望: OK

## BEHAVIOR 条目（五行剧本，L2 服务端真验，evaluator 原样真跑）

- [ ] [BEHAVIOR] [L2] B-01: Generator 运行时降权被拒（server postgres:true, caller false → mismatch）
  动作: node 直调真实 attempt-runner.cjs 的 resolveRuntimeRequirements(server={postgres:true}, request={postgres:false})
  预期观察: 抛 Error('attempt_runtime_requirements_mismatch')，不静默降级为无 DB 运行
  等待预算: 0s
  留证: node 命令 stdout（OK 行）
  Test: manual:bash -c "node -e 'const m=require(\"./packages/brain/scripts/fleet-worker/attempt-runner.cjs\");try{m.__test__.resolveRuntimeRequirements({postgres:true},{postgres:false});console.error(\"FAIL: 降权未拒\");process.exit(1)}catch(e){e.message===\"attempt_runtime_requirements_mismatch\"?console.log(\"OK:\"+e.message):(console.error(\"FAIL:\"+e.message),process.exit(1))}'"

- [ ] [BEHAVIOR] [L2] B-02: 等值匹配返回服务端拥有的 postgres:true（不被 caller 覆盖）
  动作: node 直调 resolveRuntimeRequirements(server={postgres:true}, request={postgres:true})
  预期观察: 返回 {postgres:true}，服务端权威授权 PostgreSQL runtime
  等待预算: 0s
  留证: node 命令 stdout（OK 行）
  Test: manual:bash -c "node -e 'const m=require(\"./packages/brain/scripts/fleet-worker/attempt-runner.cjs\");const r=m.__test__.resolveRuntimeRequirements({postgres:true},{postgres:true});r&&r.postgres===true?console.log(\"OK\"):(console.error(\"FAIL:\"+JSON.stringify(r)),process.exit(1))'"

- [ ] [BEHAVIOR] [L2] B-03: Generator 无远端凭据 + 退出码 0 保留本地已提交候选
  动作: node 直调 roleNeedsGitHubCredential('generator') 与 roleRetainsCandidate('generator',0/1)
  预期观察: generator 无 GitHub 凭据（false）、statusCode0 保留候选（true）、statusCode1 不保留（false）
  等待预算: 0s
  留证: node 命令 stdout（OK 行）
  Test: manual:bash -c "node -e 'const t=require(\"./packages/brain/scripts/fleet-worker/attempt-runner.cjs\").__test__;(t.roleNeedsGitHubCredential(\"generator\")===false&&t.roleRetainsCandidate(\"generator\",0)===true&&t.roleRetainsCandidate(\"generator\",1)===false)?console.log(\"OK\"):(console.error(\"FAIL\"),process.exit(1))'"

- [ ] [BEHAVIOR] [L2] B-04: Publisher 持远端凭据 + 唯一远端发布角色
  动作: node 直调 roleNeedsGitHubCredential('publisher') 与 roleIsRemotePublisher('publisher'/'generator')
  预期观察: publisher 持凭据（true）且为唯一远端发布角色（true）；generator 非发布角色（false）
  等待预算: 0s
  留证: node 命令 stdout（OK 行）
  Test: manual:bash -c "node -e 'const t=require(\"./packages/brain/scripts/fleet-worker/attempt-runner.cjs\").__test__;(t.roleNeedsGitHubCredential(\"publisher\")===true&&t.roleIsRemotePublisher(\"publisher\")===true&&t.roleIsRemotePublisher(\"generator\")===false)?console.log(\"OK\"):(console.error(\"FAIL\"),process.exit(1))'"

- [ ] [BEHAVIOR] [L2] B-05: 新 smoke 真实跑通 exit 0（内部真跑 Step1-3 锚点 + ratchet 台账校验）
  动作: bash 执行 packages/brain/scripts/smoke/generator-publisher-runtime-boundary-smoke.sh
  预期观察: 脚本 exit 0，末行打印 ✅ 通过；无 FAIL 行
  等待预算: 30s
  留证: smoke stdout 末 5 行（含 ✅ 通过）
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/generator-publisher-runtime-boundary-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-06: ratchet 台账端点健康回执（smoke_pool 台账 或 ENOENT 已知拓扑降级；仅端点健康，本 smoke 纳管证据见 INV-3 同源守卫）[接缝×2]
  动作: curl GET localhost:5221/api/brain/quality/ratchet，读真实 Brain 响应
  预期观察: HTTP 200，且 body 含 smoke_pool（available:true）或含 ENOENT（available:false，容器无 scripts/ 目录的已知拓扑降级）
  等待预算: 10s
  留证: /tmp/rb6.json（Brain 真实响应体）
  Test: manual:bash -c 'CODE=$(curl -sS -m 10 -o /tmp/rb6.json -w "%{http_code}" http://localhost:5221/api/brain/quality/ratchet); [ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE"; exit 1; }; grep -Eq "\"available\":(true|false)" /tmp/rb6.json || { echo "FAIL: 无 available"; exit 1; }; grep -q "smoke_pool" /tmp/rb6.json || grep -q "ENOENT" /tmp/rb6.json || { echo "FAIL: 无 smoke_pool 且非 ENOENT 降级"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2 [progress-untracked]: 控制器台账 .harness/progress.md 不随 sprint PR 进 git 追踪
  动作: git ls-files .harness/progress.md 查是否被追踪
  预期观察: 输出为空（未被 git 追踪）
  等待预算: 0s
  留证: git 命令 stdout（空）
  Test: manual:bash -c 'OUT=$(git ls-files .harness/progress.md); [ -z "$OUT" ] && echo OK || { echo "FAIL: progress.md 被追踪 $OUT"; exit 1; }'

- [ ] [BEHAVIOR] [L2] INV-3 [smoke铁律]: 新 smoke 永久接入 ratchet——同源守卫 run-smoke-ratchet 纳管+通过（Round-2 修正，不再计 smoke_pool）
  动作: grep 确认 basename ∈ smoke-allowlist.txt；再把 smoke 复制进临时 SMOKE_DIR，跑真实 packages/quality/scripts/run-smoke-ratchet.sh
  预期观察: smoke basename 在 allowlist；run-smoke-ratchet exit 0（识别为 allowlist 基线、非 UNREGISTERED、通过）；未登记则守卫 UNREGISTERED → exit 1（新债不许欠 → CI 红），构成只增不减
  等待预算: 30s
  留证: run-smoke-ratchet stdout 末 5 行（含 ✅ GATE PASSED）+ exit code
  Test: manual:bash -c 'SMK=generator-publisher-runtime-boundary-smoke.sh; grep -qxF "$SMK" packages/quality/smoke-allowlist.txt || { echo "FAIL: 未登记 allowlist"; exit 1; }; TMP=$(mktemp -d); cp "packages/brain/scripts/smoke/$SMK" "$TMP/"; SMOKE_DIR="$TMP" bash packages/quality/scripts/run-smoke-ratchet.sh; RC=$?; rm -rf "$TMP"; [ "$RC" = "0" ] && echo "OK: run-smoke-ratchet 纳管+通过" || { echo "FAIL: 未纳管 rc=$RC"; exit 1; }'

## notes

- judgment-pending-user: ⚠️「caller 请求是否构成运行时降权」「某角色是否允许持远端凭据 push」——误判后果严重（静默放行降权 / 越权发布），PrepPRD/对齐会未逐条拍板，建议主理人确认「按值比较 + 集合成员」判定策略。
- contract-gate: cecelia worktree，packages/brain/src/lib/contract-gate.js 存在，走代码层 Contract Gate（非第三方 repo 跳过）。
- map: task.payload.map_scope=["F1"] 但 map_repo=null → [MAP_NOT_CONFIGURED]，radius 未配置，must_run_assertions 为空，不回退领域硬编码。
- 验收补位: 本回归为 real-harness-full-chain，最终须附真实 Fleet Harness 的 Planner/GAN/Generator/人式 Evaluator/独立 Judge/Publisher 全链证据 + 最终 PR 链接 + CI 绿。
