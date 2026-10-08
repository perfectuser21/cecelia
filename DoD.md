- [x] [BEHAVIOR] rpamanualdispatch 手机定向派发两入口共用原子 claim、queued 路由、持久化 run_id 和执行通道；coding Bridge 离线不误拦手机，人工急停与并发请求不重复启动，响应不确定保留原运行并交独立收割；旧 owner 清理不释放新 owner。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/routes/__tests__/qiumi-manual-dispatch.test.js src/__tests__/dispatcher-qiumi-routing.test.js src/__tests__/openclaw-agent-executor.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] rpareceiptdetails Notion 回执读取真实阻断详情；SQL 内容指纹令同状态的原因或结果更新重推，未知派发显示正在查询原运行，人工 hold 与归档语义保留；双 PG 连接验证唯一认领及真实指纹落库。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/notion-qiumi-receipt-details.test.js src/__tests__/notion-gtd-sync-push-and-stops.test.js src/__tests__/notion-gtd-sync.test.js src/lib/__tests__/qiumi-status-map.test.js --maxWorkers=1 --minWorkers=1"

# DoD — 受控再基恢复
- [x] [BEHAVIOR] notionhumancolumns Notion 六层目录第二轮（人打开看得懂）：每层只挂直接上级、上级的上级只进「树位置」；删全部 分组·*、Key、正本、版本/渠道、同步时间、登记缺口，每库留 Brain ID+同步状态；列名改中文人话（名称/所属能力/Activity 顺序/运行方式/运行情况/平均时长/去留（你填）/承诺（FR）/谁来执行/还缺什么/做什么/怎么验收/失败了怎么办）；ensureDirectorySchemas 对「新名不在、旧名在、类型一致」的列用 Notion 属性改名保值（你的标记→去留（你填） 等），新代码首轮自动迁移；「还缺什么」列出没写的标准项与红/待判/未验格子，替代 8 个格子列；Activity 9 项标准内容写进页面正文一个机器维护折叠块（只换自己的块，指纹不变零调用），由目录投影唯一写正文，契约 job 不再写 Notion；清理脚本识别待改名列并在改名/新列未完成时拒绝 --apply。生产只读 dry-run：132→70 列（部门 20→18、价值流 11→7、能力 14→8、流程 26→14、Activity 36→11、Step 25→12）。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection/__tests__ src/__tests__/activity-contract-sync.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] notiontreecleanup Notion 六层目录库清理：列合同只留 Brain 列（原样/派生）与登记人工列（部门库 PARA、流程库「你的标记」），每列带来源；目录投影不再写 真身来源/责任主体/分组·子部门/部门 Key/流程 Trigger·Input·Output·执行策略 与 7 个旧任务计数列·旧功能状态/Activity 使用位置；流程运行列改用 runs（7天次数/失败/成功率/平均时长，在用吗与最近运行兼看闹钟），活动编排列 Activity 名字；Activity 写 Key 与 git 正本链接，Step 写顺序、Input/Output 取 steps.inputs/outputs；价值流由目录接管（挂能力的按 Brain ID 建页，空壳只报 catalog gap，部门关联只连建页的）；Activity 契约推送器不再推英文列与补列、结构地图价值流镜子不再挂推送轮、公司 KR 登记不再写 Step/Activity 旧列；清理脚本 scripts/ops/notion-tree-cleanup.mjs 默认 dry-run，--apply 先备份再按公式→汇总→其余删列、归档无 Brain ID 页，新投影列未建出时拒绝执行。生产只读 dry-run：部门 23→20、价值流 20→10(+说明)、能力 17→14、流程 39→22(+4 运行列)、Activity 67→36、Step 42→25，归档价值流 8 页、Step 36 页。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection/__tests__ src/__tests__/activity-contract-sync.test.js src/__tests__/activity-contract-body.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] runsexecutiontable 执行记录统一为 runs + spans + 汇总（决策 ff2019e2）：迁移 531 新建 runs（每次流程运行一行：流程、触发来源 schedule/task/manual/external、闹钟总账 id、Brain 任务运行 id、起止与自动算时长、结果 running/pass/fail/timeout/skipped/unknown、token/费用、header_source owner/spans）；spans 加 parent_span_id 自关联与 span_level 生成列（物件调用>Step>Activity），spans.run_id 外键指向 runs.run_id（级联删），已有 spans 按 run 回填总记录；BEFORE INSERT 触发器保证总记录存在、AFTER INSERT 触发器只对真插入的 span 加总（重复上报不重复算；owner 写的总记录只加 token/费用不改结果起止）；汇总视图 v_workflow_run_stats / v_activity_span_stats 给 24h/7d/30d 次数、成功/失败、成功率、平均与 p95 时长、平均 token、平均费用、最近一次。调度器每轮真干活（非自 gate 跳过）的 job 写一行 runs，带真实起止，经 ops_schedule_entries(kind=brain_job) 挂到业务流程；写失败只告警不影响 job 与哨兵。本机 scratch 升级→回滚→再升级通过；生产库干跑回填 119 条总记录后回滚。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-531-runs-table.test.js src/__tests__/scheduler-jobs.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] notiontreeancestry Notion 目录每一层带完整祖先链：价值流库带 分组·公司/部门/子部门；能力库加 分组·价值流；流程库加 分组·能力；Activity 与 Step 库加 分组·流程（共用 Activity 取「归属引用」即 source_ref 为空的那条所在流程，没有就取第一条引用，没挂流程标「(未挂流程)」）；每层另有「树位置」一行文字写全祖先路径（不含自己）。能力的部门取自己的 area，没有就继承价值流的 area；追不到的一律「(未归属)」不留空；选项名把英文逗号换成全角、截 100 字；部门环路不死循环。生产只读核对：流程 61/能力 56/Activity 128/Step 56 全部能追到部门，价值流里 32 个无部门（均为无能力的空价值流）。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] notionworkflowruntime Notion「流程」库补运行情况列：每个流程自动带 Activity 数、定时任务数、启用任务数、近 7 天有跑、失败任务数、静默任务数、步骤级运行次数、最近运行（按分钟取整）、在用吗（在跑 / 有任务近7天没跑 / 只登记没运行 / 空壳）、怎么运行（逐条列出任务：启用●停用○、频率、最近状态、最近运行，一次性任务按上海时间翻成人话）、旧功能状态；另建人工列「你的标记」（有用/没用/过期/删，只建列、投影器永不写值）。数据来自闹钟总账与 spans，单条 SQL 取同一快照；生产库只读核对 61 个流程分组为 在跑30/近7天没跑1/只登记18/空壳12。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] notionregistrycleanup v3.0 第 6 刀后清理：迁移 530 把 Notion 注册表里 4 行已停用的旧库登记（activities=AI Steps、activity_cells=Backbone-Step Map、okr_projects=Cecelia Projects、tasks=Cecelia Tasks）清掉——只删同一张表上已有非 archived 登记的行，registry_coverage 每表至少留一行，删前整行备份进 migration_530_notion_map_backup；旧树 Feature 镜像（journey_features）改 archived 停推并保留登记行；不碰 unmapped 占位行、journeys 唯一一行、journey_features 表本身；回滚按备份还原并恢复旧树镜像为 active push（本机验证升级→回滚→再升级，生产库干跑 71→67 行且回滚后恢复）；notion-projection-registry 测试里「旧 AI Steps 行」断言改为「不存在或必须 archived/none」。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-530-notion-registry-cleanup.test.js src/__tests__/migration-523-notion-registry-names.test.js src/__tests__/migration-480-archive-journey-mirrors.test.js src/__tests__/notion-push-sync.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] journeysview v3.0 第 6 刀 PR-B：迁移 529 把 journeys 空壳父表下线——先让 activity_flow_metrics 改读 capabilities、journey_ref_guard（10 张表的多态 journey_id 引用守卫）改按 value_streams / capabilities 判存在，再对两张子表 NO INHERIT、删父表与 INSERT 分流触发器及函数，同名建只读 UNION ALL 视图（INSERT/UPDATE/DELETE 一律被拒）；子表上的身份锁与级联删除触发器保留；父表自己有行就中止；回滚脚本还原 520 形状（本机验证升级→回滚→再升级，生产库干跑通过且回滚后版本回到 528）；直接写 journeys 的集成测试按角色改写子表。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-529-journeys-view.test.js src/__tests__/sql-no-journeys-parent.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] dropjourneysshell v3.0 第 6 刀 PR-A：生产代码（src、brain/scripts 含 smoke、scripts/ci）不再读写 journeys 空壳父表——单一类型读者直读 value_streams / capabilities，混查读者统一用 src/lib/tree-nodes-sql.js 的 TREE_NODES_SQL（两张子表 UNION ALL），登记/公司 KR/Notion 推送回写按角色直写子表，登记接口显式拒绝价值流↔能力互换（400）；守卫 sql-no-journeys-parent.test.js 抓 FROM/JOIN/INTO/UPDATE/LIKE journeys 并证明能报红；测试夹具改终态形状（重放旧迁移后拆成两张真表+只读视图）。数据库结构不动，父表拆继承与下线是 PR-B（迁移 529）。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/sql-no-journeys-parent.test.js src/lib/__tests__/tree-nodes-sql.test.js src/lib/__tests__/notion-projection-engine.test.js src/__tests__/notion-push-sync.test.js src/__tests__/battle-report.test.js src/__tests__/line-dreaming.test.js src/__tests__/ops-alarm-import.test.js src/__tests__/promise-map-nightly.test.js src/lib/__tests__/assertion-red-report.test.js src/workflow-authoring/registration.test.js src/routes/workflows.test.js src/__tests__/task-type-registry.guard.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] activityplacement v3.0 第 5 刀②：迁移 527 新增 activity_placement 视图（每个 Activity 一行，能力/流程/顺序/槽位由生效流程引用推出，共用时归属引用优先），journey_id/step_number 放开非空并去掉按它们唯一的约束、Activity 身份改按 (capability_key, activity_key) 唯一；合同入库、workflow-authoring、公司 KR 注册不再写这两列，无引用底座一律拒绝登记；登记能力带 steps 经主线流程挂靠、价值流不能带步骤；POST /journey_steps 改为在能力的流程里按序号放步骤（已有则更新）；读者（journey_steps 列表/台账/blast-radius/级联清单/金路径/战情室/依赖图/夜检）改读 activity_placement，API 响应仍回显 journey_id/step_number。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-527-activity-placement.test.js src/__tests__/activity-contract-sync.test.js src/routes/__tests__/journeys.test.js src/routes/__tests__/promise-map-api.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] directorylegacynotionid 目录投影里 Activity 行的页面身份不再取旧同步留下的 notion_id（可能指向别的库或回收站），只认目录链接与 Brain ID 查询，部门页不受影响；修迁移 526 挂靠后目录投影每轮报「目录页身份或数据库不符」。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection/__tests__/directory-source.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] attachorphans v3.0 第 5 刀①：迁移 526 把没有生效流程引用的未退役 Activity 挂进所属能力的流程（能力下恰好一个流程就挂进去，没有或有多个则新建 gp_steps 主线流程再挂；顺序取 step_number、槽位 step_<n>、source_ref 留空表示定义归属；已有引用不动、退役不挂、重跑幂等），引用 source_path 标 migration:526，回滚只删这些引用与变空的主线流程。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-526-attach-orphan-activities.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] droplegacyviews v3.0 第 2 刀 c 段：blast-radius 改读 activity_uses（按 warehouse_items.legacy_feature_id 找用到该物件的 Activity），POST /journey_step_links 拒绝 cell_kind=base_ref 并指向新增的 POST /activity_uses（item_id 或 item_key，角色 uses/depends/produces，(activity_id,item_id) 幂等，物件/活动不存在 404）；迁移 525 先备份底座引用格子再补用料后删除、删 journey_steps/journey_step_links/enablers 三个旧名兼容视图与其注册表占位，回滚可还原；依赖旧名视图的 6 个集成测试（blast-radius、350 种子、373、journey-step-ledger、374、业务探针裁判等）与 4 个烟测改标准名。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js src/__tests__/migration-525-drop-legacy-views.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] stepreconcile v3.0 第 4 刀（路 B）：技能按 Step 发 span（emit-step-span.mjs，证据 step_key/name/action/reads/writes/observed），收敛对账 reconcileSteps 把观测值按读回求值（== != >= <= > < not_null_all，拿不到观测值一律未知不猜 pass），逐次判 verified/mismatch/unverified/failed/missing/skipped/exempt，抓出合同没声明的 Step span，连续 N 次整个 Activity 全绿 = 收敛并把 readback 格翻绿（对不上翻红、收敛中待判、无数据不动）；沉淀技能 draftFromSpans 读 spans+SKILL.md 起草 Steps（读回仅在各次观测一致才起草，on_fail 仅由重试/失败痕迹推出，承诺只给草稿），registerCandidate 登记候选 Activity（status=candidate、承诺列空）+Steps+固定 8 灰格+一条待拍板三问，重复登记不覆盖；三个路由入口 step-reconcile / skill-settlement/draft / skill-settlement/register。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/step-readback-eval.test.js src/lib/__tests__/step-reconcile.test.js src/lib/__tests__/skill-settlement.test.js src/__tests__/emit-step-span.test.js src/routes/skill-settlement.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] contractsteps v3.0 第 4 刀（路 A）：契约 Step 同步到 Brain steps 的映射改对——读回取 dod.readback、模式取 dod.mode（此前只认 step.readback，获客线 44 步读回在 Brain 里全是 {}），名字/动作（脚本引用）/进出（reads/writes）/失败处理（合同显式声明的 retry:N|abort，没写为 null）一并落库；syncSteps 新列只在来源带了才进指纹且旧来源不会清空新列；生产同步默认同时落 Step；「不写读回不许过」：同步前每个 Step 必须有 dod.readback（type=none 须写原因），缺口一次列全并整轮拒绝、不写任何库。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/contract-steps.test.js src/__tests__/activity-contract-sync.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] notionwarehouse v3.0 第 3 刀 c 段：迁移 524 给 warehouse_items/activity_uses 补 notion_id/notion_synced_at/notion_digest（用料补 updated_at，两表同触发器只在业务列变化时抬 updated_at）；新模块 notion-warehouse-projection 把仓库物件（8 货架中文选项带色、被用于）与用料（Activity/物件双 relation）推到 Notion：库缺则在目录父页下建并带来源标记、认领同名同标记库、登记注册表，重跑不重复建，前提不足不建库；用料等两边页面都在才推，Activity 页 id 取目录投影链接；指纹没变不打 Notion；接进 runNotionPushSync 并吞错不连坐。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/notion-warehouse-projection.test.js src/__tests__/migration-524-warehouse-uses-notion-columns.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] notioncardcols v3.0 第 3 刀 b 段：目录投影把 Activity 页补成 15 列机器列（承诺/输入/输出/前提/不变量/NFR/失败语义/读回/判定点/对抗/保质期/用料）加 8 个带红绿灰黄色的格子列（来自 activity_cells 的 8 个标准格，缺格按灰、子项格不进卡片、不串别家），Step 页补动作/失败处理/模式三列；列名取值只在 activity-card.js 定义一次，目录 schema 与目录源共用；空值不编造；目录源 SQL 增载格子与用料并有真 PG 测试。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection/__tests__/activity-card.test.js src/projection/__tests__/directory-schema.test.js src/projection/__tests__/directory-source.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] notionregistrynames v3.0 第 3 刀 a 段：迁移 523 把 notion_projection_map 的键 journey_steps/journey_step_links 换成标准名 activities/activity_cells（先清未映射占位）、旧「价值流与能力」混合库停推（价值流与 Capabilities 早已各有独立库）、Ops 运行图谱登记名改闹钟总账；代码里 resolveDbId/推送表键/目录投影表映射/LEGACY_DB_CONSTANTS 同步标准名；pushOpsGraph 幂等把 Notion 库标题改为闹钟总账；守卫禁止代码再用旧名作注册表键。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/notion-registry-standard-keys.test.js src/__tests__/migration-523-notion-registry-names.test.js src/__tests__/ops-quota-notion.test.js --maxWorkers=1 --minWorkers=1"

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
- [x] [BEHAVIOR] dropactivitycolumns v3.0 第 5 刀③：迁移 528 删 activities 的 journey_id/step_number/enabler_id（删前备份进 migration_528_activity_columns_backup，回滚可还原），backbone_activities 下线、activity_flow_metrics 能力兜底改读 activity_placement、级联函数不再按 journey_id 删 Activity；GET /journey_steps 仍回显 journey_id/step_number（经 activity_placement），共用组件读 activity_uses。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-528-drop-activity-columns.test.js src/routes/__tests__/journeys.test.js --maxWorkers=1 --minWorkers=1"
