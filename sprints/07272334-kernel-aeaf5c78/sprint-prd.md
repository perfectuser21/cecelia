# Sprint PRD — worker-local attempt result sink 与 Round 2 feedback lineage 恢复

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

上一轮因 result sink、PostgreSQL 防护与 Red 真实性不足被正式判定 REVISION。本 sprint 以 task payload 的 thin_prd 为产品法律：用与只读 workspace 分离的 worker-local attempt result sink，恢复 local/fleet reviewer/canary 回传与 server-owned round2 feedback lineage；历史 proposer commit 与 reviewer attempt 仅作证据，不继承批准。

## Golden Path（核心场景）

Brain 从 reviewer 或 dedicated canary 派发入口 → 可信 runner 建立与只读 workspace 分离的 worker-local attempt result sink → 外部 agent 写入 HarnessResult → runner 校验、回调、证明并清理 → server-owned Round 2 消费可信 feedback lineage → 人工批准前停止。

具体：
1. B1：dispatcher 在 local-docker 与 fleet-worker 实际执行面派发 reviewer/canary；runner 创建 0700 目录和 0600 文件，仅向外部 agent 提供 `BRAIN_RESULT_FILE`，`workspace_spec` 保持 server-owned 且只读，in-process judge 不收到该变量。
2. B2：runner 只接收符合 HarnessResult 1.0 精确边界的 reviewer/canary 结果，服务端重算排除且仅排除 `decision.review.digest` 的 canonical SHA-256，并拒绝 caller path、跨 attempt、过期能力、scope/surface/mode/run 不匹配、未证明收件及文件安全反例。
3. B3：可信 runner 通过现有鉴权 callback 回传；真实 HTTP 路由仅产生规定的 `400/401/404/409/500` 严格键值，结果更新与 decision log 同事务，成功、失败、取消都在 finally 清理且生成绑定 run、attempt、execution surface、digest、cleanup outcome 的 attestation。
4. B4：系统持久化 Round 1 review，读取真实 ground truth，以 fresh bundle 派发 Round 2 proposer/reviewer，并保持每条 resolution 与原 feedback 的精确 lineage；legacy adapter 与当前 main 的真实 fleet-worker 入口必须在后续合同中点名，不能用泛称替代。
5. B5：系统从真实 evaluator/judge/human approval 行和只读 GitHub current-head 形成 merge gate；head 变化使旧批准失效，本任务 `review_required=true`，验证通过后仍停在人工批准前，不 merge、不 deploy。

## 边界情况

- 保留 `CANARY_OK` 空 envelope；reviewer 与 canary 使用不同 `expectedOutput`；judge 无 result file。
- 拒绝 symlink、hardlink、path escape、reuse、missing、oversize、错误 owner/nlink，以及跨 attempt、stale nonce/capability、lineage/digest/scope 冲突。
- HarnessResult 1.0：outcome 仅 `APPROVED|REVISION`；resolution 仅 `RESOLVED|UNRESOLVED|DISPUTED`；feedback ≤50 且 id 唯一 1..64、text 1..2000；rubric ≤20 且 id 唯一 1..64、整数 score 0..10、max_score=10、evidence 0..2000；UTF-8 JSON ≤262144。
- callback 响应 body 仅 `ok` 或 `error`，严格为 `400 invalid_result`、`401 invalid_credential`、`404 attempt_not_found`、`409 scope_conflict|lineage_conflict|digest_conflict`、`500 persistence_failed`，不得反射 secret、message、stack。
- B1-B5 每条命令都必须在 import Brain 或建行前执行同一 fail-closed PostgreSQL preflight；拒绝缺失、生产/本机/默认 socket/歧义地址，先只读连接并核对白名单数据库及非 loopback 服务地址。

## 范围限定

**在范围内**：实际 dispatcher、local runner、fleet attempt-runner、只读 `workspace_spec`、worker-local result sink、真实 callback HTTP、PostgreSQL 原子持久化、Round 2 lineage、真实 GitHub head 与 approval gate；五个行为各自具备真 Red、counterfactual mutation、恢复与 Green 命令；ARTIFACT oracle 必须 import/run 实现并验证 DEFINITION/package 版本语义。

**不在范围内**：复用 `workspace_spec` 作为可写通道；caller 提供任何 result/workspace host path；mock pool/store/spawnDetached、pure helper/parser/mergeGate、source contains/typeof/synthetic scenario 替代真实边；生产数据库写入；不可逆 GitHub merge 与生产 deploy（仅此两项可用 spy）。

## 假设

- [ASSUMPTION: Brain context 未提供 KR 编号，按当前第二个活跃 OKR 记为 KR-2；不改变产品 scope。]
- [ASSUMPTION: proposer 在绑定 `origin/main` 的 `d37a5e57827900be2651fe39655690238513128f` 或更新提交后，必须把当前 main 的实际 legacy adapter 入口及 fleet-worker 文件路径写入合同；Planner 不以猜测路径替代。]

## 预期受影响文件

- `packages/brain/src/`：dispatcher、local runner、callback、结果持久化、feedback lineage 与 approval gate 的用户可观察行为。
- 当前 main 的 fleet attempt-runner 文件：worker-local sink、只读 workspace authority、attested receipt 与 finally cleanup；确切文件名由 proposer 基于绑定提交写入合同。
- `packages/brain/DEFINITION.md` 与对应 package manifest：Brain 行为变更的版本语义。
- 本 sprint B1-B5 测试与 E2E 工件：真实边、Red/counterfactual/Green 与 PostgreSQL preflight 证据。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: HarnessResult 1.0；JSON 与 result file 最大 262144 UTF-8 bytes
- 可观测: attestation 必须绑定 run_id、attempt_id、execution_surface、digest、cleanup outcome；错误不得泄露敏感信息
- 安全与数据: result 目录 0700、文件 0600；禁止生产 DB mutation；所有 B1-B5 使用隔离 TEST_DATABASE_URL

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；step/feature 为空，area 共 58 条 -->
- [超时恢复] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [语义成功] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [依赖审计] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [relay 心跳] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断裂）（来源: area）
- [毕业门禁] 毕业 commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push；rename 是 contract 路径与 Red 计数失效的高危触发点（来源: area）
- [真退出码] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area）
- [真跑命令] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure（来源: area）
- [烟测一] smoke 铁律（来源: area）
- [烟测二] smoke 铁律（来源: area）
- [多轮扫描] 测试若依赖重置状态=冷启动，必须补至少一条真实多轮扫描、状态不重置、时间真实流逝的集成测试（来源: area）
- [付费幂等] 周期性重扫引入外部付费调用时必须前置检查是否已处理，不能假设重扫不常发生（来源: area）
- [时间关系] 跨模块时间常数存在大小关系时必须显式写不变量断言或注释，不能指望单任务测试覆盖（来源: area）
- [剧场匹配] theater_mismatch 会扫描合同文字中的环境关键词；目标环境必须匹配真实功能执行面（来源: area）
- [环境来源] target_environment 由 Brain orchestrator 从 tasks.payload 读取，点火时必须正确设置（来源: area）
- [judge 格式] Brain judge API 必须有顶层 exit_code、log_tail、behavior_tests，且每条行为有 exit_code 与 log_tail（来源: area）
- [字段长度] DB 字段有长度约束且来源无天然上限时必须写入前显式截断（来源: area）
- [复活溯源] 复活退役功能前必须读取删除历史与退役前真实代码核对 death cause，不只信 commit message（来源: area）
- [显式失败] 调用以 null/false 表示失败的函数时必须显式处理失败分支，不能只依赖 try/catch（来源: area）
- [烟测三] smoke 铁律（来源: area）
- [报告探针] journey_features.updated_at 长期早于 PR 合并时间可作为 report 漏跑探针（来源: area）
- [收账产物] Brain 不得仅凭 relay exit code 0 判完成，必须校验 report 产出物（来源: area）
- [headed 白名单] 合同起草 host/环境白名单断言时必须核对 headed 人工接管场景（来源: area）
- [点火可追踪] headed relay 点火必须带 base_repo 或 pr_url，且分支名带 task short id（来源: area）
- [数据判退役] 退役判断必须查生产真相、表行数、状态分布和消费方，不靠记忆（来源: area）
- [后台告警] catch 吞错的后台 job 必须有失败计数，连续失败超阈值告警（来源: area）
- [表名认领] 建表或复用表前必须查全部写入方；多个模块写同表须 schema 对齐评审（来源: area）
- [真实消费] 新增后台 job 必须声明真实消费方，无下游读方的落库 job 不上线（来源: area）
- [多端完整] 新字段与既有字段语义重叠必须本 sprint 消解或建立正式 decision 与任务；涉及多设备类型必须逐类验收展示（来源: area）
- [未知语义] 同一语义如 git_sha=unknown 在判变端与终验端必须采用同一策略（来源: area）
- [引用校验] git rev-parse 判 ref 存在必须带 `--verify "<ref>^{commit}"`（来源: area）
- [烟测隔离] smoke 使用真实 worktree 时必须核对是否触碰生产资源，并显式列出跳过钩子（来源: area）
- [部署失败] 部署链失败路径禁止 warning 降级，必须告警并非零退出（来源: area）
- [生产自报] 判变基准必须用生产实体自报对账 origin/main，禁用工作区 diff（来源: area）
- [测试质量] lint-test-quality 要求 await fn() 至少一次，读源码须包装 async function（来源: area）
- [合同表格] Test Contract 固定四列，testFile 用反引号包裹且 checker 从第三列解析（来源: area）
- [Red 精确提交] Red commit 只能 git add 精确测试路径，不得 add 整目录（来源: area）
- [调度回归] 回归测试可用 source inspection 验证既有调度接线（来源: area）
- [定时入口] 新增 cron 功能先检查 scheduler-jobs.js JOBS，tick-runner.js 已退役（来源: area）
- [禁止自并] generator 不得自行 merge PR；merge 权归 controller（来源: area）
- [显式环境] headed relay 的 tmux innerCmd 不自动继承父进程环境；所需 harness 变量必须显式 export（来源: area）
- [历史核验] Proposer 复用历史合同前必须核对本次真实派发与执行历史（来源: area）
- [共享禁区] generator 未经合同授权不得修改共享 CI 基础设施；自身改动触发问题须另走 sprint（来源: area）
- [SHA 对账] evaluator/judge 完成前若 PR 被兜底机制合并，必须核对 verdict SHA 与实际合并 SHA（来源: area）
- [烟测四] smoke 铁律（来源: area）
- [Brain 烟测] feat 且修改 brain/src 的 PR 开 PR 前必须带齐 smoke 与 allowlist 登记（来源: area）
- [任务接线] 新 task_type 必须核对 CHECK、router、executor kind/dispatch/override、skill 映射及 dispatcher 三防线（来源: area）
- [服务双信号] 服务存活必须同时核对 launchctl 状态与端口监听（来源: area）
- [常驻域] 美国 Mac mini 的常驻服务不得放 LaunchAgents，须使用系统域 LaunchDaemon 与正确 UserName（来源: area）
- [守护清单] 新增常驻宿主服务必须同步加入 launchd-patrol.js manifest（来源: area）
- [烟测五] smoke 铁律（来源: area）
- [单槽串行] 一个 slot 只允许一个任务状态；任务间串行，单任务内只读可扇出但同刻仅一个写代码实现者（来源: area）
- [环境推导] 环境假设值禁止写死，必须从环境推导或真机校准（来源: area）
- [真验才完成] 依赖真实环境的接缝断言必须在目标上验证；未真验只能标 logic-done-pending（来源: area）
- [多租户测试] 单元/E2E 默认种至少两个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不得交付（来源: area）
- [租户隔离] 涉及租户数据的读写必须 scope 到当前租户，绝不跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 必须产出五条各自可执行的 B1-B5 命令；每条先证明依赖加载，
# 再执行同一 fail-closed PostgreSQL preflight，随后命中真实修改边。
# 每条须记录：初始非零 Red（且不是 import/config/DB/network 假红）、
# 精确 counterfactual mutation 命令与预期 named failure、恢复命令、Green 命令。
# 聚合验收点：B1 result sink/dispatcher；B2 HarnessResult 边界与 digest；
# B3 真实 HTTP + PostgreSQL 原子回滚；B4 server-owned Round 2 lineage；
# B5 真实 GitHub head + approval gate，最终 merge/deploy 调用次数为 0。
```

## journey_type: autonomous
## journey_type_reason: 核心入口和出口均为 Brain/Fleet 后端调度、回调、持久化与审批门禁，无用户界面路径。
## target_environment: local_api
## target_environment_reason: task payload 显式指定 local_api；在本地 evaluator 连接隔离的远端 TEST_DATABASE_URL，并通过真实 GitHub 只读 GET 验收。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
