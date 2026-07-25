# Sprint PRD — Kernel v1 GPT-5.5 全 Agent lane4 canary

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%，用非破坏性 canary 验证 Kernel Harness GPT-5.5 角色路由可信度

## 背景

本 sprint 运行一条最小、非破坏性的 Kernel v1 GPT-5.5 canary，确认 planner、proposer、reviewer、generator、evaluator 五个 Agent 角色全部显式使用 provider=codex、account=team4、任务级 model=gpt-5.5，且每个角色都是 fresh session。唯一允许的产品交付文件是 `docs/fire-drills/kernel-v1-gpt55-team4-20260725.md`。

## Golden Path（核心场景）

系统从 Kernel Harness 派发 `[CANARY] Kernel v1 GPT-5.5 全 Agent lane4` → 经过五个 fresh session Agent 角色执行 → 到达 evaluator PASS、independent judge PASS、PR 可合并的出口。

具体：
1. Harness 读取 task payload，确认 `model=gpt-5.5`，五个 role assignment 均为 provider=codex、account=team4。
2. planner、proposer、reviewer、generator、evaluator 各自以 fresh session 完成接力，过程中不修改 packages/**、apps/**、scripts/**、配置、migration、测试基础设施或生产数据。
3. generator 只交付 `docs/fire-drills/kernel-v1-gpt55-team4-20260725.md`，记录 task id、run id、五个角色 provider/account、payload model、最终 evaluator/judge verdict 和 PR URL。
4. Brain harness_attempts 可观测到五种角色均出现 provider=codex/account_id=team4，CI 绿，evaluator PASS，independent judge PASS；Judge 仍使用现有 independent-judge/deepseek-v4-flash，不伪称 GPT-5.5。

## 边界情况

- 任一角色缺 attempt、provider/account 非 codex/team4、payload model 不是 gpt-5.5，均不得验收。
- PR diff 若包含产品代码、配置、migration、测试基础设施或生产数据变更，均不得验收。
- evaluator PASS 或 independent judge PASS 缺失、CI 未绿、PR URL 未写入交付文件，均不得验收。

## 范围限定

**在范围内**：Kernel Harness canary 接力验证；Brain harness_attempts 只读核验；唯一产品交付文件 `docs/fire-drills/kernel-v1-gpt55-team4-20260725.md`；sprint 合同/裁决留痕等 Harness 必需产物。

**不在范围内**：修改 packages/**、apps/**、scripts/**、配置、migration、测试基础设施、生产数据；改变 independent judge 模型；新增业务功能或 API。

## 假设

- [ASSUMPTION: 本任务无 journey_id/step_id 锚点，按 task payload 的 canary 描述锚定 scope。]
- [ASSUMPTION: harness_attempts 中 account 字段名在验收侧可映射到 account_id=team4。]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-gpt55-team4-20260725.md`: generator 唯一允许新增/修改的产品交付文件，记录 canary 证据。
- `sprints/07251630-kernel-gpt55-team4/sprint-prd.md`: planner 产出的 Harness 合同产物。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 单条最小 canary，不做重复压测
- 版本要求: 任务级显式 model=gpt-5.5；provider=codex；account=team4；Judge 保持 independent-judge/deepseek-v4-flash
- 可观测: 必须能从 Brain harness_attempts、交付文件、PR diff、CI/evaluator/judge verdict 交叉核验

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [本机美国Ma] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator（来源: area）
- [给harne] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享（来源: area）
- [同一语义如g] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [TestCo] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [表名认领冲突] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [新增后台jo] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [PR被sho] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合（来源: area）
- [gitrev] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [smoke] smoke 铁律（来源: area）
- [服务该活着的] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [headed] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub （来源: area）
- [跨模块的时间] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测（来源: area）
- [真环境验证才] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [smoke] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [headed] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断（来源: area）
- [catch吞] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [dep-au] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [毕业测试入册] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失（来源: area）
- [smoke] smoke 铁律（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [smoke] smoke 铁律（来源: area）
- [测试默认多租] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [新增cron] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [判变基准永远] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [通知写库接口] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [journe] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [新task_] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re（来源: area）
- [禁止写死环境] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [smoke] smoke 铁律（来源: area）
- [watchd] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [lint-t] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [smoke] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）
- [复活重做一个] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m（来源: area）
- [headed] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD（来源: area）
- [Redcom] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [单slot串] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven （来源: area）
- [Propos] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area）
- [1contr] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种（来源: area）
- [部署链任何失] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸（来源: area）
- [contra] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [smoke] smoke 铁律（来源: area）
- [新增常驻宿主] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE（来源: area）
- [测试如果全部] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测（来源: area）
- [theate] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android （来源: area）
- [回归测试用s] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [DB表字段长] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工（来源: area）
- [manual] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [Brainj] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [涉及周期性重] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的（来源: area）
- [harnes] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [harnes] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 （来源: area）
- [调用任何失败] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（来源: area）
- [退役判断依据] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [合同批准前必] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [target] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Proposer 将按 target_environment=local_api 填入真实脚本；本段先锁定必须可执行验证的端到端观察点。

```bash
# 占位：proposer 将填入 curl/psql/git/gh 组合脚本。
# 期望验收点：task 6449cebb-8f6f-4561-ba5f-350691bd6cec 的 harness_attempts 中 planner/proposer/reviewer/generator/evaluator 均为 provider=codex/account_id=team4；payload.model=gpt-5.5；docs/fire-drills/kernel-v1-gpt55-team4-20260725.md 存在且记录 run_id=ee037a92-8061-4729-a67b-cc9fc7d9db56、五角色、verdict、PR URL；PR diff 不含禁止路径；CI/evaluator/judge 全 PASS。
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 验证 Kernel Harness/Brain attempts 记录与后端裁决链，无 UI、agent bridge 或 engine hook 变更。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api，验收需在本地 Brain API、DB、git/CI 裁决链核验。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
