# Sprint PRD — Kernel durable resume：跨 run 去重与恢复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：形成 1 个可验收的 Kernel 恢复正确性增量；百分比由 Brain 在交付后核算

## 背景

同一任务的 4 个 initiative_runs 合并统计出现 Planner 4、Reviewer 5、Generator 9。后续 run 未完整继承已批准合同、已确认 PRD/PR、回调与失败历史，导致恢复时重复派发角色。本 sprint 是独立 Kernel Harness hotfix，只修跨 run 恢复与去重，不创建第二账本。

## Golden Path（核心场景）

Kernel durable resume：跨 run 去重与恢复的核心路径是：同一 initiative/task 创建后续 run 或 Brain 重启 → Kernel 从结构化持久化真相恢复最新里程碑与原 attempt → 仅派发尚未完成且允许重试的下一角色 → 到达继续执行、等待人工复审或结构化失败的唯一出口。

具体：
1. 同一 initiative/task 启动后续 run 时，系统在事务中继承最新 approved contract 的 id、version、branch；derive 可观察到合同已批准，不再派发 proposer 或 reviewer。
2. 系统单调恢复已确认的 PRD、PR 与合同里程碑；较新的 run 不得把已确认状态降级，也不得从 Agent 自然语言推测状态。
3. 遇到 expired lease 或 orphan running 时，系统优先 reclaim 并 resume 原 attempt；存在 provider session 时不得创建新 attempt。
4. 原 attempt 不存在 provider session 时，系统先结构化终结该 attempt，再依据 DB 与 GitHub 真相推导下一状态。
5. 同一结构化失败根因签名跨 run 再现时，系统不得再次派发 generator，按既有不变量进入 `wait:human_review` 或 `FAILED`。
6. 两次 run、Brain restart、orphan running 与跨 run 同签名回归均通过，且只使用 `initiative_contracts`、`harness_attempts`、`orchestrator_decision_log` 作为既有真相来源。

## 边界情况

- 后续 run 读取到多份合同记录时，只继承最新 approved 版本及其一致的 branch。
- expired lease 同时有存活 provider session 时，只恢复原 attempt；无 session 时必须先留下结构化终态。
- DB 与 GitHub 真相不完整或冲突时不得猜测成功，保持可审计的等待或失败状态。
- 同一根因签名重现时，即使 run id 不同，也不得绕过去重再次派发 generator。
- Brain 在关键里程碑之间重启后，恢复结果必须与不中断执行的结果一致。

## 范围限定

**在范围内**：harness-skill-relay run bootstrap；approved contract 跨 run 继承；PRD/PR/合同里程碑单调恢复；expired lease 与 orphan attempt 恢复；跨 run 结构化根因去重；contract-store、ground-truth、reconcile、counters；真实两 run 与 Brain restart 回归；Brain 定义与版本账本同步。

**不在范围内**：provider capability 扩展；metrics UI；第二账本；生产数据库写入；自动 merge；弱化、删除或改写既有合同测试。

## 假设

- [ASSUMPTION: task payload 未提供 thin_prd；本 PRD 以 task API 返回的 description 作为 PrepPRD 范围锚点。]
- [ASSUMPTION: task payload 未提供 ability_id，Journey golden paths 返回空数组，因此本 sprint 暂无可解析的 step_id。]
- [ASSUMPTION: OKR context 未返回 KR 编号与本次百分比增量，采用活跃的“Cecelia 基础稳固”作为对齐项，交付后由 Brain 核算百分比。]
- [ASSUMPTION: 结构化根因签名、`wait:human_review` 与 `FAILED` 的选择沿用现有 Kernel 不变量，不在本 sprint 重定义。]

## 预期受影响文件

- `packages/brain/src/`：harness-skill-relay run bootstrap、contract-store、ground-truth、reconcile、counters 的既有实现位置
- `packages/brain/DEFINITION.md`：Brain 源码变化对应的定义版本
- `packages/brain/` 内现有四处版本账本：按仓库既有规则同步版本
- 现有 Kernel Harness 测试目录：新增两 run、Brain restart、orphan running、跨 run 同签名回归，不改写既有合同测试

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 一致性：approved contract 继承与 run bootstrap 必须在同一事务边界完成。
- 幂等性：同一 initiative/task 与同一结构化根因跨 run 重放不得增加重复角色派发。
- 可恢复性：Brain restart、expired lease、orphan running 后必须从结构化 DB/GitHub 真相恢复。
- 可观测性：attempt 终结、reclaim/resume、去重与等待/失败出口均保留结构化证据。
- 安全性：不得写生产数据库，不得自动 merge，PR 保持 OPEN 等待独立复审。
- 兼容性：不得削弱既有合同测试；Brain 源码变化同步 DEFINITION.md 与四处版本账本。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本任务 step/feature 为空，area 共 58 条 -->
- [区域1] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [区域2] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [区域3] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [区域4] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断裂）（来源: area）
- [区域5] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失效）（来源: area）
- [区域6] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [区域7] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [区域8] smoke 铁律（来源: area）
- [区域9] smoke 铁律（来源: area）
- [区域10] 测试如果全部依赖“重置状态=冷启动”的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条“真实多轮扫描、状态不重置、时间真实流逝”的集成测试，否则这类“跨扫描周期”的 bug 永远测不出来（来源: area）
- [区域11] 涉及“周期性重新扫描同一批数据”的设计，一旦引入外部付费调用（LLM/第三方 API），必须同时设计“是否已处理过”的前置检查，不能假设“重扫不常发生”就不用防——扩大扫描窗口反而可能放大另一个隐藏问题（来源: area）
- [区域12] 跨模块的“时间常数”（扫描间隔、闲置阈值、缓存 TTL 等）如果有隐含大小关系，必须在设计阶段显式写不变量断言或注释，不能指望单任务测试覆盖跨任务接缝（来源: area）
- [区域13] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明内也会触发环境不匹配警告；agent-offline-alert 后端服务可使用 windows_cloud（来源: area）
- [区域14] target_environment 由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取；注册 task 时必须正确设置，否则 harness 会用错环境路由（来源: area）
- [区域15] Brain judge API 必须有顶层 exit_code、log_tail、behavior_tests[]，每条 behavior test 也需 exit_code 与 log_tail（来源: area）
- [区域16] DB 表字段有长度约束且来源数据无天然长度保证时，写入前必须显式截断，不能假设路径等数据不会过长（来源: area）
- [区域17] 复活或重做退役功能前，先从 Git 历史读取退役前真实代码并逐字核对 death cause，不只信退役 commit message（来源: area）
- [区域18] 调用以 null/false 表示失败而不抛异常的函数时，成功分支之外必须显式处理失败分支，不能只依赖外层 try/catch（来源: area）
- [区域19] smoke 铁律（来源: area）
- [区域20] journey_features.updated_at 长期早于对应 PR 合并时间，可作为 report 阶段漏跑的兜底探针，需定期巡检（来源: area）
- [区域21] Brain 不得仅凭 harness-controller relay 容器 exit code 0 判定完成，必须校验 pr_merged_at、notion_synced_at 等 report 产物（来源: area）
- [区域22] contract-proposer 起草 host/环境白名单断言时必须核对 headed 人工接管场景（来源: area）
- [区域23] headed relay 点火必须在 task payload 写 base_repo 或 pr_url，且分支名带 task short id，避免收账守卫与 GitHub 反查失明（来源: area）
- [区域24] 退役判断必须依赖结构化生产真相与消费方证据，不靠记忆，避免误删同名但仍活跃的模块（来源: area）
- [区域25] catch 吞错的后台 job 必须有失败计数，连续失败超过阈值必须告警（来源: area）
- [区域26] 建新表或复用表前必须核对全部写入方；两个模块写同一表必须做 schema 对齐评审（来源: area）
- [区域27] 新增后台 job 必须同时声明真实消费方，无下游读方的落库 job 不允许上线（来源: area）
- [区域28] 新字段与既有字段语义重叠时必须在本 sprint 消解或建立正式 decision 与队列任务；涉及多个设备或系统类型时，合同与验收必须覆盖展示层区分（来源: area）
- [区域29] 同一语义在判变端与终验端必须采用同一处理策略，禁止跨脚本语义分叉造成假绿（来源: area）
- [区域30] `git rev-parse` 判断 ref 存在必须使用 `--verify "<ref>^{commit}"`（来源: area）
- [区域31] smoke/测试使用真实 worktree 作为部署根时，必须核对被测脚本是否触碰共享或生产资源，并显式列出所有跳过钩子（来源: area）
- [区域32] 部署链任何失败路径不得 warning 降级，必须显式记录失败、告警并非零退出（来源: area）
- [区域33] 判变基准必须用生产实体自报版本对账 origin/main，禁止以部署工作区 diff 作为真相（来源: area）
- [区域34] lint-test-quality 要求 await fn() ≥ 1：读源码必须包装 async function，不能直接 readFileSync（来源: area）
- [区域35] Test Contract 表格固定 4 列，testFile 用反引号包裹，检查器从第 3 列解析路径（来源: area）
- [区域36] Red commit 必须只 git add 精确测试路径，禁止 git add . 或 git add .harness/，防止非测试文件混入（来源: area）
- [区域37] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [区域38] 新增 cron 功能先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [区域39] generator 禁止自行 merge PR；merge 权归 controller，generator 只推 branch 并报告 ready（来源: area）
- [区域40] headed relay 的 tmux innerCmd 子 shell 不自动继承父进程环境；session 所需 harness 变量必须在 innerCmd 显式 export（来源: area）
- [区域41] Proposer 复用历史合同模板前必须核对本次真实派发与执行历史，不得假设与先例路径相同（来源: area）
- [区域42] 共享 CI 基础设施文件默认禁改，未经合同显式授权不可修改；自身改动触发相关 CI 红时另开 sprint 走 GAN（来源: area）
- [区域43] PR 若在 evaluator/judge 完成前被 CI 兜底机制提前合并，必须以 PR head SHA 核对 verdict 锚定 SHA 与实际合并 SHA 一致（来源: area）
- [区域44] smoke 铁律（来源: area）
- [区域45] feat 且涉及 brain/src 的 PR 开出前必须同时带齐 smoke.sh 与 smoke-allowlist 登记（来源: area）
- [区域46] 新 task_type 接线必须覆盖 CHECK 约束、task-router 四表、EXECUTOR_KIND_FOR、executor dispatch、override 排除、relay loadSkill 映射与 dispatcher 三防线（来源: area）
- [区域47] 服务存活判定必须使用 launchctl 状态与端口监听双信号（来源: area）
- [区域48] 美国 Mac mini 禁止把常驻服务放入用户 LaunchAgents；使用系统域 LaunchDaemon 并指定用户（来源: area）
- [区域49] 新增常驻宿主服务必须同步加入 launchd-patrol 的运行、加载与监听 manifest（来源: area）
- [区域50] smoke 铁律（来源: area）
- [区域51] 一个 slot 内任务严格串行；任务内部只读子代理可并行，但同时只能有一个写代码实现者（来源: area）
- [区域52] 环境假设值禁止写死，必须从环境推导或在真机校准（来源: area）
- [区域53] 依赖真机、生产环境或真实调用方的接缝断言必须在目标环境验证后才算 done（来源: area）
- [区域54] 单元与 E2E 测试默认使用至少两个租户并断言互不串扰（来源: area）
- [区域55] secrets 不硬编码、不进 git、不进日志（来源: area）
- [区域56] 客户隐私、PII、聊天内容不得明文进入日志（来源: area）
- [区域57] 每个 API 端点必须有鉴权，无鉴权端点不得交付（来源: area）
- [区域58] 涉及租户数据的查询与写入必须限定当前租户，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

> Proposer 将以下验收点翻译为 local_api 可执行脚本；所有场景只使用隔离测试数据，不执行生产数据库写入。

```bash
# 场景 1：同一 initiative/task 连续启动两个 run，第二个 run 继承最新 approved contract 的 id/version/branch，proposer 与 reviewer 派发计数不增加。
# 场景 2：在已确认 PRD、PR、合同三个里程碑分别重启 Brain，恢复后的里程碑不降级，下一角色与不中断基线一致。
# 场景 3：制造 expired lease 与 orphan running；有 provider session 时恢复原 attempt 且无新 attempt，无 session 时原 attempt 先结构化终结再推导。
# 场景 4：让同一结构化失败根因签名跨两个 run 重现，generator 派发计数不增加，出口为 wait:human_review 或 FAILED。
# 场景 5：断言全过程仅复用 initiative_contracts、harness_attempts、orchestrator_decision_log，且现有合同测试与新增回归池全部通过。
```

## journey_type: autonomous
## journey_type_reason: 变更锚定 Cecelia Brain 的 Kernel Harness 后端恢复与调度，不含 UI、远端 agent 协议或 Engine 流程。
## target_environment: local_api
## target_environment_reason: 目标是本地 Brain API 与隔离测试数据库上的纯后端 Kernel 回归。
## journey_id: 741d4acc-9ca8-4545-a971-efa12fce8150
## step_id: none（PrepPRD 未锚定）
