---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel CI/Preview Required Context Contract Recovery

**范围**: `packages/brain/src/orchestrator/required-context-contract.js` 新建 target-aware required-context 合同；`packages/brain/src/orchestrator/ground-truth.js`/`derive.js` 接入当前 head SHA + target-aware gate；`packages/brain/src/routes/preview.js` 或其适配器保留 preview 启动失败 status/body/error 证据；补齐 real PG contract tests。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/orchestrator/required-context-contract.js` 存在且导出 `createRequiredContextContract` 与 `evaluateTaskGate`
  Test: node -e "const fs=require('fs');const p='packages/brain/src/orchestrator/required-context-contract.js';const c=fs.readFileSync(p,'utf8');if(!/createRequiredContextContract/.test(c)||!/evaluateTaskGate/.test(c))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/orchestrator/ground-truth.js` 含 target-aware required contexts 接入点，读取服务端 `target_environment` 与当前 `headRefOid`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!/target_environment/.test(c)||!/headRefOid|head_sha/.test(c)||!/required context|required_context/i.test(c))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/preview.js` 或同层 helper 含 preview 启动失败证据字段 `http_status`、`response_body`、`error`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/preview.js','utf8');if(!/http_status/.test(c)||!/response_body/.test(c)||!/error/.test(c))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts` 存在且含 7 个以上 `it(` 契约用例
  Test: node -e "const fs=require('fs');const p='sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts';const c=fs.readFileSync(p,'utf8');const n=(c.match(/\bit\(/g)||[]).length;if(n<7)process.exit(1);console.log('OK')"

## Invariant 覆盖条目

- [ ] [BEHAVIOR] [L2] INV-1 环境可信 - 服务端 `target_environment` 覆盖客户端 required contexts
  动作: 运行 real PG 契约测试，向任务 payload 注入客户端伪造 `required_contexts`
  预期观察: gate 结果仅使用服务端 `tasks.payload.target_environment` 计算 required contexts
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "服务端 target_environment 覆盖客户端 required_contexts"'

- [ ] [BEHAVIOR] [L2] INV-2 真环境验证 - GitHub checks 必须锚定当前 head SHA
  动作: 运行 stale SHA / wrong repo / wrong run 契约测试
  预期观察: 非当前 SHA 或错误来源的检查结果全部被拒绝
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "preview 目标 preview failure 缺失 stale SHA 错 repo run 一律阻断"'

- [ ] [BEHAVIOR] INV-3 租户隔离 N/A：本 sprint 不新增租户面查询或跨租户写路径
  动作: N/A
  预期观察: N/A
  验证命令: Test: manual:bash -c 'echo "N/A: no tenant-scoped tables touched"'

- [ ] [BEHAVIOR] INV-4 凭据安全 - secrets 不硬编码、不进 git、不进日志
  动作: 扫描新增 contract module 与 sprint tests
  预期观察: 不出现 `ghp_`、`github_pat_`、`Bearer ` 等硬编码凭据
  验证命令: Test: manual:bash -c 'node -e "const fs=require(\"fs\");const files=[\"packages/brain/src/orchestrator/required-context-contract.js\",\"sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts\"];for(const f of files){const c=fs.readFileSync(f,\"utf8\");if(/ghp_|github_pat_|Bearer\s+[A-Za-z0-9]/.test(c))process.exit(1)}console.log(\"OK\")"'

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] local_api preview neutral 且仅 required contexts 全过才继续
  动作: 运行 `local_api` + preview fail 的 real PG 契约测试
  预期观察: preview 被标为 `neutral` 或 `skipped`；只有 `local_api` required contexts 全过才 `decision=continue`
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "local_api preview neutral 且仅 required contexts 全过才继续"'

- [ ] [BEHAVIOR] [L2] preview 目标 preview failure 缺失 stale SHA 错 repo run 一律阻断
  动作: 运行 preview-required gate 契约测试，分别注入 preview failure、missing context、stale SHA、repo mismatch、run mismatch
  预期观察: 每个场景均 `decision=block`，且返回可审计 `reason`
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "preview 目标 preview failure 缺失 stale SHA 错 repo run 一律阻断"'

- [ ] [BEHAVIOR] [L2] preview 启动失败保留 status body error evidence
  动作: 运行 preview failure evidence 契约测试，模拟 curl exit 22 + HTTP 503
  预期观察: 失败对象同时保留 `http_status`、`response_body`、`error`，不再只有单一 exit code
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "preview 启动失败保留 status body error evidence"'

- [ ] [BEHAVIOR] [L2] legacy rollout 不得覆盖服务端 required context contract
  动作: 运行 legacy rollout 兼容契约测试，向任务 payload 写入旧字段与客户端 required list
  预期观察: 旧字段可被读取但不会覆盖服务端 target-aware required contexts
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "legacy rollout 不得覆盖服务端 required context contract"'

- [ ] [BEHAVIOR] [L2] generator fix 仅在真正 required failure 才触发
  动作: 运行 generator-fix transition 契约测试，比较 `local_api + preview fail` 与 `preview target + preview fail`
  预期观察: 前者无 `spawn:generator-fix`；后者才进入 fix/block 路径
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "generator fix 仅在真正 required failure 才触发"'

- [ ] [BEHAVIOR] [L2] post merge staging production hard gate 与 review_required 单 SHA 审批
  动作: 运行 post-merge hard-gate 契约测试
  预期观察: staging/production 任一 required failure 或 missing 一律阻断；首个 P0 controller 变更 `review_required=true` 且未同 SHA evaluator/judge/human 全过前 `merge_allowed=false`
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "post merge staging production hard gate 与 review_required 单 SHA 审批"'

- [ ] [BEHAVIOR] [L2] 缺失 required context 必须阻断并返回审计原因
  动作: 运行 missing required context 契约测试，构造空 checks 或缺失 required name
  预期观察: 结果为 `decision=block` 且 `reason=missing_required_context`
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts -t "缺失 required context 必须阻断并返回审计原因"'

## BEHAVIOR:E2E 条目（autonomous）

- [ ] [BEHAVIOR:E2E] current-head-SHA target-aware gate 契约测试全绿
  动作: 在本机执行 sprint contract tests
  预期观察: `kernel-target-aware-required-context.pg.contract.test.ts` 全部通过
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/07272219-kernel-e6ba6d09/tests/kernel-target-aware-required-context.pg.contract.test.ts'

- [ ] [BEHAVIOR:E2E] GitHub live checks 至少真调一次并返回当前 head SHA
  动作: 使用已登录 `gh` 查询真实 PR
  预期观察: `headRefOid` 为 40 位字符串，`statusCheckRollup` 为数组
  验证命令: Test: manual:bash -c 'PR_URL=${PR_URL:-https://github.com/perfectuser21/cecelia/pull/4226}; gh pr view "$PR_URL" --json state,mergeStateStatus,headRefOid,statusCheckRollup | jq -e ".headRefOid | type == \"string\" and (length == 40)" >/dev/null && gh pr view "$PR_URL" --json state,mergeStateStatus,headRefOid,statusCheckRollup | jq -e ".statusCheckRollup | type == \"array\"" >/dev/null'

- [ ] [BEHAVIOR:E2E] review_required pending 仍阻断完成态
  动作: 运行现有任务完成 gate 回归测试
  预期观察: `review_required=true + review_status=pending` 仍 422 拒绝
  验证命令: Test: manual:bash -c 'NODE_ENV=test npx vitest run packages/brain/src/routes/__tests__/tasks-completed-gate.test.js -t "review_required=true + review_status=pending"'
