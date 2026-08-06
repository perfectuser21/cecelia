# Sprint PRD — playground 加 GET /ping endpoint（harness relay 链路 smoke）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（relay 编排链路 smoke 跑通一次完整闭环）

## 背景

本任务为 harness relay 链路 smoke 验证（orchestrator=skill-relay, mode=headed, executor=claude, smoke_tag=codex-headed-dispatch-local-31259-31509）。目标：让 planner→GAN→generator→evaluator→judge→merge→report 整条链在真实环境跑通一次，产品产物取 thin-slice 最小化——playground 新增一个 `GET /ping` endpoint（当前 playground 已有 /sum、/multiply、/divide、/power、/modulo、/factorial、/increment、/decrement、/abs、/sign、/subtract、/echo、/health，尚无 /ping）。

## Golden Path（核心场景）

调用方从 [请求 playground /ping] → 经过 [playground server 路由处理] → 到达 [收到 pong 响应]

具体：
1. 调用方对已启动的 playground server 发起 `GET /ping`（无参数）
2. playground server 处理该请求
3. 调用方收到 HTTP 200，响应体为 JSON `{"pong": true}`（字段名 `pong` 字面锁死，禁止改成 `ping` / `alive` / `ok` / `status` / `result`）

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- `GET /ping` 携带任意 query 参数 → 忽略参数，仍返回 200 `{"pong": true}`
- 对 `/ping` 使用非 GET 方法（如 POST）→ 返回 Express 默认 404（不注册其他方法）

## 范围限定

**在范围内**：`playground/server.js` 新增 `GET /ping` 路由 + 对应单测文件；本 sprint 走完 relay 全链（GAN→TDD 两次 commit→evaluate→judge→merge→report）。
**不在范围内**：Brain（packages/brain）、engine、dashboard 任何改动；playground 其他既有端点改动；新增依赖。

## 假设

- [ASSUMPTION: task payload 无 thin_prd / prep_prd_body，scope 由 smoke 任务性质锚定——取 playground 未实现的最小端点 /ping 作为可验证产物（对齐 harness-planner 正例）]
- [ASSUMPTION: 本 sprint 为 smoke 验证，非真实产品新功能，evaluator PASS 后可自动 merge（review_required=false）]

## 预期受影响文件

- `playground/server.js`: 新增 `GET /ping` 路由
- `playground/tests/ping.test.js`: 新增单测（TDD commit 1 = Red）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；本 task step 级 nfr=[]，ability_id=null 无 feature 级 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: （空）
- 可观测: （空）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本 task step=[] feature=[]，area 级 69 条全量注入 -->
- [本机（美国 Mac mini）**禁止再] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=adminis（来源: area）
- [contract-dod.md/测试里涉] contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点 contract-dod.md/测试里涉（来源: area）
- [给 harness-generator ] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨（来源: area）
- [同一语义（如 git_sha=unkno] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [Test Contract 表格固定 4] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Test Contract 表格固定 4 列格式，testFile 用 backtic（来源: area）
- [表名认领冲突：建新表/复用表前先 gre] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [新增后台 job 必须同时声明消费方——] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者） [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许（来源: area）
- [PR 被 should-auto-mer] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定（来源: area）
- [`git rev-parse` 判 re] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量 [ ] `git rev-parse` 判 ref 存在必须带 `-（来源: area）
- [smoke-invariant-1784] smoke 铁律（来源: area）
- [服务"该活着"的判定用双信号：launc] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a） [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端（来源: area）
- [headed relay 点火时必须把 ] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchd（来源: area）
- [跨模块的"时间常数"（扫描间隔、闲置阈值] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"）（来源: area）
- [evaluator 临时脚本必须落会话独] evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证导致首跑 FAIL evaluator 临时脚本必须落会话独享路径（含 sess（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [feat+brain/src PR 开 ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红 [ ] feat+brain/src PR 开 PR 前直接一次带齐 smok（来源: area）
- [headed relay session] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状（来源: area）
- [catch 吞错的后台 job 必须带失] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖（来源: area）
- [dep-audit 因新披露 advis] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单 dep-audit 因新披露 ad（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [毕业（测试入册）commit 后必须本地] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效（来源: area）
- [smoke-invariant-1783] smoke 铁律（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [smoke-invariant-1783] smoke 铁律（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [新增 cron 功能首先检查 sched] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tic（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [watchdog 对『从未启动的进程』必] watchdog 对『从未启动的进程』必须走 never_started 分类兜底且不覆盖已有 error_message/failure_class，防止 process_disappeared→liveness_de（来源: area）
- [判变基准永远用"生产实体自报"（buil] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱 [ ] 判变（来源: area）
- [通知/写库接口的成功判定必须看语义字段（] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证） 通知/写库接口的成功判定必须看语义字段（s（来源: area）
- [journey_features 表的 ] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检 journey_features 表的 updated_a（来源: area）
- [新 task_type 接线用七点清单：] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [smoke-invariant-1784] smoke 铁律（来源: area）
- [watchdog_overdue 标 f] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功） watc（来源: area）
- [lint-test-quality 要求] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync lint-test-quality 要求 await fn() ≥（来源: area）
- [smoke/测试用真实 worktree] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——S（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）
- [复活/重做一个曾经死过的功能前，先用 `] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 co（来源: area）
- [PR 处于 CONFLICTING 状态] PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge main 解冲突再等 CI PR 处于 CONFLICTING 状态时 Git（来源: area）
- [headed relay 的 tmux ] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、H（来源: area）
- [Red commit 必須只 git a] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入 Red commit 必須只 git add 精確路徑（*（来源: area）
- [单 slot 串行任务，并行只许跨 sl] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个（来源: area）
- [守卫/探针自产数据用共享常量前缀（如 L] 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计（来源: area）
- [capture_atoms urgent] capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 open 任务时合并而非裂变新单（实证：a6e6afc7 与 78e812c0 同 m7 探针双修复撞车，合流成本 5 轮 CI（来源: area）
- [Proposer 复用历史合同模板（尤其] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例（来源: area）
- [多设备类型(os_type/device] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-re（来源: area）
- [部署链任何失败路径禁止 warning ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefai（来源: area）
- [contract-proposer 起草] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN contract-proposer （来源: area）
- [smoke-invariant-1784] smoke 铁律（来源: area）
- [新增常驻宿主服务时，必须同步加进 `pa] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST（来源: area）
- [测试如果全部依赖"重置状态=冷启动"的写] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 b（来源: area）
- [theater_mismatch 检查—] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 window（来源: area）
- [回归测试用 source-code in] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [relay 单session 模式必须在] relay 单session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写 node 级 done 事件并推进 run.phase，否则 finalize（来源: area）
- [探针类时间窗口用确定性日历窗口（自然日+] 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行（来源: area）
- [DB 表字段长度约束（如 `varcha] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者（来源: area）
- [manual:node -e 双引号中的] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。 manual:node -e 双引号中的 Ja（来源: area）
- [cortex.js::recordLea] cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层（来源: area）
- [Brain judge .brain-r] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式（来源: area）
- [涉及"周期性重新扫描同一批数据"的设计，] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本（来源: area）
- [proposer起草涉及agents表字] proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈） proposer起草涉及agents表（来源: area）
- [harness-generator 需新] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready harn（来源: area）
- [harness-controller r] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 ex（来源: area）
- [调用任何"失败不抛异常，返回 null/] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在（来源: area）
- [退役判断依据数据不靠记忆：本次靠查生产库] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留） [ ] 退役判断依据数（来源: area）
- [合同批准前必须同时记录 manual o] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [冒烟/校验类脚本涉及数据库连接目标时，写] 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 （来源: area）
- [target_environment 从] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payloa（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journeys/bb8cc561 golden-paths 返回空数组 -->
- （本 line 暂无历史）

## E2E 验收

> 占位：最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=playground 产出，写入 contract-draft.md。

```bash
# 占位：proposer 将填入真实脚本（playground → 本地启 node playground/server.js 后 curl 自测自己的端口）
# 期望验收点（自然语言）：
#   1. 启动 playground server（PLAYGROUND_PORT 独立端口，如 3001）
#   2. curl localhost:$PLAYGROUND_PORT/ping 返回 HTTP 200 且响应体 .pong == true
#   3. 携带任意 query 参数仍返回 200 {"pong": true}
#   4. playground 单测全绿（含新增 ping.test.js）
# 禁止：e2e 中出现任何 Brain URL（localhost:5221 / /api/brain/*）
```

## journey_type: autonomous
## journey_type_reason: 只动 playground 独立 HTTP server 子项目（路由+单测），无 UI / 无 engine hook / 无远端 agent 协议，按 if-elif 链落默认 autonomous（与 W19~W26 同分类）
## target_environment: playground
## target_environment_reason: smoke 训练 sprint 且产物在 playground（本地 node playground/server.js 起服自测，playground 优先判规则命中）
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
