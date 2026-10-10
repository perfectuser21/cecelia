# 自动裁判等运行结束再判（PR #6179 审查阻断项）

任务：2f50cf2a-1cda-41d3-ba81-3c9efd1017c5；父任务：add0acfc-2c79-4e82-b6e8-f3b15a3dfbbd。

- [x] [BEHAVIOR] activityjudgedefer 按 Step 逐条上报的运行跑到一半不裁判：自动触发先 applyCell:false 对账，触发运行有 missing、无 failed、最后一条 span 在静默期内（默认 10 分钟，ACTIVITY_JUDGE_RUN_IDLE_MS）→ 返回 deferred，不写 activity_judgments、readback 不翻红，调度器放回待判队列过了静默期自动重判；补齐后落 converging；过静默期仍缺步按真实结果落 diverged 并翻红；新 span 不跟着等重判定时器；翻色出错只记日志。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/activity-judge.test.js src/lib/__tests__/step-reconcile.test.js src/routes/spans-judge-hook.test.js src/routes/skill-settlement.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] activityjudgedeferpg 真 PG：两 Step 的 Activity，r1/r2 全绿、r3 只报第 1 步处理一次 → activity_judgments 不新增、readback 不是 red；补第 2 步再处理 → 落一条 converging（连续绿 3）；静默期过后仍缺步 → diverged 且翻红。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/activity-judgments.pg.integration.test.js src/__tests__/integration/step-reconcile-settlement.pg.integration.test.js --maxWorkers=1 --minWorkers=1"

# Workspace跨仓CI固定来源与真实消费验收
- [x] [BEHAVIOR] resourcehealthholfix 资源健康闸审查修复（任务 a43b8ad9，父任务 5bf2512a）：dispatcher 候选循环与秋米路由被健康闸挡下的单进独立的 resourceSkipIds，不再占 HOL 让位名额（上限 10），只受自己的上限 100（超了记 resource_skip_cap_exceeded）；队首 12 张引用同一风控账号的单后面的普通任务照常派发、不出现 hol_skip_cap_exceeded。秋米 device 出口在 persistDecision 之前过健康闸：定到的手机或它台账里当前登录的抖音号（phone_registry.douyin_accounts current=true）offline/restricted → 不派生 device_job、放 claim、记 resource_unhealthy；被挡的单下一轮先复查那台手机，仍不健康不再打 Jev；健康表/台账查询出错一律放行。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/dispatcher-resource-health.test.js src/__tests__/dispatcher-qiumi-device-health.test.js src/__tests__/dispatcher-qiumi-routing.test.js src/lib/__tests__/qiumi-resource-health.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] resourcehealthwarehouse 资源健康进仓库（决策 de6dff5d 第 5 步，任务 5bf2512a）：迁移 539 新建 resource_health（一资源一行：account/phone/machine/warehouse_item/service/other × healthy/degraded/offline/restricted/unknown，原因/证据/来源/库时钟观测时间/status_since，可挂 warehouse_items）与 resource_health_events（插入与状态变化由触发器记历史，psql 直改也留痕，同状态不记），视图 v_warehouse_item_health 给每件仓库物件的最差状态；不另造设备表，手机键=serial、账号键=<平台>:<账号id>。账号切换三态判据（列表消失=offline、要身份校验/人脸=restricted 立即退出不验证、切换成功=healthy），POST /resource-health/report 与 /account-switch（内部令牌，不健康必带证据）；POST /resource-health/check 调度前检查；dispatcher 候选循环、秋米新路由、worker 池、两个手动派发入口派前查健康，offline/restricted 不派并给原因（task_events 去重留痕），闸出错一律放行；变成掉线/风控走 Bark（6 小时去重）+ P1，降级 P1，恢复 P2，告警失败不影响写入。scratch 升级→回滚→再升级通过，smoke 在迁移缺失时报红。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/resource-health.test.js src/lib/__tests__/resource-health-alert.test.js src/lib/__tests__/resource-health-gate.test.js src/routes/resource-health.test.js src/__tests__/dispatcher-resource-health.test.js src/__tests__/worker-pool-resource-health.test.js src/lib/__tests__/manual-dispatch-resource-health.test.js src/__tests__/migration-539-resource-health.test.js --maxWorkers=1 --minWorkers=1"


- [x] [BEHAVIOR] activityjudgments 裁判接线（决策 de6dff5d 五块模型第 2 步）：POST /spans 写入成功后，新插入的 span 经 Step 找到归属 Activity，去抖（默认 30s，ACTIVITY_JUDGE_DEBOUNCE_MS；ACTIVITY_JUDGE_AUTO=off 关闭）异步跑 reconcileActivity，结果只追加写入迁移 538 新表 activity_judgments（verdict/连续绿/要求绿/窗口运行数/触发方式与运行/定义版本/完整报告，UPDATE/DELETE 被触发器拒绝），readback 格同时翻色；钩子出任何错只记日志，上报照常 200；POST /step-reconcile 同样记一条手动裁判。新增 compareActivityVersions：同一 Activity 候选版本 vs 基线版本按 spans.activity_definition_version_id 分组，比成功率/读回 verified 比例/观测形状一致性，给 not_worse/worse/insufficient_data（样本下限默认 5）带数字依据；GET /activities/:id/judgments/latest、/judgments、/version-compare 可查。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/activity-version-compare.test.js src/lib/__tests__/activity-judge.test.js src/routes/activity-judgments.test.js src/routes/spans-judge-hook.test.js src/routes/skill-settlement.test.js src/__tests__/migration-538-activity-judgments.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] workspacecisourcebundle：真实固定Git来源提取两准确caller/reader、分别固定BrainSHA的callee/job源码与hash，严格既有F3身份；source集合不混repo/revision，未知来源及协议缺口拒认、始终不可执行。
  Test: manual:node --test scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs

- [x] [BEHAVIOR] reposcopedassertions：只执行精确固定工具链的manual Node测试协议；来源仓库独立于Brain定义锚，旧null断言兼容，伪造receipt与工具链身份拒绝。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/gp-assertion-command.test.js src/lib/__tests__/gp-assertion-toolchain.test.js src/lib/__tests__/gp-assertion-process.test.js src/lib/__tests__/gp-assertion-output.test.js src/lib/__tests__/implementation-consumers.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] factoryregistryboundary 真实main/CAS登记、生产refresh拒外部proof与scratch重放，保全部旧current和注册。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/existing-ops-registration.pg.integration.test.js -t 'factory source anchor|生产登记拒scratch|生产refresh拒绝|真实main消费者|人改slot|main已移动|工厂source导出|正式refresh只读|候选只在真实scratch|工厂冻结来源' --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] factorydualreposnapshot 真实双Git来源、F3锁内追加、actual隔离库导入/重建，分别扫描Workspace与Brain固定树并核两图身份。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/existing-ops-registration.pg.integration.test.js -t '实际scratch双Git' --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] factoryhistoryassertions 固定source_set、生产认证main证据与严格F3历史查询，八引用和六UNKNOWN保持，独立仓库断言与影响查询真实PG回归。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/factory-consumer-snapshot.pg.integration.test.js src/lib/__tests__/integration/capability-regressions.test.js src/__tests__/integration/implementation-impact.pg.integration.test.js --maxWorkers=1 --minWorkers=1"


# PRD / DoD：Workspace 两固定配置验证消费关系

任务：15ac5200-a7c6-4e71-b2c5-18b48c442180；父任务：dffd5885-46f7-4cf1-b55b-8729497b9928。

Workspace 两份真实发布入口配置由两个精确测试读取和 YAML parse，已有 nightly 专用 verification_config 无法表达其独立消费协议。本刀只支持 perfectuser21/zenithjoy-workspace 的 implementation-impact.yml / pilot-release-verification.yml，与各自 scripts/ci/__tests__ 下固定 reader 一一对应。固定 Git SHA 冻结 reader、输入与永久 CI 的摘要；CI collector 的公开 ESLint AST 核真实导入绑定、literal new URL、YAML.parse/readFileSync 返回函数和 node:test 的真实可达调用。caller-contract 必须永久直接 node --test，并由 impact / verify needs 承接。

reader 的精确身份不授予业务归属。必须已有真实 F3 frozen consumer_evidence 图认领，否则继续 UNKNOWN；不借 loader 或任意 JS。其余既有角色继续拒绝 test/spec 父模块。初始机制 PR 不携带新关系自授权，只沿用正式 current assertion 的真实测试引用与原生 imports。跨仓生产来源 bundle 与多 scope caller 由独立正规实现处理，本刀不引 CI ESLint 依赖进生产。

只改 CI collector 与永久回归；没有 Brain runtime、版本静态修改或依赖新增。版本继承主线，保持现行发布策略。

- [x] [BEHAVIOR] workspaceconfigproof 固定 Git 两准确 Workspace reader/CI 消费链获得独立辅助证据，缺图认领仍 UNKNOWN；摘要、范围、模块/变量 shadow、注释、跳过/死分支、任意 YAML/SQL、错仓库与伪 CI 调用全部拒绝，执行入口重算同 SHA。
  Test: manual:bash -c "cd packages/brain && npx vitest run scripts/ci/__tests__/implementation-auxiliary-evidence.test.mjs --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] workspaceconfigcompat 原 nightly 精确角色、普通辅助角色、release 精确消费与原有治理语义保持；事实、版本同步及 DoD 映射一致。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/implementation-ci-gate.test.js src/lib/__tests__/implementation-ci-governance.test.js src/__tests__/auto-version-apply.test.js --maxWorkers=1 --minWorkers=1 && cd ../.. && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs DoD.md"

- [x] [BEHAVIOR] B-06 原生短形定义保留合法定义边并拒绝空路径，跨仓仍拒伪同名依赖；旧pilot_v1不扩大Node发布资格。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run ../../tests/regression/probe-definition-edges/definition-edges.test.js src/lib/__tests__/pilot-release-regression-scope.test.js src/lib/__tests__/gp-assertion-command.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] B-07 共享发布PG夹具按真实537迁移建立断言来源列与约束，旧名视图重建；所有pilot与仓库来源回归使用同一夹具，不由单个测试临时补列。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/fixtures/definition-versions-db.test.js src/__tests__/fixtures/release-evidence-db.test.js src/lib/__tests__/integration/pilot-release-verification.test.js src/__tests__/integration/pilot-release-ci.pg.integration.test.js src/lib/__tests__/integration/capability-regressions.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] B-08 配套测试直接执行真实来源身份与准入边界；既有纯协议用例归同名单元测试，双Git与实际PG覆盖保留，官方test-pairing不豁免。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/consumer-source-set.test.js src/lib/__tests__/workspace-ci-source-bundle.test.js src/lib/__tests__/existing-ops-registration.test.js --maxWorkers=1 --minWorkers=1 && cd ../.. && bash .github/workflows/scripts/lint-test-pairing.sh origin/main"

- [x] [BEHAVIOR] B-09 跨仓来源正式smoke执行真实双Git固定树、准入边界与真实PG/HTTP发布链；unsafe数据库在任何测试前拒，正式allowlist接入不豁免。
  Test: manual:bash -c "NODE_ENV=test bash packages/brain/scripts/smoke/workspace-ci-source-bundle-smoke.sh"

- [x] [BEHAVIOR] ownprscopecontract：固定Git端到端验收唯一明确的本仓PR双scope默认表达式；旧式兼容，删repo/PR限制、扩大scope、未知schema及错误MODE拒绝，admission仍unknown。
  Test: manual:node --test scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs

- [x] [BEHAVIOR] workspacejointsource：真实PG在同事务导出Workspace父与独立跨仓Factory来源，明确Brain anchor与冻结source_set；scratch不授生产、重算hash篡改仍拒、子UNKNOWN保留且单scope父可用，实际CLI接受精确跨仓双scope但UNKNOWN不写文件，KR原生joint保持。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/factory-consumer-snapshot.pg.integration.test.js src/__tests__/integration/implementation-admission-companion.test.js src/__tests__/integration/implementation-multi-scope.test.js --maxWorkers=1 --minWorkers=1"
