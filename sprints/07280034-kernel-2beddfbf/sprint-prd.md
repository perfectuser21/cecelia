# Sprint PRD — 可信 server-owned Test Environment Controller 恢复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：以真实 PostgreSQL 与宿主 Docker 证据解除 Feedback R5、Preview R6、Capacity、Knife1 的共同前置阻塞

## 背景

前两次恢复已因调用方仍可影响数据库能力、静态/模拟证据代替真实链路、反例与清理覆盖不完整而被正式退回。本 sprint 从 `origin/main` `274fff5a4a22f3bb3ec5d2d304f3e14bd9aeba71` 或更新基线重新建立可信 server-owned Test Environment Controller；历史 proposer commit `565885a3146d4726b98b2ef070e38dd9fb005a98` 与 reviewer attempt `b3b531d1-eea5-4408-8457-ad23eb5080dd` 仅作被拒证据，不承接批准。

## Golden Path（核心场景）

Brain 从已持久化 attempt 与冻结的服务端合同进入可信 server-owned Test Environment Controller → 为确实声明数据库能力的角色命令签发 attempt-scoped PostgreSQL capability → 经本地或已认证远端链路只注入实际 runner → 真实 PostgreSQL 预导入 oracle、V5 migration、import purity 与全终态 cleanup 全部通过 → 结构化 provider callback 和签名的无凭据证据成为权威出口。

具体：
1. Dispatcher 先持久化 attempt，再只依据冻结的服务端合同事实与角色命令声明判断数据库资格；调用方 payload、prompt、TaskBundle、git 产物、stdout 均不能选择 URL、receipt、数据库、角色、nonce、CIDR 或资格。
2. 每个合格 attempt 获得唯一数据库、登录角色、随机密钥、到期时间与 nonce；本地与 fleet attempt 不共享这些资源，非 attempt/生产数据库及其对象对该角色保持零权限。
3. 公开 receipt 只含固定白名单字段、明确 canonicalization/signature/digest 位置与 cleanup 结果；严格验签、拒绝未知字段、过期、篡改、绑定错误和重放，所有持久化面均无 URL、密码或 token。
4. 本地 launcher 只把瞬态能力作为内部启动参数传给真实 child/container；远端只在已认证 server-to-worker POST 内携带，worker 校验全部绑定后由真实 attempt-runner 注入；judge 与无关命令从不收到能力。
5. DB consumer 导入前，oracle 先连接真实 PostgreSQL，证明当前数据库、用户、非回环且在 CIDR 内，并以 catalog/ACL 证明非 attempt/生产数据库、schema、table、sequence、function 零 CONNECT/CREATE/TEMP/对象权限。
6. V5 migration/seed/bootstrap 仅经 controller-issued `TEST_DATABASE_URL` 运行并在同一数据库看见 `journey_step_links`；旧 `DB_NAME=cecelia`、缺 URL 与全部独立反例分别失败；真实既有 `kernel-harness-f1-baseline` consumer 的 import purity 在无 `psql` PATH 下保持 catalog/env/process 不变。
7. success、failure、cancel、SIGKILL、runner crash、worker restart、recovery/reconcile 分别执行真实测试；终态终止 session、撤销角色、删除 DB/lease、保存签名无凭据 receipt，旧登录失败且重复 cleanup 不重建资源。
8. proposer/reviewer 容器先给出真实 PG 证据；合同批准前，宿主 operator 在同一 proposer SHA 上以真实 Docker 跑本地与 fleet 生产链并附签名命令/SHA/exit/业务断言 receipt。缺宿主 receipt 时 Docker 边保持 `Uncovered Real Chain`，PR 只保留 Draft 并停在人工批准/merge 前。

## 边界情况

- 缺 receipt、缺 URL、过期 receipt、stale/reused nonce、cross-attempt、ambiguous host、misdirected DB、loopback、default socket、生产名称/host/权限、未知字段、body/signature/digest 篡改，必须各有独立命名失败与独立恢复。
- capability 出现在 judge 或无关角色时立即失败；receipt/task/run/result/log/callback/artifact 出现 URL、密码或 token 时立即失败。
- cleanup timeout/reconcile 有界且 fail-closed；重复 cleanup 幂等，不得复建数据库、角色或 lease。
- `BRAIN_RESULT_FILE` 缺失、只读 workspace 或 stale `.brain-result.json` 不影响结构化 provider callback 的权威性，也不得制造 false OK。
- 缺依赖、环境、配置、import、网络、Docker、测试文件或真实 fixture 连接属于 `FAKE_RED`，不能算业务 Red。

## 范围限定

**在范围内**：服务端可信 controller 工厂；server-owned 资格判定与 attempt 隔离；签名 receipt；本地/fleet 生产传输和 runner 注入；真实 PG oracle；V5 migration/seed；现有 consumer import purity；八类终态 cleanup；容器 PG 证据与宿主 Docker operator gate；结构化结果权威性。
**不在范围内**：生产数据库写入；真实 merge/deploy；让调用方或 TaskBundle 提供数据库能力；用 mock、source grep、文件存在性、正则或静态 YAML 代替行为证据；在 operator gate 前关闭 Docker-only uncovered edges。

## 假设

- [ASSUMPTION: `payload.anchor.step_id` 是本 sprint 的 Golden Path 锚点；`journey_id` 采用 payload 的规范 UUID。]
- [ASSUMPTION: `local_api` 是当前枚举中对 Brain 后端 controller 的主路由；宿主 Docker 是合同批准前独立的 HOST OPERATOR gate，不由无 Docker socket 的角色容器伪装完成。]
- [ASSUMPTION: 具体生产 import 路径由 proposer 通过当前真实 consumer/dispatcher 解析锁定，Planner 不发明未来模块。]

## 预期受影响文件

- `packages/brain/src/`: controller、dispatcher、生产本地/远端 transport、worker/attempt-runner 与结构化结果链
- `packages/brain/migrations/`: receipt/attempt 权威状态与 V5 数据库合同所需迁移
- `packages/brain/tests/`: 真实 PG controller/receipt/oracle、local/fleet、lifecycle 与 import-purity 独立套件
- `scripts/`: 精确可复跑的 operator bootstrap、宿主 Docker E2E、反例恢复与无凭据 receipt 命令
- `packages/brain/DEFINITION.md`: Brain 行为与版本同步更新

## 验收计划

- [ ] A：真实 PG controller/receipt/oracle 套件逐项证明唯一资源、严格签名/字段、资格、CIDR、ACL 与每个独立反例；fixture 缺失时以命名断言失败。
- [ ] B：V5 migration/seed 只用 controller-issued URL，在同一 DB 验证 `current_database` 与 `journey_step_links`；旧 DB_NAME 和缺 URL 独立失败并独立恢复。
- [ ] C：真实既有 `kernel-harness-f1-baseline` consumer 在无 `psql` PATH 下导入，catalog/env/process 前后不变；依赖先成功加载。
- [ ] D：真实 local dispatcher → launcher → child/container 链证明只有合格命令收到 `TEST_DATABASE_URL` 与无凭据 receipt。
- [ ] E：真实 remote bridge → authenticated HTTP worker → attempt-runner → Docker 链在宿主执行，并校验绑定、重放、注入与 judge/无关角色缺席。
- [ ] F：八种终态逐个执行，证明 session/role/DB/lease 清除、旧登录失败、签名 terminal receipt、幂等与有界 fail-closed reconcile。
- [ ] 每个 Golden Path 步骤保留 exact Red、独立 counterfactual、restore、预期 Green 的命令/输出和无凭据 receipt；禁止静态 theater 与修改边 mock。
- [ ] reviewer 只采信 `harness_attempts` 中结构化 provider result；宿主 Docker receipt 缺失、任一分数低于 7 或存在 caller authority/secret persistence 时必须 REVISION。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: cleanup timeout 与 reconcile 必须有界且 fail-closed；具体预算待 proposer 在合同中锁定
- 频控: nonce 单次使用；replay 必须拒绝
- 版本要求: operator bootstrap 使用 `postgres:16-alpine`；V5 migration 与真实现有 consumer 必须运行
- 可观测: 每个业务 Red/反例/恢复/Green 都需唯一命名断言、真实 exit code、精确 SHA 和无凭据签名 receipt
- 安全: secret 不持久化、不进 TaskBundle/provider_spec/result/log/callback/artifact；生产数据库不可写

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [超时恢复] watchdog_overdue 标 failed 的 relay run 经 orphan requeue 与外部真相核查后，从头重跑是安全恢复路径（来源: area）
- [语义成功] 通知/写库成功必须检查 sent/accepted 等语义字段，不能只看 ok:true（来源: area）
- [依赖修复] dep-audit 新 advisory 先检查 fixAvailable，再决定兼容修复或白名单（来源: area）
- [会话心跳] headed relay 长等待必须持续写心跳，禁止把存活 session 误标 failed（来源: area）
- [毕业门禁] 测试毕业 commit 后必须先跑 lint-tdd-commit-order 与 check-test-coverage（来源: area）
- [手工退出] 合同批准前记录 manual oracle 真实 exit code 并确认目标解释器启动（来源: area）
- [模板展开] manual node 命令中的模板字符串必须逐条真跑，bash -n 不足以证明（来源: area）
- [冒烟铁律1] smoke 铁律（来源: area）
- [冒烟铁律2] smoke 铁律（来源: area）
- [多轮状态] 周期测试必须包含状态不重置且时间真实流逝的多轮集成场景（来源: area）
- [重扫去重] 周期重扫触发付费调用时必须先判断是否已处理（来源: area）
- [时间关系] 跨模块时间常数的大小依赖必须显式成为 invariant（来源: area）
- [环境文本] 环境匹配应基于真实功能环境，不能借错误环境绕过 theater_mismatch（来源: area）
- [环境来源] target_environment 由任务 payload 权威提供，不能从本地文件推断（来源: area）
- [Judge格式] Judge 结果必须包含顶层 exit_code/log_tail/behavior_tests 及逐项 exit_code/log_tail（来源: area）
- [字段长度] 无天然长度保证的数据写入受限 DB 字段前必须显式处理边界（来源: area）
- [复活取证] 恢复退役功能前必须读取删除历史与退役前真实代码核对死因（来源: area）
- [返回失败] 对 null/false 失败契约必须显式处理失败分支，不能只靠 catch（来源: area）
- [冒烟铁律3] smoke 铁律（来源: area）
- [报告探针] journey_features.updated_at 异常停滞是 report 阶段漏跑探针（来源: area）
- [完成判定] Brain 不得只凭容器 exit 0 完成任务，必须校验 report 产物（来源: area）
- [人工接管] host/环境白名单合同必须核对 headed 人工接管场景（来源: area）
- [点火可追] headed relay payload 必须有 base_repo/pr_url，分支名必须带 task short id（来源: area）
- [退役实证] 退役判断必须基于生产库与真实消费方证据，不靠记忆（来源: area）
- [后台告警] catch 吞错的后台 job 必须有失败计数与连续失败告警（来源: area）
- [表名认领] 新建或复用表前必须核对所有写入方并评审 schema 对齐（来源: area）
- [真实消费] 新增后台 job 必须同时声明真实消费方（来源: area）
- [多端完整] 多设备字段必须有对应展示区分，语义重叠要在本 sprint 消解或正式决策（来源: area）
- [语义一致] 同一语义在判变端与终验端必须采用同一处理策略（来源: area）
- [引用校验] git ref 存在性必须用 rev-parse --verify 并限定 commit（来源: area）
- [生产隔离] 测试用真实 worktree 时必须核对并显式隔离所有可能触碰生产资源的边（来源: area）
- [失败非零] 部署链任何失败都必须告警并非零退出，不得 warning 降级（来源: area）
- [生产自报] 判变基准使用生产实体自报 SHA 对账 origin/main，不能使用工作区 diff（来源: area）
- [异步质量] lint-test-quality 要求行为测试真实 await，不能 readFileSync 读源码充数（来源: area）
- [合同格式] Test Contract 表格固定四列，testFile 路径按 checker 契约书写（来源: area）
- [精确暂存] Red commit 只暂存精确测试路径，禁止 git add 点目录（来源: area）
- [禁静态验] 调度接线不能以 source-code inspection 充当本 sprint 行为证明（来源: area）
- [调度正路] 新增 cron 必须走 scheduler-jobs，不能走 deprecated tick-runner（来源: area）
- [合并归属] generator 只能推送 ready branch，禁止自行 merge PR（来源: area）
- [环境继承] headed relay 子 shell 所需 harness 环境变量必须在 innerCmd 明确传入（来源: area）
- [先例核查] 复用历史 E2E 合同时必须先核对本次真实派发/执行历史（来源: area）
- [共享禁区] 未经合同授权不得修改跨 sprint 共享 CI 判定文件（来源: area）
- [提前合并] CI 提前合并时必须核对 verdict SHA 与实际 merge SHA 一致（来源: area）
- [冒烟铁律4] smoke 铁律（来源: area）
- [Brain冒烟] feat 且修改 brain/src 时必须同步 smoke 与 allowlist 登记（来源: area）
- [类型接线] 新 task_type 必须核对约束、路由、executor、relay、cap/lock/bridge 全链（来源: area）
- [服务双信] 常驻服务存活必须同时看服务管理状态与端口监听（来源: area）
- [宿主服务] 美国 Mac mini 常驻服务使用系统域 LaunchDaemon，不使用不可用 GUI LaunchAgent 域（来源: area）
- [清单同步] 新常驻宿主服务必须同步加入 launchd-patrol manifest（来源: area）
- [冒烟铁律5] smoke 铁律（来源: area）
- [单槽串行] 一个 slot 内任务严格串行；任务内只读可扇出但同时仅一个代码实现者（来源: area）
- [禁写假设] 环境接缝值必须从环境推导或真机校准，禁止写死（来源: area）
- [真验才完] 真环境接缝未验证只能标 logic-done-pending，不能标 done（来源: area）
- [多租户测] 单元/E2E 默认至少两个租户并证明互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须鉴权，无鉴权不得发货（来源: area）
- [租户隔离] 租户数据读写必须按当前租户隔离，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 主环境生成真实 PG 的可执行命令，并另列宿主 HOST OPERATOR Docker 命令
# 期望验收点：A-F 六套真实链路全部通过；独立反例均在成功依赖加载和 fixture 连接后命中唯一业务断言；宿主 receipt 锚定同一 proposer SHA；无生产写入、无 secret、无假绿
```

## journey_type: autonomous
## journey_type_reason: 核心行为位于 Brain 后端的自主 dispatcher、controller、transport、worker 与 cleanup 链路
## target_environment: local_api
## target_environment_reason: 主验收在本地 Brain/真实 PostgreSQL 执行；同一 SHA 的真实 Docker 全链必须由美国 Mac host operator 另行执行并签名
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 1a738e05-99a7-421c-a52d-c2bb80bf19be
