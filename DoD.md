# OPC 巡检配置迁移修复（任务 de5194d0）

- [x] [BEHAVIOR] opcconfiglookup OPC CLI 在 MMV 读取当前用户的 openclaw.json，显式 OPENCLAW_CONFIG_PATH 优先且配置不存在、无权限、坏 JSON、账号字段缺失均失败关闭；旧 Linux 路径保留，错误不泄露凭据；真实只读查询返回经营对象。新增同次快照分批入口每批最多50条，完整覆盖所有命中记录；旧单批安全上限保持。
  Test: manual:bash scripts/ops/__tests__/opc_objects_config.test.sh

# 统一领单租约 + 心跳 + 设备锁跟租约走 + 设备池（任务 c5f6e683，派发总闸 G）

- [x] [BEHAVIOR] taskleaseclaim POST /tasks/:id/claim 带 lease_seconds 落 task_leases 并返回 lease_until（on_lease_expire 非法 400、不带租约行为不变）；POST /tasks/:id/heartbeat 同领单方续约并把持有的设备锁 expires_at 拉到租约，认领换人/任务终态/租约已回收 → 409 lease_lost；/lease/release 主动关租约。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/routes/__tests__/claim-protocol.test.js src/routes/__tests__/task-lease.test.js src/lib/__tests__/task-lease.test.js src/lib/__tests__/device-pool.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] taskleasereaper task-lease-reaper 收过期租约：onStale=requeue/release-claim-and-alert 回队（满 3 次判 failed）、外部执行体判 lost（lease_expired）并放设备锁；任务终态/认领换人只关租约；Brain 租约过期先探活（alive 续、dead 宽限、unknown 判 lost）；设备锁占用判据改为 in_progress 且租约未过期，无租约旧持有者最多保护 240 分钟；设备池按 priority 试锁、被占/不健康换下一台、全被占 all_busy。
  Test: manual:bash -c "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_scratch} DB_HOST=${DB_HOST:-/tmp} DB_USER=${DB_USER:-administrator} npx vitest run --config vitest.integration.config.js src/__tests__/integration/task-lease-device-pool.pg.integration.test.js src/__tests__/integration/device-lock-helpers.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] douyinpooldispatch 抖音视频发布 workflow_dispatch 登记 device.pool=douyin.internal，派发从池里选机、调度单写选中那台（留痕 device_pool_selected），全被占只等不接管、池空 failed；workflow_dispatch 与 openclaw-agent 起跑后落 Brain 租约（超时+15 分钟）。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/workflow-commander-device-pool.test.js src/lib/__tests__/workflow-commander-dispatch.test.js src/__tests__/openclaw-agent-executor.test.js src/__tests__/scheduler-jobs.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] executorlease factory-dispatcher 认领带 600s 租约、等锁/守望每轮心跳，409 停手（杀会话、放自己的锁、不回写）；coding-workflow-runner 认领带 900s 租约、执行期心跳，409 中止执行器不回写终态；旧 Brain 无心跳端点（404）不中断。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run scripts/factory-dispatcher/__tests__/factory-dispatcher.test.js scripts/coding-workflow/runner/__tests__/run-once-lease.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs --maxWorkers=1 --minWorkers=1"
# Projects 双向同步与 AI 参与（任务 97024a3b）

- [x] [BEHAVIOR] projectsnotionsync 全量推送并修正规划/归档状态；Notion 新项目幂等导入和 Run ID 失败重试；人工列三方合并与冲突审计；保留人工正文；分页失败不推进游标。
  Test: manual:bash packages/brain/scripts/smoke/projects-notion-sync-smoke.sh
- [x] [BEHAVIOR] projectaitier POST/PATCH 档位校验；迁移默认知情、三个档位约束和 Notion 关联唯一，隔离 PostgreSQL 真实验证。
  Test: manual:bash packages/brain/scripts/smoke/projects-notion-sync-smoke.sh

# 派发只认路由表：无执行者建单即拒 + 工厂/编码独立 task_type + 清卡死单（任务 0a70684f，派发总闸 F）

- [x] [BEHAVIOR] dispatchroutegate lib/dispatch-route.js 按 executor 分支顺序判真实路由；注册表 surface 与真实路由一致（talk/research/data → codex-bridge，dev/trigger_backup 等 → none）；createRoutedTask 对 queued + 无执行者（退役 Claude 桥接 / 退役 harness / workflow_run 镜像）建单即拒 code=no_executor_for_task_type，事务回滚不 INSERT，POST /tasks 返回 422 带 reason_code；headed_manual 与非 queued 不拦。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/dispatch-route.test.js src/__tests__/work-routing-store-dispatch-gate.test.js src/__tests__/work-routing-store.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] factorycodingtypes 技能工厂执行单/核验单立 skill_factory_run、编码 workflow 立 coding_workflow（迁移 550 进 tasks_task_type_check），tick 按类型排除不再靠 headed_manual；推进器/裁判建新类型，factory-dispatcher 只领该类型（兼容旧借壳 research），coding-workflow-runner 列 data+coding_workflow 两类、new-task 建新类型；建单时旧借壳形状自动归一新类型。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/factory-pusher.test.js src/lib/__tests__/factory-judge.test.js scripts/factory-dispatcher/__tests__/factory-dispatcher.test.js scripts/coding-workflow/runner/__tests__/plan.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs src/lib/__tests__/task-type-registry.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] stuckqueuecleanup 迁移 550 把在途借壳单迁新类型（插接班路由收据，逐条写 task_events task_type_migrated）；迁移 551 按清单处置卡死单（a55c7664 trigger_backup → cancelled，02383d3f 守望中断工厂执行单 → failed），id+状态守卫幂等，逐条写 task_events dispatch_gate_cleanup。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/__tests__/migration-550-551-dispatch-gate.test.js --maxWorkers=1 --minWorkers=1"

# 旁路报警：动手机/对外推送无 Brain 任务号即告警（派发总闸 H，任务 865b502c）

- [x] [BEHAVIOR] bypassaudit 领锁/手机对外动作/OpenClaw message 调用按持有者·run_id·任务号在 Brain 侧判关联：追得到 Brain 任务（uuid / payload.run_id / qiumi|wfd-<任务号前8位>）不记，追不到写 cecelia_events(event_type=bypass_action)，dedupe_key 去重；按上海日汇总写 runs bypass-audit:<日期>（有旁路=fail，经现有「最近执行」投影），对外类达阈值才 Bark（手机对外≥1、OpenClaw 推送≥5，每天每类一次），领锁类不推主理人。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/__tests__/bypass-audit.test.js src/__tests__/scheduler-jobs.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] bypassroutes POST /api/brain/bypass-actions/report 执行机上报（kind 非法 400）、GET /bypass-actions/summary 运维视图；POST /device-locks/acquire 抢锁成功把 owner/task_id/run_id/host 交旁路审计（被占不记）。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/routes/__tests__/bypass-actions.test.js src/routes/__tests__/brain-meta.test.js --maxWorkers=1 --minWorkers=1"

# handoff 下一步四类 + 有头续接待续（任务 db556cfa，主理人 2026-10-11 决策）

- [x] [BEHAVIOR] handoffkinds next_steps 四类 resume_headed/dispatch_headless/decision/note（task≡dispatch_headless、done≡note）；有头任务（headed_manual / executor_kind=headed-session / headed_takeover）未标或认不出 → resume_headed，无头 → note；resume_headed 不派单、原任务挂 result.pending_resume；PATCH 写 handoff 响应带 handoff_next_steps 反馈。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/relay-baton-kinds.test.js src/lib/__tests__/relay-baton.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] pendingresume GET /api/brain/handoffs/pending-resume 列出待续有头续接（任务/下一步/交接全文），POST /pending-resume/:id/ack 销待续。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/routes/__tests__/handoffs-pending-resume.test.js src/routes/__tests__/handoff-resume-ack.test.js --maxWorkers=1 --minWorkers=1"

# 对话捕获只收真人原话 + 长寿会话近 24h 关联（任务 c8b27bc5 生产首轮回归）

- [x] [BEHAVIOR] convcapturefilter Claude transcript 里 isMeta、origin.kind≠human（任务通知）、命令回显/本地命令输出/中断提示/压缩续接摘要不算真人文本；关联任务只认会话最后活动前 24h 内提到的 --task-id/claim。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/__tests__/conversation-capture-claude.test.js src/__tests__/conversation-capture-remote.test.js --maxWorkers=1 --minWorkers=1"

# Brain 主动派 workflow 给 Commander + 派 workflow 先建单再派（任务 f38e7cc2）

- [x] [BEHAVIOR] wfcommanderdispatch 新 task_type workflow_dispatch（迁移 549）：scheduler job workflow-commander-dispatch 认领 → 按 config/factory-workflows.json commander 登记解析调度单（缺项 failed 不猜）→ 发布时段内领 Brain 设备锁（被占只等不接管）→ ssh MMV 起 openclaw agent --agent work-commander（调度单经 stdin）→ 收割 COMMANDER_RESULT → completed/failed + 放锁；不进外部 run 镜像集合、不进 tick 主派发。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/workflow-commander-dispatch.test.js src/__tests__/migration-549-workflow-dispatch.test.js src/lib/__tests__/task-type-registry.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] notionbuilddispatchorder notion-push-sync 派 workflow（ssh 直派 / webhook）改先建 workflow_run 单再派：建单失败不派写 ⚠ 回执；派发失败把已建单收成 failed。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/__tests__/notion-push-sync.test.js --maxWorkers=1 --minWorkers=1"

# 修对话自动捕获 + 有头会话收尾自动 handoff（任务 c8b27bc5）

- [x] [BEHAVIOR] convcaptureremote 容器内对话捕获走 ssh mmv 只读跑同一份三适配器（远端脚本 fixture 真跑出会话、带 entrypoint/linkedTaskIds、turns 截尾 ≤4000 字）；远端 ~/.claude/projects 缺失、ssh 失败、本地模式目录缺失均计 adapter_failures 使 errors>0（回归：09-10 起容器内静默 0 全绿）；未登记出处且 entrypoint=cli 判为有头真人会话，sdk-cli 照旧跳过。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/__tests__/conversation-capture-remote.test.js src/__tests__/conversation-capture-claude.test.js src/__tests__/conversation-capture-human-gate.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] headedsessionhandoff 结束的有头会话摘要并入关联任务 handoff（已有真 handoff 只追加不覆盖、headed_sessions 按会话幂等、未终态任务加有头续接下一步，kind 经 resume_headed 适配点、未支持时为 note）；无关联补建 completed 账本任务（source=conversation、source_id=headed-session:<sid>）并写 handoff，登记 task-creation-inventory。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/__tests__/headed-session-handoff.test.js src/__tests__/task-creation-inventory.test.js --maxWorkers=1 --minWorkers=1"

# 技能工厂派发器 claim executor_kind 修正（任务 a5f42455 上产实测）

- [x] [BEHAVIOR] factorydispatcherek 派发器 claim 请求体 executor_kind=openclaw-agent（tasks_executor_kind_check 允许值）；原 factory-dispatcher 值让 Brain 回 500，执行单永远认领不了。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run scripts/factory-dispatcher --maxWorkers=1 --minWorkers=1"

# 技能工厂一轮改挂 scheduler-jobs（任务 a5f42455 回归修复）

- [x] [BEHAVIOR] factorycyclejob runFactoryCycle 登记为 scheduler-jobs 的 factory-cycle job（executeTick 自 Wave 2 起不被调用，原挂点是死路径），5 分钟自 gate（调度器 60s 全调），force 可越过；tick-runner 不再挂，避免双跑。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/factory-cycle.test.js src/__tests__/scheduler-jobs.test.js --maxWorkers=1 --minWorkers=1"

# 技能工厂推进器 + 自动裁判（任务 a5f42455 / 2231ecc0）

- [x] [BEHAVIOR] factorypusher 推进器规则（决策 cc008b7e / 2bb08a99）：1/2/3 跑验类无在途且不卡、发布时段内建 factory_dispatch 执行单（1=skill-explore / 2=skill-boundary / 3=候选版本），滑窗满且全过 rule 推进，滑窗出现 fail 清零重来，stage 3 连续失败（safe_stop 不计）达阈值（默认 3）退回 2；人工关口/安全红线不动；同行最多 1 张在途；时段外不建单；取不到配置标 resource 卡点不猜；4/6 建 /dev 工单（建单五坑）完成后推进；5 建 Commander 工单、对外首次上生产标 human_gate；7 守护尾部连续 fail 达阈值退回 6 并告警；开关 FACTORY_PUSHER_ENABLED / brain_config factory_pusher_enabled；tick 每 5 分钟节流调用。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/factory-pusher.test.js src/lib/__tests__/factory-cycle.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] factoryjudge 自动裁判：执行单终态带 delivery 时代码裁判（claimed_result / lock_released / 对外动作次数 / 读回锁 / 自带验收项），pass 且需看图自动建 run-verify 核验单（派发器契约可解析、正文含被核验任务 id 与 run_id），与 verification.verdict 合并两者都 pass 才 pass；记进台账滑窗同 run_id 去重；发布前安全停止记 fail 标 safe_stop；核验无结论不计入。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/factory-judge.test.js src/lib/__tests__/factory-ledger.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] factorypushersmoke 真库真代码 smoke：真 createTask 建执行单、在途不重复、裁判建核验单、核验 pass 入窗、2/2 全过 rule 推进 3→4 留痕、同 run_id 去重、开关关闭整轮跳过。
  Test: manual:bash packages/brain/scripts/smoke/factory-pusher-smoke.sh

# 技能工厂台账（迁移 548，任务 1c589b13）

- [x] [BEHAVIOR] factoryledger 技能工厂台账（决策 cc008b7e / 2bb08a99）：迁移 548 新建 factory_ledger（workflow_id 唯一、stage 1..7、validation_mode 两档、blocked_kind 四种、滑窗计数约束）与只追加的 factory_stage_events；转换规则 human 任意跳退、rule/agent 只许相邻推进或登记退回（3→2/5→3/6→5/7→6），人工关口/安全红线下 rule/agent 409、跳级 400、原地 400；滑窗按 window_k 截尾、同 run_id 窗内去重、降级累计；接口参数错 400 不进库、重复进厂 409、写接口挂内部鉴权；连接池事务成功 COMMIT 失败 ROLLBACK 且归还连接。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/factory-ledger.test.js src/routes/factory-ledger.test.js src/__tests__/migration-548-factory-ledger.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] factoryledgerpg 真 PG：事务内跑迁移 548 两遍幂等，进厂默认阶段 1 带进厂事件、workflow 不存在 404、rule 推进带证据并清滑窗、expected_from_stage 不符 409、人工关口下 human 跳级留痕、守护劣化 7→6、事件 UPDATE 被拒。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/factory-ledger.pg.integration.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] factoryledgersmoke 真库真代码 smoke：进厂/跳级被拒/人工关口/滑窗/只追加，真容器台账接口已挂载（列表 200 / 单行 404 / 越界 400）。
  Test: manual:bash packages/brain/scripts/smoke/factory-ledger-smoke.sh

- [x] [BEHAVIOR] taskrunsvesselpg 正式450/453迁移与真实PG唯一索引验证登记幂等、旧Ops及pending占位保留、失败零登记与抢占拒绝。
  Test: manual:bash packages/brain/scripts/smoke/task-runs-projection-smoke.sh
- [x] [BEHAVIOR] versionfragmenthint 未提供发版碎片时版本门禁给出当前 changes/{VERSION} 合同，拒绝手动版本五件套提示漂移。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run ../../tests/regression/version-gate-silent/check-brain-version-bump.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] taskrunsvessel 正式 Runs 配置：内部鉴权与显式启用；补列读回成功才登记；不抢占旧库、不删除映射；来源标记及有界分页防重复创建。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/projection/__tests__/task-runs-config.test.js src/routes/__tests__/task-runs-projection.test.js --maxWorkers=1 --minWorkers=1"
# 技能工厂看板 skill@版本 修正（任务 1b3c0000）

- [x] [BEHAVIOR] skillfactoryboardskilllabel 试跑交付的 flow_skill_v1 为整份 skill 正文时，看板「skill@版本」只取 frontmatter 的 name@version；无 frontmatter 取第一行截到 80 字。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/skill-factory-board.test.js --maxWorkers=1 --minWorkers=1"

# 技能工厂看板 + Activity 生产版本列（任务 1b3c0000）

- [x] [BEHAVIOR] skillfactoryboard 技能工厂看板：阶段任务（payload.stage / 【执行参数】阶段）按流程（树上坐标最后一段，去空白归一）取最新一张排成一行；执行单与审计单不当阶段任务；连续通过与 count_streak.py 同规则（待核验/无法核对跳过、同输入不重复计、外部原因作废、改版或片指纹变清零），子任务读不到写「无法计数」；blocked 取 claimed_result；卡点取失败原因第一句并附同父任务下进行中的修复单；推送按注册表 vessel 找库、未登记跳过、指纹未变不写、无链接按 Brain ID 认领、页被删重建、5 分钟自 gate；scheduler 注册 skill-factory-board。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/skill-factory-board.test.js src/__tests__/scheduler-jobs.test.js src/__tests__/migration-543-skill-factory-board-registry.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] activityreleasecolumn Activity 目录页「生产版本」= activity_release_state 生产指针的 v<版本号> + 收敛过/冷启动（未收敛过），无指针留空；目录源真 SQL 带出 releases，已有目录页但失去引用的 Activity 仍投影。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection/__tests__/activity-card.test.js src/projection/__tests__/directory-source.test.js src/projection/__tests__/directory-schema.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] skillfactoryboardpg 真 PG：隔离 schema 里目录源带出生产版本号与是否收敛过、孤儿 Activity 仍在目录源；smoke 在迁移 543 缺失时报红。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/directory-projection.pg.integration.test.js --maxWorkers=1 --minWorkers=1"

# 发布线审查修复：无可退目标也告警（去重）

- [x] [BEHAVIOR] releaselineunavailablealert 发布线无可退目标告警（审查阻断，任务 d9eb572d，父任务 37568378）：自动退回评估连续失败且没有曾收敛的可退目标时，生产版从未收敛也发告警 P2（activity_production_rollback_unavailable:<activity>，曾收敛的仍 P1），不发 Bark、不退回；告警在 recentlyNotified 去重之后——同一 Activity+生产版 24 小时内、期间没有全绿只告警一次，超过 24 小时再失败再告一次；告警函数抛错不影响返回。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/release-line-rollback-unavailable-alert.test.js src/lib/__tests__/release-line-rollback.test.js --maxWorkers=1 --minWorkers=1"

# 发布线：内容版本、生产指针、晋级门、退回、流程生产配方（迁移 541）

- [x] [BEHAVIOR] releaseline 发布线（决策 de6dff5d 第 3 步，任务 37568378）：迁移 541 构建层不动、新版本层 activity_versions 按内容（去掉 implementation_bindings 的 md5）去重，同内容两个 commit 只出一个版本；初始生产版 = current_definition_version_id 所在构建的内容版本；生产版从未收敛 → 新内容 bootstrap（reason=bootstrap_no_converged_baseline），命中旧构建不拨回指针；受保护时影子模式（默认）记 promote_would_reject 指针照常前进，RELEASE_LINE_PROTECT=on 留作候选去重；晋级门（连续 N 绿 + not_worse）不过 409 GATE_FAILED + promote_rejected，通过后配方只换这一格；接口变化须成组，成组任一不过一个指针都不动；自动退回 advisory 只记事件、on 退回到曾收敛的历史生产版并重算配方 + P0 + Bark、无目标 rollback_unavailable 去重后告警（未收敛 P2、曾收敛 P1）；发布时把关默认关零查询；同步挂钩出错回滚到 savepoint、定义同步照常提交；对比读回被删判 worse、min_runs>max_runs 400。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/lib/__tests__/release-line.test.js src/lib/__tests__/activity-version-compare.test.js src/lib/__tests__/activity-judge.test.js src/routes/release-line.test.js src/routes/activity-judgments.test.js src/__tests__/migration-541-release-line.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] releaselinepg 真 PG：隔离 schema 跑真实迁移 538+541 与真实合同同步夹具，锁迁移后生产版=current、冷启动 bootstrap、晋级/成组/退回/把关开关、挂钩 fail-open。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/release-line.pg.integration.test.js src/__tests__/integration/release-line-sync.pg.integration.test.js --maxWorkers=1 --minWorkers=1"
# 获客业务数据 Notion 镜像登记 + Activity 裁判结论/生产版本两列

任务：f6ad056e-cd8f-4dff-841e-e5e7c9cbb5ea；决策 a029a7a7。

- [x] [BEHAVIOR] leadgennotionregistry 迁移 540：获客·视频/评论/线索三张 Notion 镜子库以 mirror/push/active、brain_table 为空登记进 notion_projection_map，重跑空操作，回滚只删这三行；scratch 库升级→重跑→回滚→再升级通过。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-540-leadgen-notion-mirror-registry.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] activityjudgmentcolumns Activity 目录页新增「裁判结论」（activity_judgments 最新一条 verdict 中文 + 连续绿/要求绿，无裁判写「未裁判」）与「生产版本」（发布线未接线前留空）两列，列合同与列来源同步登记，目录源 SQL 每个 Activity 只取最新一条裁判。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection/__tests__/activity-card.test.js src/projection/__tests__/directory-source.test.js src/projection/__tests__/directory-schema.test.js --maxWorkers=1 --minWorkers=1"

# 运行定义回读瘦身（任务 e961f9a9）

- [x] [BEHAVIOR] rundefinitioncompact 运行定义回读瘦身（任务 e961f9a9）：GET /api/brain/runs/:run_id/definition 默认改回紧凑视图（definition_view=compact）——binding 原样，release 只留身份/摘要列+full_href（去 payload），workflow 去 payload.contract，activities 只留本次绑定 Activity 的身份、payload_sha256/contract_sha256、Step 的 step_id/locator/registration 摘要与 optional/required/condition；?view=full 原样返回旧形状，完整 release 走 GET /releases/:id。生产形状夹具完整定义 >500KB、紧凑 <64KB 且 2 秒内返回，预期路径每个 Activity/Step 身份都能在紧凑定义里找到；紧凑化异常回退完整定义不 500。生产 12 条真实绑定实测 652KB→30KB。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/routes/__tests__/run-definitions-size.test.js src/lib/__tests__/run-definition-view.test.js --maxWorkers=1 --minWorkers=1"

# 部署收账有界重试与陈旧 pending 核验补收账

- [x] [BEHAVIOR] sidecarfinishretry 部署收账有界重试（任务 502f2852）：bluegreen sidecar 的 retention_finish 第一次失败、第二次成功 → 正常收账清 pending，失败那次的退出码与 stderr 落 sidecar 失败日志（[completion-retry]），不告警；全部失败 → 重试有界（默认 5 次/180s）、每次 stderr 落日志、最终写 [completion-fail] 并 Bark 告警、pending 不清、不写成功史。
  Test: manual:node --test scripts/bluegreen-sidecar-completion.test.mjs
- [x] [BEHAVIOR] pendingreconcile 陈旧 pending 核验补收账（任务 502f2852）：ledger.reconcile 只在 pending 非恢复中、begin 超过 15 分钟、finish 自带核验（运行容器=pending 目标且健康）通过时清 pending；旧镜像仍在跑/新鲜期/恢复中一律抛错不改状态。retention_begin 撞 DEPLOYMENT_PENDING 先 reconcile，通过才重试一次 begin，不通过保持失败并告警；其它 begin 失败不触发 reconcile。
  Test: manual:node --test scripts/brain-image-retention-ledger.test.mjs scripts/brain-image-deploy.test.mjs

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

- [x] [BEHAVIOR] cleanup-source-retirement：执行真实 Git 与实际清理工作流 shell，瞬态资料删除/来源退役同行提交；未删和持久文档原字节保护，严格解析及已有 release 消费保持。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run scripts/ci/__tests__/cleanup-source-retirement.test.mjs scripts/ci/__tests__/implementation-auxiliary-evidence.test.mjs --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] codeidentitydedup 正式JSON false LLM与JSON true multi的active Workflow按可信父/slot/手机区分身份；不同工作流/手机不会被相似标题互挡，同ledger/业务身份即使改标题仍抑制，缺证据保原标题规则。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/dispatcher-dedup.test.js src/lib/__tests__/code-task-identity.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] codeidentitysql 实际scratch私有schema执行原生产判重SQL，inactive/非法Workflow、字符串布尔、伪造slot、盗用另一任务receipt和候选对象冒充均不能取得标题豁免；真ledger唯一键保留。
  Test: manual:bash -c "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_scratch} DB_HOST=${DB_HOST:-/tmp} DB_USER=${DB_USER:-administrator} npx vitest run --config vitest.integration.config.js src/__tests__/integration/code-task-dedup.pg.integration.test.js --maxWorkers=1 --minWorkers=1"

## 会话摘要 OpenClaw Codex（任务 910d6889）

- [x] [BEHAVIOR] summaryopenclaw 会话默认摘要经 SSH stdin 交给 MMV 独立无工具 Codex agent；每次新 session，失败或空回执仍返回原文摘录；不再依赖失效 thalamus 通道。
  Test: manual:bash -c "cd packages/brain && NODE_ENV=test npx vitest run src/__tests__/conversation-summary-openclaw.test.js src/__tests__/conversation-capture.test.js src/__tests__/conversation-capture-human-gate.test.js --maxWorkers=1 --minWorkers=1"

# Stop hook 交接示例（续接 d0463902）

- [x] [BEHAVIOR] stophandoffkinds 真实 stop hook 拦截未交接任务时，输出的 handoff 示例列出 resume_headed、dispatch_headless、decision、note 四类；退出码仍为 2。
  Test: manual:bash -c "cd packages/engine && npx vitest run tests/hooks/stop-handoff-example.test.ts --maxWorkers=1 --minWorkers=1"
