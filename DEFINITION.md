# Cecelia 定义文档

**Brain 版本**: 1.445.316

旧夜间任务标记调度器已清退；状态接口保留停用兼容数据，普通 Tick、Notion 任务派发及历史日报读取继续由现役入口提供。

本文是当前仓库的事实入口，不是发布流水账，也不是生产启用台账。历史实现、版本变迁与事故记录通过 Git 历史查询；下列路径指向实际源码。部署状态、环境开关、可用节点与账号授权需从受保护的运行接口和执行回执读回，不能由文件存在推断。

## 系统与边界

Cecelia 负责登记、调度和核对工作；具体执行交给有授权的外部执行体。Brain 使用 Node.js、PostgreSQL 和外部执行适配器；Dashboard 是独立前端。主启动装配见 [server.js](packages/brain/server.js)，公共执行目录见 [execution-directory/directory.js](packages/brain/src/execution-directory/directory.js)。

| 当前事实 | 真源与解释 |
|---|---|
| Brain 默认监听 port 5221 | [server.js](packages/brain/server.js)，部署可通过环境配置覆盖 |
| Tick 默认每 5s 循环 | [tick-loop.js](packages/brain/src/tick-loop.js)，循环间隔可由环境覆盖 |
| Tick 默认每 2min 执行 | 同一模块节流常量；不是每轮循环都派发工作 |
| 丘脑声明 39 个白名单 action | [thalamus.js](packages/brain/src/thalamus.js)；数量说明声明集合，不代表所有生产动作都启用 |
| 皮层额外 4 个 action | [cortex.js](packages/brain/src/cortex.js)；是否调用受任务、策略与运行开关约束 |
| Schema 版本地板为 430 | [selfcheck.js](packages/brain/src/selfcheck.js) 的 EXPECTED_SCHEMA_VERSION；不是最高迁移编号 |
| 任务类型与位置提示 | 下表逐项对应 LOCATION_MAP；完整注册、执行资格与退役状态仍以注册表为准 |

[facts-check.mjs](scripts/facts-check.mjs) 从源码抽取并核对上述七项；其中 LOCATION_MAP 部分只核类型名存在，不核后备值、实际选机或生产启用状态。迁移文件见 [migrations](packages/brain/migrations)，迁移执行器见 [migrate.js](packages/brain/src/migrate.js)；启动检查要求数据库满足 schema 地板。编号唯一性由 [lint-migration-unique-version.cjs](.github/workflows/scripts/lint-migration-unique-version.cjs) 单独校验。

## 任务类型与路由

任务注册表是 [task-type-registry.js](packages/brain/src/lib/task-type-registry.js)。LOCATION_MAP 是仍被建单准入与普通执行读取的后备路由输入，见 [dispatch-route.js](packages/brain/src/lib/dispatch-route.js) 与 [task-router.js](packages/brain/src/task-router.js)。动态路由可覆盖该值；`us`、`xian` 是逻辑分支，不等于当前机器清单、账号配置或真实派发授权。它不是所有可执行类型的全集，不能当作仅供展示的无用副本删除。

| 类型 | LOCATION_MAP 后备值 |
|---|---|
| dev | `us` |
| review | `us` |
| qa | `us` |
| audit | `us` |
| codex_qa | `xian` |
| codex_dev | `xian` |
| crystallize | `xian` |
| crystallize_scope | `xian` |
| crystallize_forge | `xian` |
| crystallize_verify | `xian` |
| crystallize_register | `xian` |
| codex_test_gen | `xian` |
| pr_review | `xian` |
| code_review | `us` |
| decomp_review | `us` |
| dept_heartbeat | `us` |
| initiative_plan | `us` |
| initiative_verify | `us` |
| suggestion_plan | `xian` |
| architecture_design | `us` |
| architecture_scan | `us` |
| arch_review | `us` |
| strategy_session | `xian` |
| intent_expand | `us` |
| initiative_execute | `us` |
| explore | `xian` |
| knowledge | `xian` |
| talk | `xian` |
| research | `xian` |
| data | `xian` |
| ci_patrol | `us` |
| strategist_decision | `us` |
| prd_review | `us` |
| spec_review | `us` |
| code_review_gate | `us` |
| initiative_review | `us` |
| scope_plan | `xian` |
| project_plan | `xian` |
| okr_initiative_plan | `xian` |
| okr_scope_plan | `xian` |
| okr_project_plan | `xian` |
| pipeline_rescue | `us` |
| staging_e2e | `us` |

普通任务派发依次受任务注册、资格检查和执行目录约束，入口见 [tick.js](packages/brain/src/tick.js)、[dispatcher.js](packages/brain/src/dispatcher.js) 与 [executor.js](packages/brain/src/executor.js)。`qiumi_task` 使用原生执行入口；`codex_dev` 保留普通 Bridge 派发能力；`script_run`、`app_server_run` 各有独立执行面。它们的来源身份、租约、账号和可用节点须查执行目录，不从旧固定主机表恢复。

旧自主开发与内容任务在注册表的 RETIRED_DEVELOPMENT_TASK_TYPES、RETIRED_CONTENT_TASK_TYPES 及 payload 守卫中拒绝。兼容类型名或历史行仍然存在不代表允许重启旧编排；`dev` 的有头会话开发与正常任务账本不因此退役。层级规划是否允许还受 [retired-decomposition.js](packages/brain/src/lib/retired-decomposition.js) 约束。

## 任务真身与 Notion 工作面

任务通过 [tasks 路由](packages/brain/src/routes/task-tasks.js) 与运行账本管理，不能用日志文字代替任务状态和执行证据。普通任务派发与 Notion→Brain 入口保留；停止旧自主开发、日报或思考后台不能连带关闭这些入口。

[notion-push-sync.js](packages/brain/src/notion-push-sync.js) 处理工作面同步与委派入账；[notion-leadgen-dispatch.js](packages/brain/src/notion-leadgen-dispatch.js) 校验来源租户、公司、阶段、固定绑定和幂等标识。跨租户批准必须来自受保护绑定，不能凭页面正文猜测 UUID。

独立运行入口见 [standalone-skill](packages/brain/scripts/standalone-skill)，准入前失败的操作者复核见 [run-reconciliation.js](packages/brain/src/routes/run-reconciliation.js) 与 [standalone-start-reconciliation.js](packages/brain/src/workflow-foundation/standalone-start-reconciliation.js)。复核不替换原运行、不改写 worker 回执、不自动重试。

历史日报读取仍由 [nightly-tick.js](packages/brain/src/nightly-tick.js) 的 getDailyReports 和 [goals.js](packages/brain/src/routes/goals.js) 的只读 daily-reports 路由提供；这不是创建新日报的入口，也不要求恢复旧日报生产者。

## 后台开关与运行证据

旧夜间任务标记调度器的模块与启动接线已清退；`status/full` 保留停用兼容封套。普通任务派发与历史日报读取保留各自现役入口。

启动接线以 [server.js](packages/brain/server.js) 为准，调度配置见 [scheduler-jobs.js](packages/brain/src/scheduler-jobs.js)。独立思考层开关由 [consciousness-guard.js](packages/brain/src/consciousness-guard.js) 解释；关闭该层保留任务派发、调度和监控。本文不将旧夜间编排、地图扫描、情绪、日报或旧自动开发列作需要启用的服务。

源码仍有兼容模块、启动分支或历史配置时，先核实际消费者和开关，再决定是否清退；当前生产启用状态未在本文验证。不能把模块存在、默认值、测试通过或历史事故记录当作在线证据。

只读运行入口为 `/api/brain/health`、`/api/brain/tick/status` 与 `/api/brain/status/full`，接口实现见 [status.js](packages/brain/src/routes/status.js) 和 [tick.js](packages/brain/src/tick.js)。健康响应只证明相应探针结果；业务完成还须核原任务、运行及产出回执。不要为查看状态触发 tick 或重新派发任务。

## CI 与正式发布入口

主流程只认 [.github/workflows/ci.yml](.github/workflows/ci.yml)：PR 与 main push 执行 security、组件 checks、runtime-integration、浏览器回归和 CodeQL，由 `ci-passed` 核全部必需结果；main push 成功后进入 `brain-deploy`。具体检查命令由 [run-basic-check.mjs](scripts/ci/run-basic-check.mjs) 生成，Brain 单测为现有六分片；Ops 集合见 [ops-checks.mjs](scripts/ci/ops-checks.mjs)。

正式发布从该 workflow 调用 [run-brain-deploy.sh](scripts/ci/run-brain-deploy.sh)，先执行 [brain-deploy-preflight.mjs](scripts/ci/brain-deploy-preflight.mjs) 固定版本、SHA、发布必要性与证据，再进入正式候选验收与发布链。源码绿灯、候选隔离通过、生产 SHA 读回是不同证据；不能用旧 compose 命令、历史环境图或另一条工作流代替正式入口。

深度数据库与隔离容器回归见 [nightly-regression.yml](.github/workflows/nightly-regression.yml)、[deep-integration.config.mjs](scripts/ci/deep-integration.config.mjs) 和 [run-debt-pg.mjs](scripts/ci/run-debt-pg.mjs)。机外运行探测见 [heartbeat-sentinel.yml](.github/workflows/heartbeat-sentinel.yml)：生产健康与定时回归活性不等于 PR 验收，它们也不等于旧自主开发编排。最近是否成功、告警是否投递须读真实 Actions、Issue 与推送记录。

正式已登记 Workflow 的按需发布验证由主 CI 中 `foundation-release-verification` 入口执行，报告见 [pilot-release-verification.mjs](scripts/ci/pilot-release-verification.mjs)。没有报告与真实产出，不以文件存在宣称发布就绪。

## 执行身份、镜像与资源保护

公共目录的 current version、机器身份、授权 scope 与过期时间由 [directory.js](packages/brain/src/execution-directory/directory.js) 核对；没有有效快照或授权时不得用旧固定节点列表兜底。

原生任务链见 [native-agent-executor.js](packages/brain/src/native-agent-executor.js)、[native-agent-transport.js](packages/brain/src/lib/native-agent-transport.js) 与 [native-agent worker](packages/brain/scripts/native-agent/worker.mjs)：固定代码 bundle、进程身份、停止和清理证据是其边界，不能与 canonical Docker runner 的镜像身份混为一谈。

canonical runner 的配置真身见 [node-profile.js](packages/brain/src/orchestrator/fleet-node/node-profile.js) 和 [fleet-node-profiles.json](packages/brain/config/fleet-node-profiles.json)；镜像摘要、Worker/Codex 版本及安装配置互锁由 [canonical-pin-consistency.test.sh](packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh) 校验。本文不复制易漂移的重钉摘要流水账。配置有互锁不表示近期实际部署或准入成功。

受管脚本与 App Server 的隔离入口见 [script-managed-executor.js](packages/brain/src/script-managed-executor.js)、[app-server/controller.js](packages/brain/src/app-server/controller.js)。节点准入见 [node-admission.js](packages/brain/src/orchestrator/fleet-node/node-admission.js)。是否仍在生产使用某个 surface、Worker 或 baseline proof 需要运行账核对；不能因历史 Harness 名称退役而删除共享准入保护。

候选快照与发布资源身份核对见 [brain-snapshot.sh](scripts/lib/brain-snapshot.sh)、[brain-staging.sh](scripts/lib/brain-staging.sh)。镜像回收实现见 [brain-image-retention](scripts/brain-image-retention)，私有 PostgreSQL 回归资源见 [private-pg-backend.mjs](scripts/ci/private-pg-backend.mjs) 与 [private-pg-contract.mjs](scripts/ci/private-pg-contract.mjs)。清理只处理可核对归属的本轮资源，错误或未知身份不能当作成功；不为测试操作生产容器或生产数据库。

## 变更与验收

版本真身为 [packages/brain/package.json](packages/brain/package.json)。[check-version-sync.sh](scripts/check-version-sync.sh) 核 Brain lock、版本清单与本文首条版本；版本变动还需同步根 workspace lock 对应项。本文只保留一个当前 Brain 版本。

开发边界见 [AGENTS.md](AGENTS.md) 与 [.agent-knowledge/engine.md](.agent-knowledge/engine.md)。Brain 代码变更前依次通过 facts、version-sync 与 [check-dod-mapping.cjs](scripts/devgate/check-dod-mapping.cjs)。测试须执行真实入口与业务断言，关键缺陷保留能触发失败的回归；删去退役专属测试时先核消费者，不删仍活跃的共享保护。

DEFINITION 是受治理的文档；走实现验证入口时，变更后的来源 SHA、完整字节摘要及独立检查记录由 [implementation-ci-governance.js](packages/brain/src/lib/implementation-ci-governance.js) 和 [registry-lint.mjs](scripts/ci/registry-lint.mjs) 处理；历史证据仍绑定原 Git SHA，不改写历史摘要。实际生效的规则保留在执行现场，本文提供事实与源码导航。
