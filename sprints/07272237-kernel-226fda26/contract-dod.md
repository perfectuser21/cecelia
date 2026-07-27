---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel target-aware required-context gate 恢复

**范围**: server-owned required-context 推导、exact current SHA 绑定、preview route failure evidence seam、ground-truth→derive/gate→decision-log 闭环、post-merge 独立硬闸、Draft PR stale approval invalidation、legacy rollout 显式开关
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/preview-deploy.yml` 真实调用 `/api/brain/preview/start`
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/preview-deploy.yml','utf8');if(!c.includes('/api/brain/preview/start')||!c.includes('curl -sf'))process.exit(1)"

- [ ] [ARTIFACT] 本 sprint 合同测试文件三件套存在
  Test: node -e "for(const f of ['sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts','sprints/07272237-kernel-226fda26/tests/preview-route-evidence.contract.test.ts','sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts'])require('fs').accessSync(f)"

- [ ] [ARTIFACT] legacy rollout 开关必须显式命名，不得隐式放松 target-aware 语义
  Test: node -e "const c=require('fs').readFileSync('sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts','utf8');if(!c.includes('legacy rollout')&&!c.includes('legacy_rollout'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，全部三段式）

- [ ] [BEHAVIOR] [L2] 服务端 task/run/PR 真相推导 target_environment 与 required contexts，caller 参数不得创建 authority
  动作: 运行 required-context 合同测试中的 server-owned 推导用例，传入 caller-owned `expected_repo/expected_run/role` 干扰值
  预期观察: gate 结果只使用服务端 task/run/PR/current SHA/mapping，忽略 caller-owned authority
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts -t "server-owned facts derive target_environment and required contexts" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] stale SHA、wrong repo、wrong run/task、missing context、external infra failure 各自独立返回稳定 reason
  动作: 运行 required-context 合同测试中的独立 blocker 用例集
  预期观察: `stale_check_sha`、`wrong_repo`、`wrong_run_or_task`、`missing_required_context`、`required_context_mapping_missing`、`external_infrastructure_failure` 不互相遮挡
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts -t "independent blocker reasons stay exact" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] `local_api` 仅在当前 SHA 上全部本地 required contexts 通过时允许 preview neutral
  动作: 运行 local_api preview neutral 合同用例，分别喂给“全部本地通过”和“本地存在失败”两组当前 SHA 证据
  预期观察: 前者 `preview_status=neutral|skipped` 且 `allow=true`；后者 `allow=false reason=local_required_context_failed`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts -t "local_api preview neutral only after local contexts pass" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] preview-dependent target 缺 preview 或 preview FAIL 时硬失败
  动作: 运行 preview-dependent target 合同用例，分别构造 preview 缺失与 preview 失败
  预期观察: 稳定返回 `preview_required_missing` 与 `preview_required_failed`，且不因 local_api 例外放行
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts -t "preview-dependent targets hard fail without preview" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] preview failure 路径持久化 `http_status`、`response_body`、`error` 三字段且全部非空
  动作: 运行 preview route failure evidence 合同测试，让 preview start 接缝返回非成功结果
  预期观察: 持久化 evidence 三字段全部非空；不得出现 `|| true`、空响应或 success status 伪装失败
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/preview-route-evidence.contract.test.ts -t "preview failure persists http status response body and error" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] preview success path 与 failure path 分离，不得以 failure evidence 冒充成功
  动作: 运行 preview route success/failure 分离用例
  预期观察: 成功路径只保留兼容 `{port,db_name,status}`；失败路径另行验证 evidence，不共享 PASS
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/preview-route-evidence.contract.test.ts -t "preview success path stays separate" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] generator-fix 必须通过 ground-truth→derive/gate→decision-log 在当前 SHA 上闭环证明
  动作: 运行 kernel release gate 合同测试中的闭环用例
  预期观察: 不允许直接调用新 helper 冒充修复；必须经真实 observed → derive → gate → decision-log 过渡，且 sha 精确绑定当前 head
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts -t "ground truth derive gate decision-log close the loop on current sha" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] post-merge 的 staging/production/final-report blocker 全部独立硬阻断
  动作: 运行 post-merge gate 合同用例，逐个注入 staging missing、staging SKIP/no-contract、staging FAIL、stale/missing tested_sha、production missing、production FAIL、final report missing
  预期观察: 每项单独 reason，任一命中都 `allow=false`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts -t "post-merge gates stay independent" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] Draft PR + `autoMergeRequest=null` 下旧 SHA approval 在新提交后失效
  动作: 运行 stale approval invalidation 合同用例，先建立旧 SHA APPROVED，再推进 current head SHA
  预期观察: evaluator PASS、judge PASS 仍不足以放行；必须重新请求 human approval
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts -t "stale approval invalidated by new commit" --reporter=verbose'
  期望: exit 0

## Invariant 条目

- [ ] [BEHAVIOR] [L2] INV-1 [target_environment来源DB] target_environment 只从服务端 task/run/PR 真相与 mapping 推导
  动作: 传入 caller-owned target/environment 诱饵
  预期观察: 结果不受 caller-owned 参数影响
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts -t "server-owned facts derive target_environment and required contexts" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-2 [SHA锚定] accepted checks / evaluator / judge / approval 全部锚定当前 head SHA
  动作: 构造旧 tested_sha 与旧 approval
  预期观察: gate 拒绝 stale 证据
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts -t "independent blocker reasons stay exact|stale approval invalidated by new commit" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-3 [禁止写死环境] 缺 mapping / unknown target fail-closed
  动作: 构造无 mapping 的 target
  预期观察: `required_context_mapping_missing`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts -t "independent blocker reasons stay exact" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-4 [失败禁降级] preview/staging/production/final-report 任一失败不得 warning 降级
  动作: 逐个注入失败 blocker
  预期观察: 全部 `allow=false`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts -t "post-merge gates stay independent" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-5 [语义成功判定] preview failure success/failure 不能只看 HTTP 200 或退出码
  动作: 伪造 success status 但 evidence 为空的失败场景
  预期观察: 失败测试必须挂
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/preview-route-evidence.contract.test.ts -t "preview failure persists http status response body and error" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-6 [manual真跑] 合同测试通过真实 vitest 运行，不允许静态 grep 替代
  动作: 运行三份合同测试
  预期观察: 测试进程真实执行并返回 exit code
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts sprints/07272237-kernel-226fda26/tests/preview-route-evidence.contract.test.ts sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts --reporter=verbose'

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] Kernel required-context gate Red-first 合同测试在本地真实跑起
  动作: 依次运行三份合同测试
  预期观察: proposer 阶段至少一份测试因目标行为缺失而失败，但不因配置/依赖缺失崩溃
  Test: manual:bash -c 'set +e; node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/required-context-gate.contract.test.ts --reporter=verbose; A=$?; node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/preview-route-evidence.contract.test.ts --reporter=verbose; B=$?; node ./node_modules/vitest/vitest.mjs run sprints/07272237-kernel-226fda26/tests/kernel-release-gate.contract.test.ts --reporter=verbose; C=$?; set -e; [ "$A" -ne 0 ] || [ "$B" -ne 0 ] || [ "$C" -ne 0 ]'

