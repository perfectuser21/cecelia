---
skeleton: false
journey_type: autonomous
target_environment: local_api
---

# Contract DoD — 可信 server-owned Test Environment Controller 恢复

**范围**: controller/dispatcher/local+fleet transport/runner/真实 PG oracle/V5/import purity/终态 cleanup/structured callback/host operator gate
**大小**: L
**状态纪律**: Docker host receipt 未验签前仅 `logic-done-pending`，PR 保持 Draft，不 merge/deploy。

## ARTIFACT 条目

- [ ] [ARTIFACT] Brain 版本与语义定义同步
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('packages/brain/DEFINITION.md','utf8');if(!/Test Environment Controller/.test(s)||!/版本/.test(s))process.exit(1)"

- [ ] [ARTIFACT] 生产 controller/receipt/oracle、migration 与 runner 接线有精确实现文件
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/orchestrator/test-environment-controller.js','packages/brain/src/orchestrator/test-environment-receipt.js','packages/brain/src/orchestrator/test-environment-oracle.js']){const s=fs.readFileSync(p,'utf8');if(s.length<200)process.exit(1)}"

- [ ] [ARTIFACT] A-F 六套测试与 host operator 脚本已提交
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/__tests__/integration/test-environment-controller.pg.integration.test.js','packages/brain/src/__tests__/integration/test-environment-receipt.pg.integration.test.js','packages/brain/src/__tests__/integration/test-environment-oracle.pg.integration.test.js','packages/brain/src/__tests__/integration/test-environment-v5.pg.integration.test.js','packages/brain/src/__tests__/integration/test-environment-lifecycle.pg.integration.test.js','scripts/harness-test-environment/run-host-operator-e2e.sh','scripts/harness-test-environment/verify-host-receipt.mjs']){fs.accessSync(p)}"

- [ ] [ARTIFACT] Host receipt 保持 credential-free 且 exact SHA
  Test: node scripts/harness-test-environment/assert-no-secret-evidence.mjs --paths "$HOST_OPERATOR_RECEIPT"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B01 persisted attempt 后仅冻结 server contract 可授权 DB capability（覆盖 Golden Path Step 1；INV-14/17/30/34/36/56/57/58）
  动作: 显式连接 operator bootstrap，使用当前 production dispatcher + real attempt store 派 DB-backed generator，同时分别注入 caller URL/receipt/role/nonce/CIDR，并派 judge。
  预期观察: 合格 generator 在 attempt row 已存在后获得 server-owned 瞬态 capability；攻击字段不改变资格或内容且不持久化；judge/无关命令无 URL/receipt。
  验证命令: Test: manual:bash -c 'cd packages/brain && : "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}" && npx vitest run --root ../.. --config sprints/07280034-kernel-2beddfbf/vitest.config.js -t "合格 DB-backed generator 在 attempt 持久化后获得 server-owned 瞬态 capability|调用方 payload 的 URL、receipt、database、role、nonce、CIDR 全部无权且不持久化|judge 与无关 reporter 不获得 URL 或 receipt" --reporter=verbose'
  期望: 3 个独立 business assertions exit 0；无 FAKE_RED。

- [ ] [BEHAVIOR] [L2] B02 每个 attempt 获得唯一最小权限 DB/role/nonce（覆盖 Golden Path Step 2；INV-31/55/56/57/58）
  动作: 在真实 postgres:16 operator fixture 创建 production-named decoy，连续 provision local/fleet 两 attempt，并对每一数据库/schema/table/sequence/function 反查 ACL。
  预期观察: within 30s 两 attempt 三元组不共享；非 attempt/decoy 上 CONNECT/CREATE/TEMP/object privilege 全为零；attempt schema migration/seed/test 可用。
  验证命令: Test: manual:bash -c 'cd packages/brain && : "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}" && npx vitest run src/__tests__/integration/test-environment-controller.pg.integration.test.js -t "每个 attempt 唯一 database role nonce|非 attempt 与 production decoy 零 database schema table sequence function privilege|仅 attempt schema 可 migration seed test" --config vitest.integration.config.js --reporter=verbose'
  期望: exit 0；VALID UNTIL 与 receipt expires_at 一致；finally 零临时 DB/role/decoy。

- [ ] [BEHAVIOR] [L2] B03 receipt canonical signature/digest/binding/replay 严格拒绝全部独立反例（覆盖 Golden Path Step 3；INV-12/16/29/54/55/58）
  动作: 真 receipt store 中签发合法 receipt，再逐项执行 missing/expired/stale/reused/cross-attempt/unknown-field/body-signature-digest tamper，每项之后独立 restore。
  预期观察: 每个反例命中唯一 error code；失败不消耗合法 nonce；并发重放恰好一份成功；receipt/task/run/result/log/callback/artifact 均无 secret。
  验证命令: Test: manual:bash -c 'cd packages/brain && : "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}" && npx vitest run src/__tests__/integration/test-environment-receipt.pg.integration.test.js --config vitest.integration.config.js --reporter=verbose'
  期望: 所有独立 `it()` exit 0，未知字段严格失败，secret scan 命中数=0。

- [ ] [BEHAVIOR] [L2] B04 authenticated remote POST 不丢瞬态 capability且不污染 TaskBundle/provider_spec（覆盖 Golden Path Step 4；INV-14/34/40/54/55）
  动作: 通过实际 loopback HTTP listener 调 production remote bridge，使用 Bearer auth 发送 fleet launch；local/Docker 注入另由 host gate真验。
  预期观察: HTTP body 顶层有 `test_environment_capability`；provider_spec/workspace_spec/TaskBundle 无 URL；worker binding fail-closed；judge/unrelated role 无两项 env。
  验证命令: Test: manual:bash -c 'cd packages/brain && npx vitest run --root ../.. --config sprints/07280034-kernel-2beddfbf/vitest.config.js -t "authenticated server-to-worker POST 携带 capability，TaskBundle/provider_spec 均不携带" --reporter=verbose'
  期望: real HTTP test exit 0；Docker-only 边在 host receipt 前仍 logic-done-pending。

- [ ] [BEHAVIOR] [L2] B05 pre-import oracle 真连 PG 并拒绝每个地址/目标/权限反例（覆盖 Golden Path Step 5；INV-13/30/31/52/53/56/57/58）
  动作: 用 controller-issued URL 在 consumer import 前真查 current_database/current_user/inet_server_addr/catalog/ACL，再独立运行 missing URL/receipt、ambiguous/misdirected/loopback/socket/production name-host-privilege/CIDR mismatch。
  预期观察: 正路身份与 receipt 逐字一致且非回环、在 CIDR；所有反例在 import 前以唯一 error 拒绝，restore 后正路恢复。
  验证命令: Test: manual:bash -c 'cd packages/brain && : "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}" && npx vitest run src/__tests__/integration/test-environment-oracle.pg.integration.test.js --config vitest.integration.config.js --reporter=verbose'
  期望: 独立反例全 exit 0；任何 production privilege 或地址歧义均 fail-closed。

- [ ] [BEHAVIOR] [L2] B06 V5 仅用 controller URL且真实 baseline import purity不回退（覆盖 Golden Path Step 6；INV-23/30/31/34/35/46/53/55/56/57）
  动作: 在 attempt DB 经 issued URL 跑 migration/seed/bootstrap，断言同 DB 的 journey_step_links；分别清除 URL、设置旧 DB_NAME=cecelia；再在无 psql PATH 导入当前 production orchestrator/run.js 并语义调用 parseArgs。
  预期观察: V5 正路成功；missing URL 与旧 DB_NAME 独立拒绝并恢复；import 前后 catalog/env/process 不变，DEFINITION/version 与运行语义一致。
  验证命令: Test: manual:bash -c 'cd packages/brain && : "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}" && npx vitest run src/__tests__/integration/test-environment-v5.pg.integration.test.js --config vitest.integration.config.js --reporter=verbose && npx vitest run --root ../.. --config sprints/07280034-kernel-2beddfbf/vitest.config.js -t "无 psql PATH 导入真实 orchestrator/run.js 时 catalog、env 与进程语义不变" --reporter=verbose'
  期望: 两 suite exit 0；无 invented facade；无默认 DB/socket。

- [ ] [BEHAVIOR] [L2] B07 八终态逐项 cleanup且重复执行不复建（覆盖 Golden Path Step 7；INV-01/03/10/12/17/18/25/29/54/55）
  动作: success/failure/cancel/SIGKILL/runner crash/worker restart/recovery/reconcile 各自创建 attempt 资源、触发真实终态、验证旧 login/DB/role/lease/terminal receipt，再重复 cleanup 三次。
  预期观察: 每项 within 30s 清除 session→role→DB/lease，旧 login 失败，terminal receipt 有效；重复 cleanup=already_clean；timeout 有界且 fail-closed/告警。
  验证命令: Test: manual:bash -c 'cd packages/brain && : "${HARNESS_OPERATOR_BOOTSTRAP_URL:?required}" && npx vitest run src/__tests__/integration/test-environment-lifecycle.pg.integration.test.js --config vitest.integration.config.js --reporter=verbose'
  期望: 8 个独立终态 + 8 个独立 restore 全 exit 0；无 combined counterfactual。

- [ ] [BEHAVIOR] [L3] B08 exact SHA host Docker 全链与 structured callback 权威（覆盖 Golden Path Step 8；INV-05/06/15/20/22/30/32/33/42/47/53/55）
  动作: host operator 对 exact proposer SHA 跑实际 dispatcher→local Docker child，以及 production remote bridge→authenticated HTTP worker→attempt-runner→Docker child；分别模拟 BRAIN_RESULT_FILE unset、read-only workspace、stale file，并验 structured callback。
  预期观察: local/fleet child 真收到 URL+receipt并过 oracle；harness_attempts.result 的 structured provider result 决定 verdict；within 30s terminal cleanup；签名 host receipt 含 command/SHA/exit/business assertions 且不含 secret。
  验证命令: Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && : "${HOST_OPERATOR_RECEIPT:?required}" && SHA=$(git rev-parse HEAD) && git rev-parse --verify "${SHA}^{commit}" >/dev/null && node scripts/harness-test-environment/verify-host-receipt.mjs --sha "$SHA" --receipt "$HOST_OPERATOR_RECEIPT" --require local_dispatcher,local_docker_child,remote_bridge,authenticated_http_worker,attempt_runner,fleet_docker_child,structured_callback,all_lifecycle_modes'
  期望: exit 0；receipt SHA=HEAD，所有 required assertions=true，merge_performed=false。

## 铁律逐条映射（INV）

每条铁律均映射到上述可执行 BEHAVIOR，或显式 N/A；无声跳过禁止。

| INV | 铁律 | 映射 |
|---|---|---|
| INV-01 | 超时恢复 | B07 recovery/reconcile 真终态 |
| INV-02 | 语义成功 | N/A：本 sprint 无通知；DB 成功由 B02/B05 语义反查 |
| INV-03 | 依赖修复 | B07；且 npm audit 发现不是本 sprint 自动升级授权 |
| INV-04 | 会话心跳 | N/A：不修改 headed relay 心跳 |
| INV-05 | 毕业门禁 | B08 前必须跑 lint-tdd-commit-order/check-test-coverage |
| INV-06 | 手工退出 | B08 host receipt 记录真实 exit_code |
| INV-07 | 模板展开 | N/A：无 manual node 模板字符串；B08 真实执行 |
| INV-08 | 冒烟铁律1 | B08 host smoke |
| INV-09 | 冒烟铁律2 | B08 host smoke |
| INV-10 | 多轮状态 | B07 restart/recovery/reconcile + 时间真实流逝 |
| INV-11 | 重扫去重 | N/A：无付费调用 |
| INV-12 | 时间关系 | B03 expiry/nonce 与 B07 cleanup deadline |
| INV-13 | 环境文本 | B05 按真 PG/CIDR |
| INV-14 | 环境来源 | B01：target_environment 不从本地文件推断；DB 资格来自 server contract |
| INV-15 | Judge格式 | B08 structured callback schema；judge 不获 capability |
| INV-16 | 字段长度 | B03 receipt 字段/size 白名单 |
| INV-17 | 复活取证 | B01 基线与 rejected recovery 证据锁定 |
| INV-18 | 返回失败 | B07 cleanup null/false/timeout 显式失败 |
| INV-19 | 冒烟铁律3 | B08 host smoke |
| INV-20 | 报告探针 | B08 structured callback/attempt result |
| INV-21 | 完成判定 | B08 禁仅凭容器 exit 0 |
| INV-22 | 人工接管 | B08 host operator 人工 gate |
| INV-23 | 点火可追 | B06/B08 exact SHA/task/run/attempt receipt |
| INV-24 | 退役实证 | N/A：不退役功能；旧 receipt 仅 rejected evidence |
| INV-25 | 后台告警 | B07 cleanup/reconcile fail-closed 告警 |
| INV-26 | 表名认领 | B02/B03 复用 harness_attempts + 新 receipt/nonce schema 前核对 writer |
| INV-27 | 真实消费 | B04/B06 actual launcher/worker/consumer |
| INV-28 | 多端完整 | N/A：无展示字段；local/fleet 由 B02/B08 区分 |
| INV-29 | 语义一致 | B03 validator 与 B08 verifier 同 canonical policy |
| INV-30 | 引用校验 | B08 `rev-parse --verify ...^{commit}` |
| INV-31 | 生产隔离 | B02/B05 production decoy ACL 零权限 |
| INV-32 | 失败非零 | B08 任一失败非零 |
| INV-33 | 生产自报 | B08 host receipt 自报 SHA 对 origin/main |
| INV-34 | 异步质量 | B01/B04/B08 真 await，禁 readFileSync 行为证明 |
| INV-35 | 合同格式 | contract Test Contract 固定四列 |
| INV-36 | 精确暂存 | Generator 仅暂存合同/测试声明路径 |
| INV-37 | 禁静态验 | B01-B08 全为运行行为 |
| INV-38 | 调度正路 | N/A：不新增 cron |
| INV-39 | 合并归属 | B08 merge_performed=false |
| INV-40 | 环境继承 | B04/B08 两 env 仅明确 runner inner env |
| INV-41 | 先例核查 | B08 当前真实 dispatch 历史/host receipt |
| INV-42 | 共享禁区 | 不改共享 CI 判定文件；如需改必须合同修订 |
| INV-43 | 提前合并 | B08 receipt SHA 与 merge SHA gate，且本 sprint 不 merge |
| INV-44 | 冒烟铁律4 | B08 host smoke |
| INV-45 | Brain冒烟 | B08 + Generator 同步 DEFINITION/smoke allowlist |
| INV-46 | 类型接线 | B06/B08 dispatcher/transport/runner/callback 全链 |
| INV-47 | 服务双信 | B08 worker service + listener 双验 |
| INV-48 | 宿主服务 | N/A：不新增常驻服务 |
| INV-49 | 清单同步 | N/A：不新增常驻服务 |
| INV-50 | 冒烟铁律5 | B08 host smoke |
| INV-51 | 单槽串行 | task-plan 单 ws1；测试只读可并行，资源 mutation 串行 |
| INV-52 | 禁写假设 | B05 从 receipt/CIDR/PG 推导 |
| INV-53 | 真验才完 | B08 receipt 前 logic-done-pending |
| INV-54 | 多租户测 | B03/B07 至少两个 attempt 隔离，等价于 capability tenant |
| INV-55 | 凭据安全 | B03/B04/B08 secret scan |
| INV-56 | 日志脱敏 | B01/B03/B08 persistence/log scan |
| INV-57 | 端点鉴权 | B04 Bearer + receipt binding |
| INV-58 | 租户隔离 | B02/B03 两 attempt DB/role/nonce 不串 |

## 未覆盖真实链路清单

- local `spawnDockerDetached` → actual runner container：需 exact SHA host operator receipt；未有前 `logic-done-pending`。
- remote production bridge → authenticated fleet-worker → attempt-runner → actual Docker：同上。
- SIGKILL/runner crash/worker restart 的宿主级真实终态：同上。

proposal Red 的 provider CLI/HTTP listener test adapter 只用于暴露 Red，不计 real-chain evidence。

## 禁 mock 边清单

- dispatcher ↔ attempt-store ↔ 真 PostgreSQL frozen contract/harness_attempts。
- controller ↔ pg_database/pg_roles/ACL/receipt/nonce store。
- dispatcher ↔ local launcher ↔ spawnDockerDetached ↔ actual Docker。
- remote bridge ↔ authenticated worker ↔ attempt-runner ↔ actual Docker。
- lifecycle/recovery/callback ↔ cleanup ↔ real PG terminal receipt。
