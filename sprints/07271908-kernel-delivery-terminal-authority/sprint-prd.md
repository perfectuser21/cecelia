# Sprint PRD — Kernel Delivery Terminal Authority

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%，消除 Merge 后假完成，补齐交付闭环可证明性

## 背景

生产实证 main@087c7fa / Brain v1.267.92 暴露 Kernel 在 merge 后 enqueue staging_e2e 后立即把 initiative_run 标 done、parent task 标 completed；PR#4327 run 4cafe606 与 PR#4317 run e9ef9dde 的 parent 均已 completed，但 staging child 仍 queued 且无 staging result。当前 staging_e2e_results 为 24 SKIP、1 FAIL、0 PASS、0 promoted，缺少 S10 PASS→S11 promoted 的闭环证明。

本 sprint 收归 Merge 后 S10-S12 的交付终态权：Staging、Prod、最终报告全部完成后才允许 parent Complete。

## Golden Path（核心场景）

用户/系统从 PR merge 完成 → 进入同一可回放 delivery 状态机 → 到达 verified production 或 verified external attestation 加 final report 后的 parent Complete。

具体：
1. Merge 完成后，parent run/task 进入 delivery/staging_pending，不得 done/completed；staging child 绑定 run_id、task_id、PR URL、merged/head SHA、contract manifest digest、target environment。
2. Staging PASS 且 tested_sha 精确等于 merged_sha 后，系统才允许进入 promote；FAIL/SKIP/no_contract/tested_sha 缺失或不匹配均 fail-closed，并回传 parent 为非成功或可恢复阻断状态。
3. Internal production promote 绑定 exact tested SHA；部署后 health、fingerprint、E2E 任一失败，delivery 保留 failed/rollback_required 与可执行 rollback anchor，不得 promoted。
4. Customer line 的人工 confirm 只产生 pending external deployment acknowledgement；必须收到客户 repo 签名 deployment/verification attestation 后才可 promoted，Promote API 必须认证 approver。
5. S12 成功/失败 delivery report、handoff、learning、OKR/commitment map 全部绑定同一 delivery id；final report persisted 后，唯一 completion gate 原子标 parent run/task complete。

## 边界情况

- PR#4327/#4317 parent done + staging queued 只读快照作为 fixture 必须 FAIL，不修改历史生产行。
- staging SKIP(no_contract)、staging FAIL、child completed+executor success 均不得被当作交付成功。
- tested_sha 缺失或不等于 merged_sha 必须 fail-closed。
- HK/终验失败必须进入 rollback/failed，不能 promoted。
- customer 仅 confirm、无 deployment attestation 不得 promoted。
- report dispatch 失败不得 parent complete。
- 全链重放不得生成重复 staging/promote/report 记录，callback/promotion/report 重试必须幂等、可恢复、append-only。

## 范围限定

**在范围内**：Merge→Staging E2E→Production promote/attestation→Final Report/Learning→parent Complete 的单一 delivery terminal authority；PR#4327/#4317 只读回归 fixture；Promote API approver 认证；internal 与 customer 两类 production 终态判定。

**不在范围内**：修改历史生产行；修改、复用或合并 PR #4372；绕过本 Kernel Run；把 staging child 的 executor success 直接映射为 parent success。

## 假设

- [ASSUMPTION: OKR API 未返回 KR 编号，按活跃 OKR 顺序锚定为 KR-2。]
- [ASSUMPTION: 本 sprint 是 Brain/Kernel 纯后端状态机修复，target_environment 采用 payload 显式值 local_api。]

## 预期受影响文件

- `packages/brain/src/orchestrator/kernel-handlers.js`: merge 后 delivery 状态机与 parent completion gate。
- `packages/brain/src/routes/*harness*`: promote、attestation、report callback 的认证、幂等与状态回传。
- `packages/brain/src/**/*staging*`: staging result、contract digest、tested_sha/merged_sha 精确匹配。
- `packages/brain/tests/**`: PR#4327/#4317 fixture、SKIP/FAIL/fail-closed/rollback/report dispatch/重放回归。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: harness task timeout_seconds=43200；交付状态机需可恢复重试，不以单次进程退出作为成功。
- 频控: callback/promotion/report 重试幂等，重复回放不得新增重复 staging/promote/report。
- 版本要求: 生产证据基线 main@087c7fa / Brain v1.267.92；实现不得修改历史生产行。
- 可观测: 每个 delivery id 必须可追踪 staging、promote/attestation、final report、handoff、learning、OKR/commitment map。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [铁律01] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [铁律02] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [铁律03] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [铁律04] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断（来源: area）
- [铁律05] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失（来源: area）
- [铁律06] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [铁律07] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [铁律08] smoke 铁律（来源: area）
- [铁律09] smoke 铁律（来源: area）
- [铁律10] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测（来源: area）
- [铁律11] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的（来源: area）
- [铁律12] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测（来源: area）
- [铁律13] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area）
- [铁律14] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）
- [铁律15] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [铁律16] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工（来源: area）
- [铁律17] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m（来源: area）
- [铁律18] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（来源: area）
- [铁律19] smoke 铁律（来源: area）
- [铁律20] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [铁律21] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 （来源: area）
- [铁律22] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [铁律23] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub （来源: area）
- [铁律24] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [铁律25] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [铁律26] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [铁律27] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [铁律28] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性扫描找同类'字段有但下游UI未接线'模式。（来源: area）
- [铁律29] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [铁律30] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [铁律31] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子（来源: area）
- [铁律32] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸（来源: area）
- [铁律33] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [铁律34] lint-test-quality 要求 await fn() ≥ 1：读源码必须包装 async function，不能直接 readFileSync（来源: area）
- [铁律35] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [铁律36] Red commit 必须只 git add 精确路径（*.test.ts），禁止 git add . 或 git add .harness/，防非测试文件混入（来源: area）
- [铁律37] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [铁律38] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [铁律39] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [铁律40] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD（来源: area）
- [铁律41] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area）
- [铁律42] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享（来源: area）
- [铁律43] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合（来源: area）
- [铁律44] smoke 铁律（来源: area）
- [铁律45] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [铁律46] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re（来源: area）
- [铁律47] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [铁律48] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator（来源: area）
- [铁律49] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE（来源: area）
- [铁律50] smoke 铁律（来源: area）
- [铁律51] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出，但动手写代码的实现者同一时刻永远只有一个（与 subagent-driven 的禁并行实现者规则一致，防多写手改冲同一文件）。分水岭不是 agent 数量，是任务状态数量：一个会话里只允许存在一个任务的状态。（来源: area）
- [铁律52] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [铁律53] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [铁律54] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [铁律55] secrets 不硬编码、不进 git、不进日志（来源: area）
- [铁律56] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [铁律57] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [铁律58] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿框定端到端验收到什么；最终可执行脚本由 proposer 按 local_api 生成。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本。
# 期望验收点：
# 1. PR#4327/#4317 parent completed + staging queued fixture 在新合同下 FAIL。
# 2. Merge 后 parent 不 complete，必须等待 S10 staging PASS 且 tested_sha == merged_sha。
# 3. staging SKIP(no_contract)、staging FAIL、tested_sha 缺失/不匹配均 fail-closed 并回传 parent。
# 4. internal promote 失败保留 rollback/failed anchor；customer confirm 无签名 attestation 不得 promoted。
# 5. final report dispatch 失败不得 parent complete；成功 report persisted 后唯一 gate 原子 complete。
# 6. 重放 callback/promotion/report 不产生重复 staging/promote/report。
```

## journey_type: autonomous
## journey_type_reason: thin_prd 指向 Kernel/Brain 交付状态机，无 UI、agent remote 或 engine hook 范围。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api，E2E 在本地 Brain API/DB 验证。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: a6888ef3-2482-4655-8703-cf3b9f037cb9
