# Sprint PRD — Draft PR #4457 四个 DevOps blocker 等价修复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：通过消除四个 DevOps blocker 提升累计 Kernel 分支的可验证性；不虚报百分比增量。

## 背景

现有 Draft PR #4457、分支 `cp-kernel-phase5b-a1-review-fixes`、基线 SHA `c0cd82fe298a8d1df812699507709d564a296f4e` 的首次完整 pre-push 暴露四个相互独立的 blocker。本 sprint 只修复 QuickCheck false-pass、原生 node:test 误收集、OKR integration 误连生产 Brain、migration 历史窗口吸入 382，并形成真实等价证明。

## Golden Path（核心场景）

维护者从现有 Draft PR #4457 的四个已确认 blocker 入口 → 按合同完成 Red/Green 与聚焦回归 → CI、evaluator 与 judge 给出锚定同一 PR head 的可信结果，PR 保持 Draft 等待主理人人工批准。

具体：
1. QuickCheck 面对大输出真实失败时返回非零；未知非零失败 fail-closed；只有明确 OOM/worker 签名、有 pass summary 且无 fail summary 时才保留降级。
2. `node:test` mutation seam 仅由原生 runner 执行，Vitest 不再收集；`test:node` 登记与自动 ratchet 同时覆盖该文件。
3. OKR integration 在测试进程内通过 Express/Supertest 调用真实 router，并与 fixture 共同绑定 `cecelia_test`；不得调用生产 Brain 或生产数据库 `cecelia`。
4. historical migration fixture 精确执行 369–381，382 不混入该随机 schema fixture；382 专属验证继续通过，生产 migration SQL 不变。
5. 四项各自留下先 RED 后 GREEN 的证据，统一验证全绿；atomic check 仍诚实报告 `schema_valid=true`、`proof_complete=false`、`atomic_cutover_ready=false`、live proof `0/99`，manual cutover gate 仍返回非零。
6. evaluator 真跑并由 judge PASS 后，只更新既有 Draft PR #4457；首次变更 merge 前停在主理人人工批准门，禁止创建重复 PR、Ready、merge 或 deploy。

## 边界情况

- QuickCheck 日志含 ANSI、超大输出、失败文件/失败测试摘要或未知 runner 非零退出时，不得因 SIGPIPE 或模糊文本分类而假绿。
- 只有 OOM/worker 正向信号、通过摘要、无任何失败摘要三项同时成立，才允许兼容性降级。
- 测试数据库 preflight 不是 `cecelia_test` 时立即失败，不允许回退到 `BRAIN_URL`。
- 新增 migration 382 及以后不得改变 historical 369–381 fixture 的应用集合。
- 任一验证不确定、runner 异常、PR head 不一致或人工门未批准时均保持 Draft 和 blocker。

## 范围限定

**在范围内**：四个 blocker 的回归合同、Red/Green 修复、聚焦及统一验证、既有 Draft PR #4457 状态更新。

**不在范围内**：Kernel cutover、receipt v2、controller 权威边界调整、synthetic/legacy receipt 计数、migration 381/382 生产 SQL 或 Brain schema version 修改、新 migration 383、创建新 PR、merge 与 deploy。

## 假设

- [ASSUMPTION: payload 中 `anchor.step_id` 是本 sprint 的 Golden Path 锚点；task 顶层 ability_id 为空不影响 step 锚定。]
- [ASSUMPTION: “CI 全绿”指既有 Draft PR #4457 在同一最终 head 上的必需检查，不以其他 SHA 或重复 PR 的结果替代。]

## 预期受影响文件

- `scripts/quickcheck.sh`: 修正 Vitest 退出分类与临时日志生命周期。
- `packages/engine/tests/scripts/quickcheck-vitest-exit-classification.test.ts`: 固化真实失败与 genuine OOM 分类。
- `packages/brain/src/__tests__/native-node-test-runner-registration.test.js`: 检查原生测试双登记完整性。
- `packages/brain/vitest.config.js`: 从 Vitest 排除 mutation seam。
- `packages/brain/package.json`: 将 mutation seam 登记到 `test:node`。
- `packages/brain/src/__tests__/okr-decomposition-flow.integration.test.js`: 改为绑定 `cecelia_test` 的进程内 Express/Supertest。
- `packages/brain/src/__tests__/kernel-release-runs.integration.test.js`: 冻结 historical 369–381 migration window 并断言 382 未偷跑。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；两路 decisions 查询均为空。 -->
- 超时/延迟: 由 task payload 约束整轮最长 28800 秒；单项未另行指定。
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 基于 Draft PR #4457 的指定分支与 SHA；不得漂移到其他 PR/head。
- 可观测: 保留 runner 真实 exit code、失败响应 body、Red/Green、focused regression、CI、evaluator、judge 与人工门证据。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；step/feature 为空，area 共 60 条全量注入。 -->
- [learning: pr] learning: proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈）（来源: area）
- [learning: co] learning: contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点（来源: area）
- [learning: wa] learning: watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [learning: 通知] learning: 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [learning: de] learning: dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [learning: he] learning: headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断（来源: area）
- [learning: 毕业] learning: 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失（来源: area）
- [learning: 合同] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [learning: ma] learning: manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [learning: [] learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测（来源: area）
- [learning: [] learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的（来源: area）
- [learning: [] learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测（来源: area）
- [learning: th] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area）
- [learning: ta] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）
- [learning: Br] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [learning: [] learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工（来源: area）
- [learning: [] learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m（来源: area）
- [learning: [] learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [learning: jo] learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [learning: ha] learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 （来源: area）
- [learning: co] learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [learning: he] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub （来源: area）
- [learning: [] learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [learning: [] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [learning: [] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [learning: [] learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [多设备类型(os_typ] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性扫描找同类'字段有但下游UI未接线'模式。（来源: area）
- [learning: [] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [learning: [] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [learning: [] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子（来源: area）
- [learning: [] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸（来源: area）
- [learning: [] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [learning: li] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [learning: Te] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [learning: Re] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [learning: 回归] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [learning: 新增] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [learning: ha] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [learning: he] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD（来源: area）
- [learning: Pr] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area）
- [learning: 给 ] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享（来源: area）
- [learning: PR] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [learning: [] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [learning: [] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re（来源: area）
- [learning: [] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [learning: [] learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator（来源: area）
- [learning: [] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [单 slot 串行任务，] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出，但动手写代码的实现者同一时刻永远只有一个（与 subagent-driven 的禁并行实现者规则一致，防多写手改冲同一文件）。分水岭不是 agent 数量，是任务状态数量：一个会话里只允许存在一个任务的状态。（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：在指定 Draft PR #4457 最终 head 上真跑四项 focused regression、Engine/Brain/PR-tier CI、
# atomic 与 manual cutover gate；四项 blocker 均给出预期结果，0/99 与 gate 非零保持诚实，
# PR 仍为 Draft、auto-merge 为空，且未访问生产 Brain/cecelia、未修改生产 migration SQL。
```

## journey_type: autonomous
## journey_type_reason: 变更集中在 Cecelia Engine、Brain 后端测试与 CI 验证，无用户界面路径。
## target_environment: local_api
## target_environment_reason: payload 明确指定 local_api，后端测试与本地 PostgreSQL/runner 在 evaluator 本机执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
