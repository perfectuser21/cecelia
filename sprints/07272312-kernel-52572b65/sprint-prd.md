# Sprint PRD — 真实执行路径的反馈血缘恢复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：以真实链路验收消除反馈血缘与合并授权假绿，预计推进 2 个百分点

## 背景

恢复任务 ba630704 / run a4d77c0e 的正式 REVISION；commit `71697ea1c87b9373169642f1abe7501646cb193f` 与 reviewer attempt `4a518e11-6d46-48ce-bdd9-f8862ce33327` 只作证据，不继承批准。产品法律为：**以真实 external launcher/in-process judge 分流恢复 reviewer result channel 与 server-owned feedback lineage，复用 HarnessResult v1。**

## Golden Path（核心场景）

入口是同一 Harness run 的真实 external launcher、callback、ground truth、dispatcher 与 merge gate；出口是五个行为在隔离数据库和真实 HTTP/派发链上同时成立：

1. **Behavior 1 — 结果通道**：系统从实际 external launcher 路径机械判定资格；reviewer 与 canary 获得不同、按 attempt 隔离的可写普通文件，`/workspace` 保持只读/最小；canary 保持 `CANARY_OK`、空 artifacts/checks、null error；in-process judge 不获得 `BRAIN_RESULT_FILE`。拒绝符号/硬链接、路径逃逸、跨 attempt、复用、缺失结果，并完成清理；文件必须 0600、owner 正确、nlink=1。
2. **Behavior 2 — HarnessResult v1**：仅扩展 `contract_version=1.0` 的 `decision.review`，不建 v2/旁路 schema/ledger。review outcome=`APPROVED|REVISION`；resolution status=`RESOLVED|UNRESOLVED|DISPUTED`；feedback≤50，唯一 id 1..64，text 1..2000；rubric≤20，id 1..64，score 为 0..10 整数，max_score=10，evidence 0..2000；总序列化结果≤262144 bytes。server 拥有 attempt/run/task/round/contract SHA，client 仅作相等声明；canonical SHA-256 v1 递归排序对象键、保持数组顺序、UTF-8 编码、排除 `decision.review.digest` 并由 server 重算。
3. **Behavior 3 — 真实 callback 持久化**：以生产 Authorization、`X-Harness-Lease-Owner` 与 body 调用真实 `POST /api/brain/harness/attempts/:attemptId/callback`；生产 store 在隔离 PostgreSQL 建真实 run/task/attempt。`harness_attempts.result` 保存完整有界 decision，`orchestrator_decision_log` 仅存有界 binding/digest/outcome 摘要。严格错误体为 `{ok:false,error:{key,code}}`：400 `invalid_result/invalid_result`；401 `invalid_credential/invalid_credential`；404 `attempt_not_found/attempt_not_found`；409 `scope_conflict/scope_conflict`、`lineage_conflict/lineage_conflict`、`digest_conflict/digest_conflict`；500 `persistence_failed/persistence_failed`。验证成功、篡改、同值重放去重、异值冲突、事务回滚、并发 attempt/run 与全表面脱敏。
4. **Behavior 4 — prior_review 血缘**：ground truth 只从同 run、同 round、同 contract SHA 的精确 reviewer attempt 读取 `prior_review`。Round 2 proposer TaskBundle 必带 prior_review，`decision.resolutions` 对每个 feedback id 恰好覆盖一次且无未知/重复/缺失；Round 2 reviewer 获得同一 prior_review、resolutions 与 fresh session。验证 REVISION→APPROVED、首轮无历史、显式 legacy adapter 无历史、非首轮缺历史阻断、恢复隔离、stale SHA、并发 run 隔离及 route→DB→ground-truth→dispatcher 全链。
5. **Behavior 5 — 最终 SHA 合并闸**：隔离 DB 中 evaluator、judge、human approval 记录与 server 解析的当前 PR head 必须共同绑定同一 final SHA；新 head 立即使三者全部失效。所有负路径 merge/deploy 调用均为 0；唯一合法路径各调用 1 次；只有最终外部副作用允许 spy，且 `review_required=true` 时在合并前停住等待用户批准。

## 边界情况

- 缺失结果、超界 payload、非法枚举/绑定、digest 篡改、同/异值重放、事务失败、stale head、恢复与并发隔离均 fail closed。
- 响应、日志与数据库不得反射 secret、transcript、chain-of-thought、stack 或 message。
- Red 必须是具名业务断言失败；vitest/config/import/依赖/数据库基础设施失败是假 Red，禁止计入。

## 范围限定

**在范围内**：恰好上述五个行为；HarnessResult v1 增量、真实 external launcher/in-process judge 分流、真实 callback/DB/ground truth/dispatcher/merge gate、一个五风险表、反事实 mutation 证明。  
**不在范围内**：HarnessResult v2、平行 schema/ledger、静态角色白名单、caller 构造权威行、修改边界处 mock pool、synthetic scenario、`typeof`/helper-existence/source-contains/grep 测试、生产数据库写入、自动合并。

## 假设

- [ASSUMPTION: payload 已将 `target_environment=local_api` 与 `review_required=true` 定为主源，不从旧 reviewer 结果继承状态。]
- [ASSUMPTION: Proposer 必须从 current-main 的真实入口锁定精确实现/测试文件；不得从历史 commit 猜路径。]

## 预期受影响文件

- `packages/brain/src/`：仅修改 current-main 中实际 external launcher、callback、ground truth、dispatcher、attempt store 与 merge gate 的既有入口；同步更新 `DEFINITION.md` 版本。
- `packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js`：新增五个具名真实业务链测试；Proposer 若发现 current-main 测试布局不同，必须在合同中替换为唯一实际路径，禁止并建旁路。
- `sprints/07272312-kernel-52572b65/`：保存本 PRD 与后续唯一实现合同及真实验收证据。

## 五风险表

| 风险 | 触发 | 必须观察 | 反事实证明 | 处置 |
|---|---|---|---|---|
| R1 通道越权 | judge 获 channel 或 reviewer/canary 串用 | launcher 拒绝且无残留 | 将资格改成静态 role list，B1 具名失败 | 从真实外部启动边机械派生 |
| R2 客户端伪造血缘 | client 改 round/SHA/digest | 严格 409 且 DB 无变化 | 禁用 server 重算，B2/B3 具名失败 | server-owned binding + canonical digest |
| R3 历史串线 | stale/跨 run review 被装入 Round 2 | 派发前阻断 | 放宽任一 run/round/SHA 条件，B4 具名失败 | 精确 reviewer attempt 查询 |
| R4 假 Red/假绿 | import/DB 配置错或 mock 绕过真实边 | 基础设施错误单列、不得算业务 Red | 换 mock pool 后测试必须被审查拒绝 | 真实 HTTP + 真实隔离 PostgreSQL |
| R5 漂移后误合并 | 验收后 PR head 改变 | merge/deploy 计数均 0 | 省略任一 SHA 绑定，B5 具名失败 | 四方同 SHA + 新 head 全失效 |

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: HarnessResult contract_version 仅 1.0；总序列化结果≤262144 bytes
- 可观测: 失败以冻结错误 key/code 与具名业务断言呈现；禁止敏感内容反射
- 数据环境: 必须显式解析 `TEST_DATABASE_URL`，并以 `current_database()`、`inet_server_addr()` 证明是隔离 PostgreSQL；绝不连接或变更生产 DB

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 id 合并去重；本次仅 area 非空，共 58 条 -->
- [看产物恢复] watchdog_overdue 后须经 orphan requeue 与 PR/sprint 外部真相核查再从头恢复（来源: area）
- [语义成功] 通知/写库成功必须检查 sent/accepted，禁止只看 ok:true（来源: area）
- [依赖修复] dep-audit 新 advisory 先查 fixAvailable，兼容修复优先 npm audit fix（来源: area）
- [长程心跳] headed relay 长 CI 等待须周期 PATCH 心跳，防 reaper 误标 failed（来源: area）
- [毕业双检] 测试入册 rename 后 push 前须跑 lint-tdd-commit-order 与 check-test-coverage（来源: area）
- [真退出码] 合同批准前须记录 manual oracle 真实 exit code 并确认解释器启动（来源: area）
- [模板转义] `node -e` 双引号内 JavaScript `${}` 须逐条真跑，bash -n 不足够（来源: area）
- [烟测1784808160] smoke 铁律（来源: area）
- [烟测1784806023] smoke 铁律（来源: area）
- [真实多轮] 跨扫描测试须至少一条不重置状态且时间真实流逝的集成路径（来源: area）
- [付费幂等] 周期重扫调用付费外部服务前须检查是否已处理（来源: area）
- [时间关系] 跨模块时间常数的大小依赖须写不变量断言或注释（来源: area）
- [环境关键字] contract 中环境关键词与 target_environment 必须语义一致，禁止靠排除说明规避（来源: area）
- [环境主源] target_environment 只能以 Brain task payload 为主源（来源: area）
- [judge格式] Brain judge 必须有 exit_code、log_tail 与逐条含 exit_code/log_tail 的 behavior_tests（来源: area）
- [字段有界] 无天然长度保证的数据写 varchar 前必须显式限定（来源: area）
- [复活查死因] 重做退役功能前须从删除历史与真实旧代码核对 death cause（来源: area）
- [错误值分支] 返回 null/false 表示失败的函数必须显式处理失败分支（来源: area）
- [烟测1784543954] smoke 铁律（来源: area）
- [状态停滞探针] journey_features.updated_at 停滞可作 report 漏跑探针（来源: area）
- [完成看收账] controller exit 0 不足以判完成，须核验 merge/report 产物（来源: area）
- [人工场景] host/环境白名单断言须覆盖 headed 人工接管（来源: area）
- [headed锚点] headed relay payload 须含 base_repo 或 pr_url，分支须带 task short id（来源: area）
- [退役看数据] 退役判断须核验生产数据与真实消费方，禁止靠记忆（来源: area）
- [吞错计数] catch 吞错的后台 job 必须有失败计数与连续失败告警（来源: area）
- [表名认领] 新建/复用表前须核对全部写入方并做 schema 对齐（来源: area）
- [必须有消费方] 新增后台 job 必须声明真实下游消费方（来源: area）
- [多端完整] 多设备字段须同 sprint 消解语义重叠并验收展示区分（来源: area）
- [unknown同义] 同一特殊值在判变端与终验端必须采用同一策略（来源: area）
- [ref校验] git ref 存在性必须用 `git rev-parse --verify "<ref>^{commit}"`（来源: area）
- [生产资源隔离] 测试 worktree 作 deploy root 时须逐项隔离生产资源副作用（来源: area）
- [部署失败] 部署链失败必须显式 FAIL、告警并非零退出，禁止 warning 降级（来源: area）
- [生产自报] 判变须用生产实体自报 SHA 对账 origin/main，禁止工作区 diff（来源: area）
- [异步质量] lint-test-quality 的源码读取测试须通过真实 async 调用满足 await fn（来源: area）
- [合同表格式] Test Contract 固定四列且 testFile 用反引号供 checker 解析（来源: area）
- [Red精确暂存] Red commit 只准 git add 精确测试路径（来源: area）
- [调度真验] 调度接线回归须验证真实调度行为；本任务明确禁止 source-inspection 代替行为 oracle（来源: area）
- [定时入口] 新增 cron 先核对 scheduler-jobs.js JOBS，tick-runner.js 已退役（来源: area）
- [合并权] generator 只推 branch；merge 权仅归 controller（来源: area）
- [headed环境] tmux innerCmd 必须显式 export Harness 上下文变量（来源: area）
- [先核真实历史] 复用历史合同/E2E 前必须核对本任务真实派发执行历史（来源: area）
- [共享CI禁区] 未经合同授权不得修改跨 sprint 共享 CI 基础设施（来源: area）
- [提前合并对账] CI 提前合并时须对账 evaluator/judge SHA 与实际合并 SHA（来源: area）
- [烟测1783850042] smoke 铁律（来源: area）
- [brain烟测] feat+brain/src PR 开 PR 前须同时带 smoke.sh 与 allowlist 登记（来源: area）
- [任务类型七点] 新 task_type 须核验约束、router、executor、relay 与 dispatcher 全接线（来源: area）
- [服务双信号] 常驻服务存活须同时核验 launchctl 与端口监听（来源: area）
- [Mac守护域] 美国 Mac mini 常驻服务禁止 LaunchAgents，须用系统 LaunchDaemon（来源: area）
- [宿主清单] 新常驻宿主服务须同步 launchd-patrol manifest 三清单（来源: area）
- [烟测1783693282] smoke 铁律（来源: area）
- [单槽串行] 同一 slot 仅一个任务状态；只读子代理可扇出，写代码实现者同时仅一个（来源: area）
- [环境不写死] 环境假设值必须推导或真机校准（来源: area）
- [真环境才done] 接缝断言未在真实目标验证只能标 logic-done-pending（来源: area）
- [默认多租户] 单元/E2E 默认至少两个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权不得 ship（来源: area）
- [租户隔离] 租户数据读写必须 scope 当前租户，绝不跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

安装/加载依赖后，先验证隔离数据库，再运行唯一真实链测试；不得将基础设施错误计作 Red：

```bash
npm ci
node -e 'const u=new URL(process.env.TEST_DATABASE_URL);if(!/^postgres(ql)?:$/.test(u.protocol)||!u.hostname||!u.pathname.slice(1))process.exit(2)'
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT current_database(), inet_server_addr(); SELECT CASE WHEN current_database() ~ '(test|harness)' THEN 'ISOLATED_OK' ELSE 'REFUSE_PRODUCTION' END;"
npx vitest run packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js --reporter=verbose
```

期望依次观察 `[B1] external result channel isolation`、`[B2] bounded HarnessResult v1 review`、`[B3] real callback transaction`、`[B4] exact prior_review lineage`、`[B5] final SHA merge gate` 五个业务测试 PASS；Red 阶段必须由同名业务断言失败。每个行为须执行风险表所列 mutation/counterfactual 并观察对应具名测试失败；恢复后全绿。最终合法路径 merge/deploy spy 各 1 次，所有负路径均 0 次；不执行真实 merge/deploy。

## journey_type: autonomous
## journey_type_reason: 仅涉及 Cecelia Brain 后端 Harness 调度、回调、持久化与合并授权链。
## target_environment: local_api
## target_environment_reason: task payload 显式指定 local_api；在本地 evaluator 通过真实 HTTP 与显式隔离 PostgreSQL 验收。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
