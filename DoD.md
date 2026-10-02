# DoD — 受控再基恢复
- [x] [BEHAVIOR] C7 B2.1 recurring过期收口：DISTINCT ON候选前及最终UPDATE同时排除真实phone执行器与持久owner；真实517producer/旧508租约/历史无owner手机保持原账，伪payload普通及同title邻居合法过期，保取消去重、原字段/history及仅RETURNING计数。最终目标故障为真实SQL负例，不声称非法身份重绑竞态。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/recurring.pg.test.js src/phone-dispatch/recurring-dispatch.pg.test.js src/phone-dispatch/schedule-store.pg.test.js src/phone-dispatch/recurring-dispatch.test.js src/phone-dispatch/schedule-store.test.js src/__tests__/recurring-engine.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] headed HTTP限流：接管POST两注册路径、执行与字段PATCH真实第301请求429；双alias共享预算，错误认证计数，拒绝前不新增数据库/owner/终态副作用；固定draft7/Retry-After且无legacy头，原普通结果/metadata及接管合同保留。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/routes/__tests__/task-mutation-rate-limit.test.js src/routes/__tests__/task-task-patch.test.js src/routes/__tests__/task-headed-takeover.test.js src/routes/__tests__/headed-patch-transaction.test.js src/lib/__tests__/headed-task-owner.test.js src/routes/__tests__/tasks-result-backfill.test.js src/routes/__tests__/tasks-completed-gate.test.js --maxWorkers=1 --minWorkers=1"


- [x] [BEHAVIOR] OpenClaw 创建/更新 workflow 按六活动推进，重试幂等，未验收不能登记，任务回执保留。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/workflow-authoring --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] 登记真实落库并回读身份与顺序，版本冲突、共享活动变化和失败事务不覆盖已有流程。
  Test: manual:bash -c "cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-authoring.pg.integration.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] 显式受鉴权入口追加收据、签发Controller、保留失败事实；旧入口与无显式请求仍拒绝。
  Test: manual:bash -c "npx vitest run tests/gp/f1/step1-controlled-recovery.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] Map/Git/活跃身份改变即拒绝，旧恢复保护保持。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/orchestrator/__tests__/recovery-rebase.test.js src/orchestrator/__tests__/kernel-run-store.test.js src/__tests__/relay-runs-canonical-create.test.js src/orchestrator/preflight/base-sha-reanchor.test.js --maxWorkers=1 --minWorkers=1"
真实隔离PG 6项已通过，详见永久 integration。正式 native、Judge、CI 与部署状态记录于 Brain 任务，不据本 DoD 宣称已完成。
- [x] [BEHAVIOR] 正规恢复冻结目标贯穿ground-truth同run候选与真实dispatcher到attempt/launcher边界，排除旧us投影；冲突profile与非法target无新run或派发。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/orchestrator/__tests__/recovery-target-cross-path.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] identity 身份与许可：手机SSH执行面独立授权；身份字段逐项绑定，未知或过期容量拒绝，动作只允许adb_get_state。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/phone-dispatch/identity.test.js src/phone-dispatch/contracts.test.js src/execution-directory --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] ledger 持久台账：真实PostgreSQL验证已部署image510后补缺号508与507独立台账及十四执行器，验证同单唯一预约、同机互斥、一次launch、丢回复保留占位、认证回执幂等结算及旧writer保护。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/phone-dispatch/store.test.js src/__tests__/integration/execution-directory.pg.integration.test.js src/__tests__/integration/script-capacity-reservation.pg.integration.test.js src/app-server/__tests__/integration/store.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] ownership 兼容合同：独立controller不交普通派发器终止，保留历史471名单并核对后续合法增量；手机独立所有权跨180分钟不误回队，旧device宽限保留。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/__tests__/executor-contracts.test.js src/__tests__/migration-471-script-executor.test.js src/__tests__/executor-headed-liveness.test.js src/phone-dispatch/task-ownership.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] gates 门禁：事实、版本及DoD映射全部通过。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && node packages/quality/scripts/devgate/check-dod-mapping.cjs DoD.md"
- [x] [BEHAVIOR] smoke 写入护栏：新smoke默认及显式生产目标拒绝且没有业务写请求；永久守卫验证覆盖真实shell入口。
  Test: manual:bash -c "node --test packages/quality/tests/smoke-production-guard.node-test.mjs packages/quality/tests/phone-dispatch-smoke-env.node-test.mjs"
- [x] [BEHAVIOR] required smoke合同：T1/F4精确十四执行器并核手机独立收口；script保留471历史名单并叠加508精确增量；手机身份smoke在allowlist唯一登记，永久执行真实Node合同块及完整script shell回归。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/__tests__/script-executor-contract-smoke.test.js src/__tests__/executor-contracts.test.js src/__tests__/migration-471-script-executor.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] legacy bridge一次有头接管（真实Linux507/手机508/接管509三独立迁移版本）：生产token、原路由、CAS幂等、活run/预约/callback拒绝、真实双连接advisory闸、普通writer及人赢元数据兼容，真实终态helper提交后持久保存handoff。

- [x] [BEHAVIOR] legacy bridge一次有头接管（真实Linux507/手机508/接管509三独立迁移版本）：生产token、原路由、CAS幂等、活run/预约/callback拒绝、真实双连接advisory闸、普通writer及人赢元数据兼容，真实终态helper提交后持久保存handoff；普通与有头legacy PATCH经真实HTTP/afterTerminalTransition/saveHandoff查库，失败ROLLBACK无handoff。普通无owner DELETE真实删行及CASCADE子行；owned DELETE拒绝且完整task/owner保留；ordinary UPDATE、missing DELETE零行与既有非cascade FK 23503保持。独立最低fixture叠加actual image510/Linux512及生产engine登记SQL，五种既有/新增kind与unknown拒绝、叠加后真实owned旧writer拒绝保持。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/headed-takeover.pg.integration.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] 迟到回执与session所有权：HTTP/队列/CAS持久屏障，原PATCH同session心跳兼容、跨session拒绝。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/routes/__tests__/execution-headed-callback-owner.test.js src/routes/__tests__/claim-protocol.test.js src/__tests__/executor-headed-liveness.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] 旧HTTP合同：未接管单PATCH缺失404及priority/initiative参数对齐保留；owner读取失败不UPDATE或入callback_queue，owner通过后的INSERT仍四次重试全失败503，真实owned迟到回执先拒绝。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run ../../tests/integration/execution-callback-await.test.js src/__tests__/routes/task-tasks.test.js src/routes/__tests__/task-tasks.test.js src/routes/__tests__/execution-headed-callback-owner.test.js src/lib/__tests__/headed-task-owner.test.js src/routes/__tests__/task-headed-takeover.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] headed HTTP限流：接管POST两注册路径、执行与字段PATCH真实第301请求429；双alias共享预算，错误认证计数，拒绝前不新增数据库/owner/终态副作用；固定draft7/Retry-After且无legacy头，原普通结果/metadata及接管合同保留。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/routes/__tests__/task-mutation-rate-limit.test.js src/routes/__tests__/task-task-patch.test.js src/routes/__tests__/task-headed-takeover.test.js src/routes/__tests__/headed-patch-transaction.test.js src/lib/__tests__/headed-task-owner.test.js src/routes/__tests__/tasks-result-backfill.test.js src/routes/__tests__/tasks-completed-gate.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] legacy bridge一次有头接管（真实Linux507/手机508/接管509三独立迁移版本）：生产token、原路由、CAS幂等、活run/预约/callback拒绝、真实双连接advisory闸、普通writer及人赢元数据兼容，真实终态helper提交后持久保存handoff；普通与有头legacy PATCH经真实HTTP/afterTerminalTransition/saveHandoff查库，失败ROLLBACK无handoff。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/headed-takeover.pg.integration.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] 旧HTTP合同：未接管单PATCH缺失404及priority/initiative参数对齐保留；owner读取失败不UPDATE或入callback_queue，owner通过后的INSERT仍四次重试全失败503，真实owned迟到回执先拒绝。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run ../../tests/integration/execution-callback-await.test.js src/__tests__/routes/task-tasks.test.js src/routes/__tests__/task-tasks.test.js src/__tests__/task-tasks-preflight-revival.test.js src/__tests__/task-type-registry.guard.test.js src/routes/__tests__/execution-headed-callback-owner.test.js src/lib/__tests__/headed-task-owner.test.js src/routes/__tests__/task-headed-takeover.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] 退役隔离验收：原守卫核DB、锁空连接串后运行唯一真实PG入口；私有API建单/GET、真实路由收据与dispatch/terminal/selector查退役事实；测试内allow/full/unknown/drain/billing保持原闸、普通邻居不变且零执行；本地仅scratch、CI仅test。覆盖范围不包含共享全局tick整轮。
  Test: manual:bash -c 'node --test packages/quality/tests/retire-harness-planner-smoke.node-test.mjs && cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/retired-harness-dispatch.pg.integration.test.js --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] C7 B2.2a 普通候选与认领隔离：固定SQL别名在helper、两类peek与worker LIMIT前排除真实phone执行器和owner，最终CAS与自属claim释放再次核对；NULL执行器和伪payload普通邻居保留优先级及预算，真实phone在途槽关联保持保守。真实两连接普通状态/认领竞态零发射；phone最终mutation为实际SQL负例，不冒称身份重绑竞态；本刀不包含manualdispatch、callback、cleanup或C8执行。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/dispatch-helpers.pg.test.js src/__tests__/integration/worker-pool-dispatch.pg.test.js src/__tests__/integration/recurring.pg.test.js src/phone-dispatch/schedule-store.pg.test.js src/phone-dispatch/recurring-dispatch.pg.test.js src/__tests__/task-queue-lanes.test.js src/__tests__/task-queue-lanes-route.test.js src/__tests__/dispatch-helpers.test.js src/__tests__/worker-pool-dispatch.test.js src/__tests__/dispatcher.test.js src/__tests__/dispatcher-claim-leak.test.js src/__tests__/dispatcher-hol.test.js src/__tests__/dispatcher-device-lock.test.js src/__tests__/dispatcher-xian-harness-bypass.test.js --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] C7 B2.2b 手动dispatch-now：原404/终态拒绝后、anchor/device前读取真实executor/owner资格，缺行与phone分别409、未知查询或布尔失败关闭；启动和失败回队最终SQL双谓词且实际rowCount必须1，只释放本请求锁一次。真实HTTP/private scratch证明三类phone零前置副作用、普通NULL/伪payload与原允许状态及成功/失败合同保留；普通双连接删除竞态与phone精确SQL负例分别验收，不扩callback或C8。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/execution-dispatch-now.pg.test.js src/__tests__/dispatch-now.test.js src/__tests__/dispatch-anchor-gate.test.js src/lib/__tests__/manual-dispatch-device-gate.test.js src/routes/__tests__/execution-headed-callback-owner.test.js src/__tests__/task-type-registry.guard.test.js src/__tests__/task-queue-lanes.test.js --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] C7 B2.3a 公共claim：两真实alias在mutation前以真实executor/owner查资格，仅true继续；caller phone执行器早400，phone409、missing404、未知读500，最终相同SQL谓词且rowCount/RETURNING一致。普通默认headed-session/真实471与509下bridge/原允许状态及完整claim冲突响应保留，普通双连接真认领竞态与phone精确SQL负例分别验证；真实509抑制普通物理DELETE为已知未部署兼容阻塞，不冒称删除竞态完成。本刀不含PATCH/DELETE/controller授权。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/task-tasks-claim.pg.test.js src/__tests__/integration/execution-dispatch-now.pg.test.js src/__tests__/integration/dispatch-helpers.pg.test.js src/__tests__/integration/worker-pool-dispatch.pg.test.js src/__tests__/integration/recurring.pg.test.js src/phone-dispatch/schedule-store.pg.test.js src/phone-dispatch/recurring-dispatch.pg.test.js src/routes/__tests__/claim-protocol.test.js src/routes/__tests__/task-tasks.test.js src/__tests__/routes/task-tasks.test.js src/routes/__tests__/task-task-patch.test.js src/lib/__tests__/headed-task-owner.test.js src/routes/__tests__/execution-headed-callback-owner.test.js src/__tests__/task-type-registry.guard.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] headed-authoring 集成：真实回执先核保留结果与authoring完成，再核有头owner，两读失败均不入队；原四次INSERT重试、普通PATCH与有头提交后交接保持，真实隔离数据库登记与共享活动均保留。
  Test: manual:bash -c 'cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/workflow-authoring/task-guard.test.js src/routes/__tests__/execution-headed-callback-owner.test.js ../../tests/integration/execution-callback-await.test.js --maxWorkers=1 --minWorkers=1 && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/headed-takeover.pg.integration.test.js src/__tests__/integration/workflow-authoring.pg.integration.test.js src/__tests__/integration/shared-activities.pg.integration.test.js --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] linuxcontroller 私有Symbol授权贯穿接入与canary父子登记；公开伪造拒绝；双探针与startup同步保持controller原claim，普通audit不享豁免。
  Test: manual:cd packages/brain && npx vitest run src/linux-pool/task-authority.test.js src/__tests__/liveness-probe.test.js src/__tests__/executor-startup-sync.test.js src/__tests__/external-executor-predicate.test.js

- [x] [BEHAVIOR] linuxcontrollerpg 增量512保留旧约束、未知kind拒绝，真实隔离PG双探针与启动同步保持父子任务；两个创建点均验证内部权限。
  Test: manual:cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/linux-controller-contract.pg.integration.test.js src/__tests__/integration/linux-onboarding-flow.pg.integration.test.js src/__tests__/integration/linux-script-authorization.pg.integration.test.js

- [x] [BEHAVIOR] canarystage 失败只持久内部固定阶段/时间/原错误码，外部异常文本不可注入；诊断先于cleanup，原签名/资源/终态条件不变。
  Test: manual:cd packages/brain && npx vitest run scripts/fleet-worker/linux-pool-proof.test.cjs scripts/fleet-worker/linux-script-canary.test.cjs

- [x] [BEHAVIOR] linuxretry 原官方入口仅接续具有原节点验收/路由/零spawn事件与固定误收错误的终态控制任务；原failed历史保留，容量/旧授权未知或其他claim拒绝，并发只登记一棒。
  Test: manual:cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/linux-onboarding-flow.pg.integration.test.js

- [x] [BEHAVIOR] linuxretrybudget 接续固定新工件及安装intent但保原预算与凭据cache；原预算缺失/空/非法/身份不匹配拒绝登记接续棒，probe必做全等，预算变化禁止安装；默认服务完整透传私有controller权限。
  Test: manual:cd packages/brain && npx vitest run src/linux-pool/onboarding-step.test.js src/node-onboarding/__tests__/service-controller-authority-forwarding.test.js

- [x] [BEHAVIOR] capabilityversions 真实PG验证不可变定义、身份匹配版本指针、来源字节核验、完整历史快照、共享幂等更新及注册层级防环；Workflow返回组织与版本状态。
  Test: manual:bash packages/brain/scripts/smoke/definition-versions-smoke.sh

- [x] [BEHAVIOR] capabilityinterfaces 固定KR来源和Skill摘要真实核验；登记参数拒绝与HTTP错误语义、旧接口默认值保持。
  Test: manual:cd packages/brain && npx vitest run src/lib/__tests__/company-kr-source.test.js src/lib/__tests__/definition-history.test.js src/lib/__tests__/definition-versions.test.js src/lib/__tests__/implementation-bindings.test.js src/lib/__tests__/journey-registration.test.js src/lib/__tests__/journey-organization.test.js src/routes/__tests__/journey-registration.test.js src/routes/__tests__/journeys.test.js src/routes/__tests__/promise-map-api.test.js --maxWorkers=1 --minWorkers=1

- [x] [BEHAVIOR] headed 孤儿设备锁：真实普通任务占锁/删除/清扫完整三NULL与幂等；共享闸忙55P03、未知新占锁、部分清理、换设备、重绑、非RC与owned历史状态拒绝且整行保留；仅私有schema实际065/448/509及外键，callback SQL语义fixture保原终态断言；新smoke受原生产守卫与已核DB目标固定，执行真实HTTP接管/提交后handoff和设备PG。
  Test: manual:bash -c 'node --test packages/quality/tests/headed-takeover-smoke.node-test.mjs && cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/headed-takeover.pg.integration.test.js src/__tests__/integration/device-lock-helpers.test.js src/__tests__/integration/callback-processor.integration.test.js --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] directoryschema 六层关系指向、稳定ID与机器列齐全；全库预检拒绝错类型/错目标，补缺幂等且真实响应读回，保人工列。
  Test: manual:cd packages/brain && npx vitest run src/projection/__tests__/directory-schema.test.js --maxWorkers=1 --minWorkers=1

- [x] [BEHAVIOR] directoryareas 组织树完整分页与明确身份绑定；原UUID和owner保留，人改名称/上级回灌，事件与改动同事务，错误或留痕失败零部分写，重复幂等。
  Test: manual:cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/directory-areas.pg.integration.test.js src/projection/__tests__/directory-areas.test.js --maxWorkers=1 --minWorkers=1

- [x] [BEHAVIOR] directorysource 六层保稳定真身ID与多消费者引用，显式两侧名称绑定，未知目录只报缺口，旧writer标题和收据不覆盖。
  Test: manual:cd packages/brain && npx vitest run src/projection/__tests__/directory-source.test.js src/projection/__tests__/directory-projector.test.js src/projection/__tests__/directory-runtime.test.js --maxWorkers=1 --minWorkers=1

- [x] [BEHAVIOR] directoryapi 正式鉴权入口白名单配置，单Capability目录bootstrap强读回幂等，schema错误零行写，分批周期与API接线永久覆盖。
  Test: manual:cd packages/brain && npx vitest run src/projection/__tests__/directory-config.test.js src/routes/__tests__/directory-projection.test.js --maxWorkers=1 --minWorkers=1

- [x] [BEHAVIOR] directoryreceipt 真scratch验证旧writer哈希保留、关系读回失败无成功收据、同页恢复不重复创建、bootstrap正式registry与目标配置同事务。
  Test: manual:bash packages/brain/scripts/smoke/directory-projection-smoke.sh

- [x] [BEHAVIOR] 整链迁移：实际495生成spans后叠加主线511共享活动、512Linux、513不可变定义、514发生位置；未发布Hub515/历史HTTP516/定时517独立真账，真实runMigrations不SKIP手机、重跑0新增；所有手机夹具仅自有私有schema，无public fallback。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/migrate-phone-chain.pg.test.js src/phone-dispatch/http-binding.pg.test.js src/phone-dispatch/store.test.js src/phone-dispatch/schedule-store.pg.test.js src/phone-dispatch/recurring-dispatch.pg.test.js src/__tests__/integration/recurring.pg.test.js src/__tests__/integration/dispatch-helpers.pg.test.js src/__tests__/integration/worker-pool-dispatch.pg.test.js src/__tests__/integration/execution-dispatch-now.pg.test.js src/__tests__/integration/task-tasks-claim.pg.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] 整链兼容：C7唯一createTask保持main Linux私有权限两事务分支/image/GPU；普通DELETE真实第二会话删除1后claim404，owned仍受守卫，509孤儿三NULL清扫保持；authoring→headed callback双门和四INSERT保留。
  Test: manual:bash -c 'cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/lib/task-create.test.js src/linux-pool/task-authority.test.js src/routes/__tests__/execution-headed-callback-owner.test.js src/__tests__/task-creation-inventory.test.js src/__tests__/task-type-registry.guard.test.js --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] 手机夹具仅本地scratch/精确CI test，非法CI库在连接前拒绝。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run src/__tests__/fixtures/phone-claim-schema.test.js --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] B23b公开PATCH：真实执行器及owner在任何审核阻塞/终态/harness副作用前拒绝公开执行写；nested纯标题/优先级/描述保人赢且phone描述不隐式回队，普通恢复及完成闸、有头同会话提交后handoff保；最终执行UPDATE双谓词与实际计数、缺行真实DELETE404及未知资格失败关闭。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/task-tasks-patch.pg.test.js src/__tests__/integration/headed-takeover.pg.integration.test.js src/routes/__tests__/task-phone-patch.test.js src/routes/__tests__/task-task-patch.test.js src/routes/__tests__/task-mutation-rate-limit.test.js src/routes/__tests__/tasks-result-backfill.test.js src/routes/__tests__/tasks-completed-gate.test.js src/routes/__tests__/tasks-completed-no-pr.test.js src/routes/__tests__/tasks-canceled-transition.test.js src/routes/__tests__/tasks-lifecycle-timestamps.test.js src/__tests__/harness-completion-authority.test.js --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] B23c软DELETE：同handler两真实HTTP入口在UPDATE前排真实phone执行器/owner，最终SQL同时保护phone及completed/cancelled；缺行404、终态409、unknown500和实际计数一致0/1，无假取消成功；普通NULL状态/执行器与伪payload照常取消，真实第二连接DELETE/完成/取消竞态及finalSQL负例独立，driver adapter单列，无执行器清理或新授权。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/task-tasks-delete.pg.test.js src/__tests__/integration/task-tasks-patch.pg.test.js src/__tests__/integration/task-tasks-claim.pg.test.js src/routes/__tests__/task-tasks.test.js src/__tests__/routes/task-tasks.test.js src/__tests__/task-type-registry.guard.test.js --maxWorkers=1 --minWorkers=1'
