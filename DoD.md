# DoD — 受控再基恢复
- [x] [BEHAVIOR] sqlstandardnames v3.0 第 2 刀 b 段：生产代码（packages/brain/src 与 scripts/ci）里的 SQL 全部改写标准表名 activities / activity_cells / warehouse_items，不再往旧名视图读写（守卫测试抓 FROM/JOIN/INTO/UPDATE/TABLE/EXISTS/REFERENCES 与列限定写法，注释、对外 API 路径、Notion 注册表键、RENAME TO 重放除外）；新增 /activity-cells、/warehouse-items 路径别名；隔离 schema 夹具镜像生产形状（真表标准名 + 旧名视图，重放旧迁移期间临时叫回旧名）；匹配 SQL 的单元/集成/根测试随之改到标准名。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/sql-standard-table-names.test.js src/__tests__/vocab-alias.test.js src/__tests__/activity-contract-sync.test.js src/__tests__/notion-push-sync.test.js src/routes/__tests__/journeys.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] physicalrename v3.0 第 2 刀 a 段：迁移 522 把 journey_steps/journey_step_links/enablers 三张物理表换成标准名 activities/activity_cells/warehouse_items 并让旧名降为自动可更新视图（先删 521 的标准名视图再改名再建旧名视图），主键/唯一/CHECK 约束名随表，enforce_harness_gap_transition 与 journeys_child_after_delete 改指新名，投影注册表不动；回滚完全可逆；按旧表名查目录/约束/索引或用 LIKE 复制结构的 8 个集成测试与 dev-registry 随之改到标准名。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-522-physical-rename.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] activitycolumns v3.0 第 1 刀：迁移 521 给 Activity 加 10 列并从 contract JSON 拆填（只填空值）、Step 加 name/action/inputs/outputs/on_fail（on_fail 只许 retry:N|abort）、activity_items 改名 activity_uses、8 格固定（旧格子名映射到 8 个标准键、其余格子标 parent_cell_key 子项、每个未退役 Activity 补齐 8 个灰格并记备份）、有流程无关系行的 Activity 补 workflow_activity_refs、标准名视图重建带新列；回滚先删视图再去列、按备份还原格子名与删补行。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-521-activity-columns.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] treetables 表名对齐框架标准第一段：迁移 520 把 journeys 拆成 value_streams/capabilities 两张继承真表（父表空壳 + INSERT 分流触发器且子表已有同 id 按 DO NOTHING 跳过，SELECT/UPDATE/FOR UPDATE 照旧），workflows 外键改指 capabilities、其余 10 张引用表改触发器守卫并照原语义级联；activities/activity_cells/warehouse_items 标准名以自动可更新视图立起（物理表不改名，旧迁移重放与几十个按旧名查索引/约束/LIKE 的测试不受影响）；50 个挂价值流的 Activity 归位到能力（新建 2 能力 5 流程）；enablers 加 shelf 八货架 NOT NULL+CHECK，22 件物件全上架并带旧树溯源，activity_items/item_deps 连线建表并从 enabler_calls/底座格子合并；两个带 notion_id 的标准名视图登记进投影注册表；ability_groups 孤儿表条件化；备份表 + 回滚可逆。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-520-tree-tables-align.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] workflowlayer 流程层登记：迁移 519 把 22 条旧 ability 转成 workflows 流程（legacy_feature_id 溯源、全部 INSERT 带能力存在守卫、ON CONFLICT 幂等），26 个有闹钟的能力补默认流程，闹钟先归位能力（价值流上的 OKR 闹钟→G5、未挂的按实际归位、收盘报告→经营播报、热点/天气保持个人区）再按能力→流程回填 workflow_id 只填空值；旧树只标 deprecated 不删（PC 发布套 21、重复 11、已转换 22 带 workflow_ref、smoke 垃圾）；原值进 migration_519_backup，回滚按备份还原并删溯源列。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-519-workflow-layer.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] vocabunify 词表统一：迁移 518 按 notion_db_id 把 5 个镜子库标题同步为标准词表且带回滚；Dashboard 面向人的 JSX 文本与 label/tooltip 不再出现 Journey/Golden Path/GP，改为 价值流/能力；表名列名 API 路径不动。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-518-vocab-unify-titles.test.js --maxWorkers=1 --minWorkers=1 && cd ../.. && node --test scripts/vocab-unify-labels.test.mjs"

- [x] [BEHAVIOR] deployhealthz 部署链剩余两处 healthy 硬编码：sidecar 的 /healthz 探针在封停 tick（503 且 db=connected）下放行、DB 异常仍失败；Auto Staging Deploy 的等待脚本对封停 tick 的 degraded 与部署收账同口径视为就绪，断路器 OPEN 与非封停原因的 degraded 仍超时失败。
  Test: manual:bash -c "node --test scripts/bluegreen-sidecar-completion.test.mjs scripts/brain-image-retention-health.test.mjs && bash scripts/__tests__/wait-for-production-sha.test.sh && bash scripts/__tests__/bluegreen-sidecar-drain-log.test.sh"

- [x] [BEHAVIOR] sidecarhealth 蓝绿 sidecar 健康确认与官方收账同口径：tick 被有意封停导致的 degraded 折算 healthy 后完成 drain 恢复与 ledger 收尾；无该折算依据（缺 organs、断路器 OPEN）仍非零并保持 pending；导入失败按严格口径。
  Test: manual:bash -c "node --test scripts/bluegreen-sidecar-completion.test.mjs scripts/brain-image-retention-health.test.mjs && bash scripts/__tests__/bluegreen-sidecar-drain-log.test.sh"

- [x] [BEHAVIOR] deployhealth 部署收账健康口径：tick 被有意封停导致的 degraded（调度器 enabled=false、无断路器 OPEN、docker/fleet 无异常）折算为 healthy，其余 degraded/critical 与缺字段一律不折算；version 与 git_sha 原样返回，收账仍逐项核对部署身份；真实 HTTP 读取同口径。
  Test: manual:bash -c "node --test scripts/brain-image-retention-health.test.mjs scripts/brain-image-retention-runtime.test.mjs scripts/brain-image-retention-docker.test.mjs scripts/brain-image-retention-ledger.test.mjs"

- [x] [BEHAVIOR] alarmledger 闹钟总账扩现成排程台账不建新表：迁移517加15列；机器 upsert 只动机器列、人工列/挂树列/登记列原样保留；非法 ledger_status/last_status/registered_via 被 CHECK 拦下。
  Test: manual:bash packages/brain/scripts/smoke/alarm-ledger-smoke.sh

- [x] [BEHAVIOR] alarmledger 72个Brain job与recurring模板经真实PG落总账（周期结构化、降噪、下线置inactive、失败不拖垮活性），盘点静态快照导入幂等只补空并支持干跑，alarms接口读出挂树路径/暂存文字/停用状态，job漏声明cadence或重名即红。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/ops-alarm-ledger.test.js src/__tests__/ops-alarm-import.test.js src/__tests__/ops-alarm-ledger.pg.integration.test.js src/__tests__/scheduler-jobs.test.js src/__tests__/ops-scheduler-liveness.test.js src/__tests__/ops-collector.test.js src/routes/__tests__/agent-ops.test.js src/routes/__tests__/agent-ops-alarms.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] deadmanswitch 死人开关连接参数经 DMS_PG* 可配置（MMV 经隧道指 us-vps 生产库），按窗口内报到键数判活、孤儿哨兵键不误报，报到不足/连不上库必告警；opc-watchdog 纳入仓库并去掉退役网关探针。
  Test: manual:bash packages/brain/scripts/smoke/dead-man-switch-usvps-smoke.sh

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
- [x] [BEHAVIOR] ledger 持久台账：真实PostgreSQL验证已部署image510后补缺号508与507独立台账及十三执行器，验证同单唯一预约、同机互斥、一次launch、丢回复保留占位、认证回执幂等结算及旧writer保护。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/phone-dispatch/store.test.js src/__tests__/integration/execution-directory.pg.integration.test.js src/__tests__/integration/script-capacity-reservation.pg.integration.test.js src/app-server/__tests__/integration/store.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] ownership 兼容合同：独立controller不交普通派发器终止，保留历史471名单并核对后续合法增量；手机独立所有权跨180分钟不误回队，旧device宽限保留。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/__tests__/executor-contracts.test.js src/__tests__/migration-471-script-executor.test.js src/__tests__/executor-headed-liveness.test.js src/phone-dispatch/task-ownership.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] gates 门禁：事实、版本及DoD映射全部通过。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && node packages/quality/scripts/devgate/check-dod-mapping.cjs DoD.md"

- [x] [BEHAVIOR] smoke 写入护栏：新smoke默认及显式生产目标拒绝且没有业务写请求；永久守卫验证覆盖真实shell入口。
  Test: manual:bash -c "node --test packages/quality/tests/smoke-production-guard.node-test.mjs packages/quality/tests/phone-dispatch-smoke-env.node-test.mjs"

- [x] [BEHAVIOR] required smoke合同：T1/F4精确十三执行器并核手机独立收口；script保留471历史名单并叠加508精确增量；手机身份smoke在allowlist唯一登记，永久执行真实Node合同块及完整script shell回归。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/__tests__/script-executor-contract-smoke.test.js src/__tests__/executor-contracts.test.js src/__tests__/migration-471-script-executor.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] legacy bridge一次有头接管（真实Linux507/手机508/接管509三独立迁移版本）：生产token、原路由、CAS幂等、活run/预约/callback拒绝、真实双连接advisory闸、普通writer及人赢元数据兼容，真实终态helper提交后持久保存handoff；普通与有头legacy PATCH经真实HTTP/afterTerminalTransition/saveHandoff查库，失败ROLLBACK无handoff。普通无owner DELETE真实删行及CASCADE子行；owned DELETE拒绝且完整task/owner保留；ordinary UPDATE、missing DELETE零行与既有非cascade FK 23503保持。独立最低fixture叠加actual image510/Linux512及生产engine登记SQL，五种既有/新增kind与unknown拒绝、叠加后真实owned旧writer拒绝保持。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/headed-takeover.pg.integration.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] 迟到回执与session所有权：HTTP/队列/CAS持久屏障，原PATCH同session心跳兼容、跨session拒绝。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/routes/__tests__/execution-headed-callback-owner.test.js src/routes/__tests__/claim-protocol.test.js src/__tests__/executor-headed-liveness.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] 旧HTTP合同：未接管单PATCH缺失404及priority/initiative参数对齐保留；owner读取失败不UPDATE或入callback_queue，owner通过后的INSERT仍四次重试全失败503，真实owned迟到回执先拒绝。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run ../../tests/integration/execution-callback-await.test.js src/__tests__/routes/task-tasks.test.js src/routes/__tests__/task-tasks.test.js src/__tests__/task-tasks-preflight-revival.test.js src/__tests__/task-type-registry.guard.test.js src/routes/__tests__/execution-headed-callback-owner.test.js src/lib/__tests__/headed-task-owner.test.js src/routes/__tests__/task-headed-takeover.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] 退役隔离验收：原守卫核DB、锁空连接串后运行唯一真实PG入口；私有API建单/GET、真实路由收据与dispatch/terminal/selector查退役事实；测试内allow/full/unknown/drain/billing保持原闸、普通邻居不变且零执行；本地仅scratch、CI仅test。覆盖范围不包含共享全局tick整轮。
  Test: manual:bash -c 'node --test packages/quality/tests/retire-harness-planner-smoke.node-test.mjs && cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/retired-harness-dispatch.pg.integration.test.js --maxWorkers=1 --minWorkers=1'

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

- [x] [BEHAVIOR] fixture安全：精确库与本地/tmp在connect前核验；ownschema真实495及地图402/405/407/410约束，actual059/494及发布515缺失拒绝，pool并发/失败清理真实核；原实现影响与发布证据smoke完整执行，原断言及生产SQL保持。
  Test: manual:bash -c 'export DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL=""; if [ "${CI:-}" != true ]; then export DB_HOST="${DB_HOST:-/tmp}"; fi; cd packages/brain && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/definition-versions.pg.integration.test.js src/__tests__/fixtures/definition-versions-db.test.js src/__tests__/fixtures/release-evidence-db.test.js --maxWorkers=1 --minWorkers=1'


- [x] [BEHAVIOR] 固定两跳协议：受信节点端点与中枢清单绑定，固定argv/JSONstdin，严格known_hosts；nonce、退出码、输出限额、完整身份及终态退出/解锁证据校验后才认证。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/phone-dispatch/client.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] 持久一次启动：真实fork并发只执行一次，原回执重读幂等，fsync失败与launcher死亡保持未决；cancel-before-start永久墓碑，未知不重新启动；永久真实fork+setsid回归证明不再exec能派生后代的外部ADB。
  Test: manual:bash -c "python3 -B -m unittest discover -s packages/brain/scripts/phone-ssh -p test_*.py"

- [x] [BEHAVIOR] 精确进程与旧锁兼容：真实fcntl、限时孩子、SSH描述符脱离、boot/PID/starttime绑定；只释放自己的lease，旧stale锁和同事锁保留，不关闭APP；最终查询前再次检查drain，默认资源hook拒绝。首动作只查既有127.0.0.1:5037 ADBserver，不自动启动daemon；真实socket分片/FAIL/EOF/长度/总超时及取消覆盖，不能推广为通用业务进程树退出证明。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run scripts/phone-ssh/runner.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] 基线合同：持久身份、receipt字段和旧device_job宽限保留；新SSH工具没有Brain生产runtime接线或默认grant。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/phone-dispatch/identity.test.js src/phone-dispatch/contracts.test.js src/phone-dispatch/task-ownership.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] 门禁：事实、版本及DoD映射通过；本刀范围限本地真实进程与协议库，HTTP调度与生产激活仍属下一刀。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs"

- [x] [BEHAVIOR] phonrunnerinfra 真实smoke直接执行固定SSH client身份/protocol与Python永久回归，仅自有临时进程、锁和socketfixture；生产资源/HTTP activation仍拒绝，不连接DB、API、设备或既有5037。
  Test: manual:bash packages/brain/scripts/smoke/phone-runner-infra-smoke.sh

- [x] [BEHAVIOR] cliseed 真实privatePG与Git设置链在完整402不可变约束下以新decision/manifest版本及对应projection生成base/head verified快照，历史内容不UPDATE；本地只验证seed-only，完整CLI仍由正式CI执行。
  Test: manual:bash -c 'export DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL=""; if [ "${CI:-}" != true ]; then export DB_HOST="${DB_HOST:-/tmp}"; fi; cd packages/brain && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/implementation-ci-cli.pg.integration.test.js -t seedonly --maxWorkers=1 --minWorkers=1'

- [x] [BEHAVIOR] callerseed 能力展示与coverage复用真实私有表；company/pilot最低schema保FK与不可变约束，设置链拒public复制；完整CLI及pilot首例留正式CI验收。
  Test: manual:bash -c 'export DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL=""; if [ "${CI:-}" != true ]; then export DB_HOST="${DB_HOST:-/tmp}"; fi; cd packages/brain && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/lib/__tests__/integration/capability-system.test.js src/routes/__tests__/integration/capability-system.test.js src/lib/__tests__/integration/capability-source-coverage.test.js src/routes/__tests__/integration/capability-source-coverage.test.js src/lib/__tests__/integration/implementation-ci-company.test.js --maxWorkers=1 --minWorkers=1 && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/lib/__tests__/integration/implementation-ci-pilots.test.js -t "seedonly|Cecelia事实alias|boundaryonly" --maxWorkers=1 --minWorkers=1 && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/implementation-ci-cli.pg.integration.test.js -t "seedonly|boundaryonly" --maxWorkers=1 --minWorkers=1'
