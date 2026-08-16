---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 起跑 Map 预检 base_sha 落后 main 按祖先重定基，不永久锁死

**范围**: `ensureNormalMapImpactPreflight` revision 分流（祖先重定基 + route_rebased 事件 + fail-closed）；dispatcher 对 `map_revision_diverged`/`map_stale` 不计入 dispatch_fail_autoblock 连败。禁改 Map 扫描器/manifest，不放松 impact 闸。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `ensureNormalMapImpactPreflight` 内新增 `map_revision_diverged` 分流（不再对落后同源无条件抛 map_revision_mismatch）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/preflight/map-impact-contract.js','utf8');if(!c.includes('map_revision_diverged'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] route_rebased 审计事件写入代码存在（走既有 cecelia_events 通道，保留旧 base_sha）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/preflight/map-impact-contract.js','utf8');if(!c.includes('route_rebased'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] INV-2 impact 闸严格性未放松：digest/radius/assertion 校验仍在 map-impact-contract.js
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/preflight/map-impact-contract.js','utf8');if(!(c.includes('map_digest_invalid')&&c.includes('map_radius_stale')&&c.includes('impact_assertion_missing')))process.exit(1)"
  期望: exit 0（三处硬校验均保留，未删除/放松）

- [ ] [ARTIFACT] 真 PG 写边集成测试文件存在（brain-integration job 跑，本 attempt postgres=false 不跑）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/map-preflight-rebase.pg.integration.test.js')"
  期望: exit 0

> INV-1 [fail-closed]：由 B-01（同源后裔+run 未开始→放行）与 B-02/B-03/B-05（分叉/run 已开始/不可达→fail-closed）联合覆盖，见 INV-1 行。
> INV-3 [nightly-red 归因]：N/A — 本 sprint 不触及 nightly job 归因逻辑（无 PowerShell 截断输出改动）。

## BEHAVIOR 条目（内嵌 manual: 命令，autonomous / DI vitest；postgres=false 见合同「未覆盖真实链路清单」）

- [ ] [BEHAVIOR] [L2] B-01: 同源后裔 + run 未开始 → 重定基放行，新 base_revision = map revision，route_rebased 落库
  动作: 注入 map.source_revision 为 base_sha 的后裔、isAncestor=true、hasRunStarted=false，调用 ensureMapImpactPreflight
  预期观察: persistContract 入参 base_revision === map.source_revision；client.query 曾以 route_rebased 事件被调用（payload 含 old_base_sha）；函数正常返回 active contract
  等待预算: 0s
  留证: /tmp/b01.log 末 5 行（含 passed 摘要）
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "rebases receipt base_sha" 2>&1 | tee /tmp/b01.log; grep -Eq "[1-9][0-9]* passed" /tmp/b01.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b01.log'

- [ ] [BEHAVIOR] [L2] B-02: 非后裔（分叉/回退）→ 抛 map_revision_diverged，不重定基、persistContract 未调用
  动作: 注入 isAncestor=false、hasRunStarted=false，调用 ensureMapImpactPreflight
  预期观察: reject('map_revision_diverged')；persistContract 未被调用；无 route_rebased 事件
  等待预算: 0s
  留证: /tmp/b02.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "map_revision_diverged when map revision is not a descendant" 2>&1 | tee /tmp/b02.log; grep -Eq "[1-9][0-9]* passed" /tmp/b02.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b02.log'

- [ ] [BEHAVIOR] [L2] B-03: run 已开始 + base_sha 落后 → 不重定基，走原 fail-closed 抛 map_revision_mismatch
  动作: 注入 hasRunStarted=true（该 task 已有 initiative_runs）、source_revision≠base_sha，调用 ensureMapImpactPreflight
  预期观察: reject('map_revision_mismatch')；无 route_rebased 事件；persistContract 未调用（run 不中途换基）
  等待预算: 0s
  留证: /tmp/b03.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "run has already started" 2>&1 | tee /tmp/b03.log; grep -Eq "[1-9][0-9]* passed" /tmp/b03.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b03.log'

- [ ] [BEHAVIOR] [L2] B-04: map 非 fresh → 抛 map_stale（既有行为保持），persistContract 未调用
  动作: 注入 map.freshness.status !== 'fresh'，调用 ensureMapImpactPreflight
  预期观察: reject('map_stale')；persistContract 未被调用
  等待预算: 0s
  留证: /tmp/b04.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "throws map_stale" 2>&1 | tee /tmp/b04.log; grep -Eq "[1-9][0-9]* passed" /tmp/b04.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b04.log'

- [ ] [BEHAVIOR] [L2] B-05: 祖先判定不可达（isAncestor throw）→ 按非后裔安全处理，抛 map_revision_diverged，不重定基
  动作: 注入 isAncestor 抛错（模拟 git 对象本地不可达）、hasRunStarted=false，调用 ensureMapImpactPreflight
  预期观察: reject('map_revision_diverged')；无 route_rebased 事件；persistContract 未调用
  等待预算: 0s
  留证: /tmp/b05.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "unreachable ancestry as diverged" 2>&1 | tee /tmp/b05.log; grep -Eq "[1-9][0-9]* passed" /tmp/b05.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b05.log'

- [ ] [BEHAVIOR] [L2] B-06: dispatcher — 派发失败 error=map_revision_diverged → dispatch_fail_consecutive 不递增、不触发 autoblock
  动作: mockTriggerCeceliaRun 返回 {success:false, error:'map_revision_diverged'}，跑 dispatcher 派发路径
  预期观察: 无 UPDATE dispatch_fail_consecutive 递增、blockTask 未被调用；任务回 queued
  等待预算: 0s
  留证: /tmp/b06.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/__tests__/dispatch-fail-autoblock.test.js -t "map_revision_diverged dispatch failure" 2>&1 | tee /tmp/b06.log; grep -Eq "[1-9][0-9]* passed" /tmp/b06.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b06.log'

- [ ] [BEHAVIOR] [L2] B-07: dispatcher — 派发失败 error=map_stale → dispatch_fail_consecutive 不递增、不触发 autoblock
  动作: mockTriggerCeceliaRun 返回 {success:false, error:'map_stale'}，跑 dispatcher 派发路径
  预期观察: 无 UPDATE dispatch_fail_consecutive 递增、blockTask 未被调用；任务回 queued
  等待预算: 0s
  留证: /tmp/b07.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/__tests__/dispatch-fail-autoblock.test.js -t "map_stale dispatch failure" 2>&1 | tee /tmp/b07.log; grep -Eq "[1-9][0-9]* passed" /tmp/b07.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b07.log'

- [ ] [BEHAVIOR] [L2] B-08: 零变更回归 — source_revision === base_sha 的 fresh map 仍正常 materialize，且不写 route_rebased
  动作: 注入 source_revision === base_sha 的 fresh map/radius，调用 ensureMapImpactPreflight
  预期观察: 正常返回 active contract；client.query 从未以 route_rebased 事件被调用（未误入重定基分支）
  等待预算: 0s
  留证: /tmp/b08.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "same-revision fresh map without route_rebased" 2>&1 | tee /tmp/b08.log; grep -Eq "[1-9][0-9]* passed" /tmp/b08.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b08.log'

- [ ] [BEHAVIOR] [L2] B-09: error path — route_rebased 事件写失败 → fail-closed 不吞错，persistContract 未调用
  动作: 注入 cecelia_events 写 route_rebased 时 client.query 抛错、isAncestor=true、hasRunStarted=false
  预期观察: 函数 reject（错误向上传播）；persistContract 未被调用；不留半态（旧 base_sha 未被静默改）
  等待预算: 0s
  留证: /tmp/b09.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "route_rebased event write fails" 2>&1 | tee /tmp/b09.log; grep -Eq "[1-9][0-9]* passed" /tmp/b09.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b09.log'

- [ ] [BEHAVIOR] [L2] INV-1: fail-closed 默认——仅同源后裔+run 未开始放行，其余一律拦截（复用 B-02 分叉 fail-closed 证明）
  动作: 同 B-02（分叉 → 拦截）
  预期观察: 非放行条件下一律 reject，不 materialize contract
  等待预算: 0s
  留证: /tmp/inv1.log 末 5 行
  Test: manual:bash -c 'set -o pipefail; npx vitest run packages/brain/src/orchestrator/preflight/map-impact-contract.test.js -t "map_revision_diverged when map revision is not a descendant" 2>&1 | tee /tmp/inv1.log; grep -Eq "[1-9][0-9]* passed" /tmp/inv1.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/inv1.log'
