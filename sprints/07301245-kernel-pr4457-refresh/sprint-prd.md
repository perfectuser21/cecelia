# Sprint PRD — Draft PR #4457 累计分支冲突与 CodeQL 收敛

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：恢复 Draft PR #4457 的 exact-head CI 可审阅状态

## 背景

只更新现有 Draft PR #4457 / 分支 `cp-kernel-phase5b-a1-review-fixes`。起点精确为 `8f2137d0f5ad7091699f42635ea76c35e0765bd9`，出生时 main 为 `264482fadd87dc8bf6e7d4534c156ee28e276ccf`。本 sprint 在保留累计 Kernel Harness 行为与诚实状态的前提下，收敛与 current main 的 32 个已知冲突及 CodeQL 聚合检查的 77 个告警。

## Golden Path（核心场景）

维护者从现有 Draft PR #4457 的指定分支与精确起点进入 → 经 Contract GAN 冻结冲突清单、冲突解决策略、CodeQL 告警清单和 exact-head required checks oracle → generator Red/Green 保留累计行为并解决真实问题 → exact-head CI 对最终 SHA 运行 → evaluator 绑定同一最终 SHA 真跑复核 → judge PASS 后停在主理人人工审阅门。

具体：
1. 系统确认只操作现有 Draft PR #4457，PR 始终保持 Draft、OPEN、`autoMerge=null`，且不新建 PR、不 merge、不 staging、不 production deploy。
2. 32 个冲突逐项按冻结策略解决；共享 `package-lock`、`DEFINITION`、CI workflow 与最终 merge integration 由单一集成 workstream 串行收口。
3. 77 个 CodeQL 告警逐项分类并修复真实问题；范围外或假阳性必须留下机器可验证基线和 evaluator 可复查证据。
4. 保留 QuickCheck fail-closed、node:test 双登记、OKR in-process `cecelia_test`、migration 369-381 冻结四项 blocker 修复及合同证明。
5. atomic truth 保持 `schema_valid=true`、`proof_complete=false`、`atomic_cutover_ready=false`、`0/99`，不得伪造 receipt 或篡改诚实状态。
6. 最终 required checks 全部针对同一 exact-head SHA；evaluator 的实跑证据也绑定该 SHA，judge PASS 后不越过人工审阅门。

## 边界情况

- current main 在执行期间继续前进时，不得把非冻结 SHA 的检查结果冒充最终 exact-head 结果。
- 冲突与 CodeQL 告警存在重叠文件时，以单一集成收口后的最终内容和复跑结果为准。
- 不得通过 dismiss、allow-failure、修改 required checks、弱化 branch protection、删除测试或缩小扫描范围取得绿灯。
- 任何无法证明为已修复、范围外或假阳性的告警均保持未完成，不得静默忽略。

## 范围限定

**在范围内**：现有 Draft PR #4457 的累计分支整合、32 个冲突、77 个 CodeQL 告警、保留四项 blocker 合同证明、atomic truth 与 exact-head CI/evaluator 证据。

**不在范围内**：新建 PR、合并 PR、启用 auto-merge、修改保护规则、部署 staging/production、扩大产品功能范围。

## 假设

- [ASSUMPTION: 冻结时记录的 32 个冲突和 77 个 CodeQL 告警是本 sprint 的完整输入基线；后续新增项必须显式追加而非替换基线。]
- [ASSUMPTION: current main 的整合目标 SHA、required checks 集合及每项结论由 Contract GAN 固化并可机器读取。]

## 预期受影响文件

- `package-lock.json`: 共享依赖冲突只由集成 workstream 串行收口。
- `packages/brain/DEFINITION.md`: 若 Brain 行为受影响，版本与行为定义必须保持同步。
- `.github/workflows/`: CI 相关冲突由集成 workstream 收口，required checks 与扫描范围不得弱化。
- Draft PR #4457 冻结冲突清单与 CodeQL 告警清单所指向的既有文件：仅按冻结策略解决对应冲突或真实告警。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 完整性：32 个冲突与 77 个 CodeQL 告警逐项有可机器复查结论。
- 安全性：不得弱化 CodeQL、required checks、branch protection 或扫描范围。
- 可观测：所有 CI、evaluator 与 judge 证据绑定最终 exact-head SHA。
- 状态诚实：PR 和 atomic truth 的指定状态全程保持，不以伪造证据换取通过。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [proposer] proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈）（来源: area）
- [contract] contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点（来源: area）
- [watchdog] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [通知/写库接口的] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [dep-audi] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [headed r] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断（来源: area）
- [毕业（测试入册）] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失（来源: area）
- [合同批准前必须同] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [manual:n] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [smoke-in] smoke 铁律（来源: area）
- [smoke-in] smoke 铁律（来源: area）
- [测试如果全部依赖] [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测（来源: area）
- [涉及"周期性重新] [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的（来源: area）
- [跨模块的"时间常] [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测（来源: area）
- [theater_] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area）
- [target_e] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）
- [Brain ju] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [DB 表字段长度] [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工（来源: area）
- [复活/重做一个曾] [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m（来源: area）
- [调用任何"失败不] [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（来源: area）
- [smoke-in] smoke 铁律（来源: area）
- [journey_] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [harness-] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 （来源: area）
- [contract] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [headed r] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub （来源: area）
- [退役判断依据数据] [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [catch 吞错] [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [表名认领冲突：建] [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [新增后台 job] [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [多设备类型(os] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性扫描找同类'字段有但下游UI未接线'模式。（来源: area）
- [同一语义（如 g] [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [`git rev] [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [smoke/测试] [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子（来源: area）
- [部署链任何失败路] [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸（来源: area）
- [判变基准永远用"] [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [lint-tes] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [Test Con] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [Red comm] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [回归测试用 so] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [新增 cron ] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [harness-] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [headed r] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD（来源: area）
- [Proposer] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area）
- [给 harnes] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享（来源: area）
- [PR 被 sho] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合（来源: area）
- [smoke-in] smoke 铁律（来源: area）
- [feat+bra] [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [新 task_t] [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re（来源: area）
- [服务"该活着"的] [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [本机（美国 Ma] [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator（来源: area）
- [新增常驻宿主服务] [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE（来源: area）
- [smoke-in] smoke 铁律（来源: area）
- [单 slot 串] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出，但动手写代码的实现者同一时刻永远只有一个（与 subagent-driven 的禁并行实现者规则一致，防多写手改冲同一文件）。分水岭不是 agent 数量，是任务状态数量：一个会话里只允许存在一个任务的状态。（来源: area）
- [禁止写死环境假设] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [真环境验证才算d] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）


## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：机器确认 PR #4457 仍为 Draft、OPEN、autoMerge=null；冻结清单逐项闭合；
# 四项 blocker 证明与 atomic truth 保持；required checks、CodeQL 和 evaluator 证据均绑定最终 exact-head SHA；
# judge PASS 后流程停在主理人人工审阅门，且没有新 PR、merge 或 deploy。
```

## journey_type: dev_pipeline
## journey_type_reason: 核心路径是 Contract GAN、generator Red/Green 与 exact-head CI 的开发流水线收敛。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，由本地 evaluator 核验仓库、PR 元数据与 exact-head 证据。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
