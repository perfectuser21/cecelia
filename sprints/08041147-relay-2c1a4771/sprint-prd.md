# Sprint PRD — watchdog liveness 探针「从未启动任务」误判 liveness_dead 修复（防复发）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：83%（失败分类保真，urgent 学习流不再被假根因污染）

## 背景

任务 1dfa40f7「feat(kernel): 案卷式 GAN 收敛机制」被 watchdog 以 liveness_dead 杀死并产出紧急 failure learning。诊断证据链（Brain DB 实查）：该任务 started_at=null、execution_attempts=0、watchdog_kill.pid=null、log_tail="Log file not found or empty"——进程**从未启动**；真实根因是任务缺 payload.anchor，被 S2 锚点执法拒绝点火（error_message="S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火"，payload.failure_class=missing_anchor）。watchdog 的 checkExitReason 兜底把「从未存在的进程」判成 process_disappeared → liveness_dead，导致 capture_atoms urgent 路由带着假标签（liveness_dead）而非真根因（missing_anchor/never_started）生成学习任务，浪费一整条紧急诊断链。

## Golden Path（核心场景）

系统从 [一个 dev 任务从未点火成功（pid=null 且无进程日志且 started_at 为空）] → 经过 [watchdog liveness 探针巡检] → 到达 [失败分类保真：判为 never_started（非 liveness_dead），下游 failure learning 文本携带真实根因]

具体：
1. [触发条件] 任务被 S2 锚点执法拒绝点火（或其他派发前失败），进程从未启动：pid=null、无进程日志、started_at=null
2. [系统处理] watchdog liveness 探针（executor.js checkExitReason 链路）识别「从未启动」特征，分类为 never_started，不再落入 process_disappeared/liveness_dead 兜底；已有的 error_message / payload.failure_class（如 missing_anchor）不被覆盖
3. [可观测结果] 该任务的 watchdog_kill.reason 为 never_started；由此产生的 failure learning / capture atom 文本含真实根因标签（never_started 或已有 failure_class），不再出现 liveness_dead 假标签

## 边界情况

- pid=null 但任务确实曾启动（有进程日志/started_at 非空）→ 仍走既有 process_disappeared 判定，不误改
- 任务已有 error_message（点火拒绝原因）→ watchdog 记账不得覆盖该字段
- 真正的进程中途消失（曾有 pid、日志存在）→ 分类行为与现状完全一致（回归保护）

## 范围限定

**在范围内**：watchdog liveness 探针对「从未启动任务」的分类修复；能复现本次误判的 failing test 先行 + 永久回归测试入 CI
**不在范围内**：原任务 1dfa40f7 的补锚与重跑（需人工承诺地图坐标）；S2 锚点豁免名单调整；案卷式 GAN 收敛机制本身；capture_atoms 路由逻辑改动

## 假设

- [ASSUMPTION: 「从未启动」可由 pid=null ∧ 无进程日志 ∧ (started_at=null ∨ 已有派发失败 error_message) 联合判定，无需新增 DB 字段]
- [ASSUMPTION: never_started 作为新 reason 枚举值不破坏下游 dev-failure-classifier 的既有分类消费（新增值需全仓库 grep 复查枚举硬编码断言）]

## 预期受影响文件

- `packages/brain/src/executor.js`: checkExitReason / liveness 探针兜底分类逻辑
- `packages/brain/src/dev-failure-classifier.js`: 若消费 reason 枚举需识别 never_started
- `packages/brain/src/__tests__/`: 新增复现 1dfa40f7 场景的回归测试（pid=null+无日志+未启动 → never_started）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 两源均为空数组），PrepPRD 无（payload 无 thin_prd） -->
- 可观测: 失败分类结果必须落 watchdog_kill.reason 字段，可由 Brain DB 直查验证
- 其余（超时/频控/版本）: 待定（PrepPRD 未指定，decisions 无值）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(0)+journey_feature(0)+area(58) 三源合并去重 -->
- [cortex.js:] cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层（来源: area）
- [冒烟/校验类脚本涉及] 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染（来源: area）
- [proposer起草] proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈）（来源: area）
- [contract-d] contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点（来源: area）
- [watchdog_o] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [通知/写库接口的成功] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [dep-audit ] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [headed rel] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状（来源: area）
- [毕业（测试入册）co] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效（来源: area）
- [合同批准前必须同时记] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [manual:nod] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [smoke 铁律] smoke 铁律（来源: area）
- [测试如果全部依赖"重] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 b（来源: area）
- [涉及"周期性重新扫描] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本（来源: area）
- [跨模块的"时间常数"] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"）（来源: area）
- [theater_mi] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 window（来源: area）
- [target_env] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payloa（来源: area）
- [Brain judg] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式（来源: area）
- [DB 表字段长度约束] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者（来源: area）
- [复活/重做一个曾经死] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 co（来源: area）
- [调用任何"失败不抛异] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在（来源: area）
- [journey_fe] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [harness-co] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 ex（来源: area）
- [contract-p] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [headed rel] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchd（来源: area）
- [退役判断依据数据不靠] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [catch 吞错的后] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [表名认领冲突：建新表] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [新增后台 job 必] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [1) contrac] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-re（来源: area）
- [同一语义（如 git] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [`git rev-p] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [smoke/测试用真] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——S（来源: area）
- [部署链任何失败路径禁] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefai（来源: area）
- [判变基准永远用"生产] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [lint-test-] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [Test Contr] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [Red commit] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [回归测试用 sour] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [新增 cron 功能] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [harness-ge] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [headed rel] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、H（来源: area）
- [Proposer 复] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例（来源: area）
- [给 harness-] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨（来源: area）
- [PR 被 shoul] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定（来源: area）
- [feat+brain] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [新 task_typ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排（来源: area）
- [服务"该活着"的判定] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [本机（美国 Mac ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=adminis（来源: area）
- [新增常驻宿主服务时，] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST（来源: area）
- [一个 slot/会话] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个（来源: area）
- [屏幕外坐标/UIA气] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [依赖真机/生产env] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [单元/E2E 测试默] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [secrets 不硬] secrets 不硬编码、不进 git、不进日志（来源: area）
- [客户隐私/PII/聊] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [每个 API 端点必] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [碰租户数据的查询/写] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: task.payload 无 journey_id（capture_atoms urgent 路由，非路径 C 点火），优雅降级 -->
- （本 line 暂无历史）

## E2E 验收

> 最终可执行 E2E 脚本由 proposer 按 target_environment=local_api 产出（curl localhost:5221 + psql/单测）。

```bash
# 占位：proposer 将填入真实脚本
# 期望验收点（自然语言）：构造一个 pid=null、无进程日志、started_at=null 的失败探针场景，
# watchdog 分类结果为 never_started（非 liveness_dead/process_disappeared）；已有 error_message 未被覆盖；
# 曾启动过的进程消失场景仍判 process_disappeared（回归不变）；回归测试进 CI 永久保留。
```

## journey_type: autonomous
## journey_type_reason: 改动仅在 packages/brain/（watchdog/executor 后端逻辑），无 UI/engine/agent 协议
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端，本地 evaluator 用 curl localhost:5221 + 单测/psql 验证
## journey_id: none
## step_id: none（PrepPRD 未锚定）
