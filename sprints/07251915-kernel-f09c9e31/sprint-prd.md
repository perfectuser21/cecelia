# Sprint PRD — P1 Kernel durable resume：跨 run 去重与恢复

## OKR 对齐

- **对应 KR**：KR-未编号（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：83%

## 背景

同一任务的四个历史 run 合并后出现 Planner 4 次、Reviewer 5 次、Generator 9 次，说明新 run 没有完整恢复已批准合同、PRD、PR、回调与失败历史。本 sprint 以 **Kernel durable resume：跨 run 去重与恢复** 为唯一主题，修复独立 Kernel Harness hotfix，使后续 run 从结构化 DB/GitHub 真相单调恢复，而不是重复生成。

## Golden Path（核心场景）

同一 initiative/task 的后续 run 或 Brain restart 后恢复 → 继承合同与里程碑并复用原 attempt → 根据结构化真相继续到唯一合法出口。

具体：
1. 后续 run 启动时，在事务中取得最新 approved contract 的 id、version、branch，并恢复已确认的 PRD、PR、合同里程碑。
2. derive 观察到已批准合同后，不再派发 proposer 或 reviewer；已确认里程碑只能前进，不能回退或丢失。
3. 遇到 expired lease 或 orphan running 时，优先 reclaim 并 resume 原 attempt；有 provider session 时禁止创建新 attempt，无 session 时先结构化终结原 attempt，再从 DB/GitHub 真相推导下一步。
4. 同一结构化失败签名跨 run 再现时，不再派发 generator，按现有不变量进入 `wait:human_review` 或 `FAILED`。
5. 正常出口可观测到：合同与里程碑连续、原 attempt 被正确续接、Planner/Reviewer/Generator 不因跨 run 恢复而重复增加，并导出可供后续 Commander Phase 1/2 复用的稳定恢复原语。

## 边界情况

- 首个 run 尚无 approved contract 时，维持现有首次派发路径，不伪造恢复状态。
- 多个历史合同并存时，只继承同一 initiative/task 的最新 approved 版本，不读取其他任务状态。
- Brain 重启发生在合同批准、PR 确认、attempt 运行或回调写入之后时，恢复结果保持单调一致。
- provider session 存在与不存在两种 orphan/expired lease 分支都必须覆盖，且都不能留下两个并行 attempt。
- DB 与 GitHub 证据不完整或冲突时，只按现有结构化 ground truth 规则推导，不从 Agent 自然语言猜状态。
- 同一失败签名跨 run 重现与不同失败签名首次出现要区分，前者不得再次派 generator。

## 范围限定

**在范围内**：harness-skill-relay run bootstrap；approved contract、PRD、PR 与合同里程碑的跨 run 单调恢复；attempt reclaim/resume；结构化失败签名去重；contract-store、ground-truth、reconcile、counters；两 run、Brain restart、orphan running、跨 run 同签名的真实回归测试；Brain 源码规则要求的 DEFINITION.md 与四处版本账本更新；稳定恢复原语导出。

**不在范围内**：LLM Commander、Commander Memory、CommanderDirective、Harness Actor Inbox、Provider/Fleet 路由、Provider capability 扩展、遥测 API、metrics UI、第二状态机、第二流程账本、生产数据库写入、自动 merge。

## 假设

- [ASSUMPTION: `wait:human_review` 与 `FAILED` 的具体选择继续服从现有不变量，本 sprint 不新增第三种失败出口。]
- [ASSUMPTION: payload 未提供 thin_prd，但 task description 已明确锚定 “Kernel durable resume：跨 run 去重与恢复” 的完整范围。]
- [ASSUMPTION: Journey 未提供可用的 Golden Path step 锚点，因此 step_id 按合同写为未锚定，不自行猜测。]

## 预期受影响文件

- `packages/brain/src/`：Kernel Harness run bootstrap、contract-store、ground-truth、reconcile、counters 与稳定恢复原语。
- `packages/brain/` 下现有 Harness 测试目录：增加两 run、Brain restart、orphan running、跨 run 同签名回归，不削弱或改写既有合同测试。
- `DEFINITION.md`：记录 Brain 源码行为与版本变更。
- 仓库现行四处版本账本：按 Brain 规则同步同一版本。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 同一 initiative/task 已完成的 Planner/Reviewer/Generator 不得因后续 run 重复派发；同一结构化失败签名跨 run 不得再次派 generator
- 版本要求: Brain 源码变更必须更新 DEFINITION.md 与四处版本账本
- 可观测: 只使用 initiative_contracts、harness_attempts、orchestrator_decision_log 与 GitHub 结构化证据；PR 保持 OPEN，正文列出根因、Red→Green、回归池、CI rollup 与剩余风险

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [看门狗恢复] watchdog_overdue 标 failed 的 relay run 经 orphan requeue 与 PR/sprint 外部真相核查后，从头重跑是安全恢复路径（来源: area）
- [成功语义] 通知或写库接口必须检查 sent/accepted 等语义字段，不得仅凭 ok:true 判成功（来源: area）
- [依赖修复] dep-audit 新 advisory 先查 fixAvailable；为 true 时优先执行兼容修复，不急于加白名单（来源: area）
- [会话心跳] headed relay 长 CI 等待应周期性更新 relay-runs 心跳，防止存活 session 被误标 failed（来源: area）
- [毕业校验] 测试入册 commit 后必须先跑 lint-tdd-commit-order 与 check-test-coverage 再 push（来源: area）
- [批准证据] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area）
- [脚本真跑] manual:node -e 双引号内含 JavaScript `${}` 时须在 GAN 批准前逐条真跑，bash -n 不足以捕获展开失败（来源: area）
- [冒烟铁律一] smoke 铁律（来源: area）
- [冒烟铁律二] smoke 铁律（来源: area）
- [多轮测试] 不得只测重置状态的冷启动；至少覆盖一条状态不重置、时间真实流逝的多轮集成测试（来源: area）
- [重扫幂等] 周期性重扫涉及外部付费调用时，必须先检查是否已处理，避免重复调用（来源: area）
- [时间关系] 跨模块时间常数存在大小关系时，必须显式写不变量断言或注释并做组合审查（来源: area）
- [剧场匹配] contract 文本中的 android 关键词即使位于排除说明也会触发 theater mismatch，环境声明须与真实功能一致（来源: area）
- [环境来源] target_environment 从 DB tasks.payload 读取，任务注册时必须正确写入（来源: area）
- [判定格式] Brain judge 结果须有顶层 exit_code、log_tail、behavior_tests，且每项测试含 exit_code 与 log_tail（来源: area）
- [字段长度] DB 有长度约束的字段接收无天然长度保证的数据时必须在写入前显式处理（来源: area）
- [退役复查] 复活曾退役功能前须用结构化 Git 历史核对真实代码与退役原因，不只信 commit 摘要（来源: area）
- [失败分支] 返回 null/false 表示失败的函数，调用方必须显式处理失败分支，不得只依赖 try/catch（来源: area）
- [冒烟铁律三] smoke 铁律（来源: area）
- [报告探针] journey_features.updated_at 明显早于对应 PR 合并时间时，可作为 report 阶段漏跑探针（来源: area）
- [完成核验] Brain 不得只凭容器 exit code 0 判完成，必须校验 pr_merged_at、notion_synced_at 等 report 产物（来源: area）
- [人工接管] host 或环境白名单断言必须核对 headed 人工接管场景（来源: area）
- [点火锚点] headed relay 点火须在 payload 写 base_repo 或 pr_url，且分支名带 task short id（来源: area）
- [退役实证] 退役判断必须依靠生产库状态与消费方等结构化证据，不靠记忆（来源: area）
- [吞错告警] catch 吞错的后台 job 必须记录失败计数并在连续失败超阈值时告警（来源: area）
- [表名认领] 建表或复用表前须核对全部写入方，多模块共表必须进行 schema 对齐评审（来源: area）
- [消费方] 新增后台 job 必须同时声明真实消费方，无下游读方的落库 job 不得上线（来源: area）
- [多端完整] 多设备类型字段与既有字段语义重叠时须本 sprint 消解或建立正式 decision 与任务，验收展示层区分（来源: area）
- [语义一致] 同一语义在判变端与终验端必须采用同一处理策略（来源: area）
- [引用校验] git rev-parse 判断 ref 存在必须使用 `--verify "<ref>^{commit}"`（来源: area）
- [生产隔离] smoke 使用真实 worktree 时须核对生产资源接缝并逐个显式设置跳过钩子（来源: area）
- [失败显式] 部署链任何失败路径必须显式 FAIL、告警并非零退出，不得 warning 降级（来源: area）
- [生产自报] 判变基准必须用生产实体自报信息对账 origin/main，不得依赖工作区 diff（来源: area）
- [异步测试] lint-test-quality 要求 await fn() 时，读源码测试必须包装异步函数（来源: area）
- [合同表格] Test Contract 表格固定四列，testFile 用反引号包裹并位于第三列（来源: area）
- [红灯提交] Red commit 只能 git add 精确测试路径，禁止 git add . 或整个 .harness 目录（来源: area）
- [接线回归] 调度接线回归优先用源码检查提供直接证据（来源: area）
- [定时入口] 新增 cron 功能须先检查 scheduler-jobs.js JOBS，不使用已废弃 tick-runner.js 路径（来源: area）
- [合并权限] generator 禁止自行 merge PR，只能推送 branch 并报告 ready，merge 权归 controller（来源: area）
- [环境传递] headed relay 的 tmux innerCmd 必须显式 export 会话所需 Harness 环境变量（来源: area）
- [历史核对] Proposer 复用历史合同或 E2E 断言前必须核对本任务真实派发与执行历史（来源: area）
- [共享禁区] 未经合同显式授权，generator 不得修改跨 sprint 共享 CI 判定文件（来源: area）
- [合并锚定] PR 提前合并时须核对 evaluator/judge verdict 的 SHA 与实际合并 SHA 一致（来源: area）
- [冒烟铁律四] smoke 铁律（来源: area）
- [冒烟登记] feat 且改 brain/src 的 PR 开 PR 前须一次带齐 smoke.sh 与 smoke-allowlist 登记（来源: area）
- [类型接线] 新 task_type 接线须覆盖约束、路由、executor、relay 映射与 dispatcher 防线（来源: area）
- [存活双信号] 服务存活须同时核对 launchctl 状态与端口监听（来源: area）
- [常驻域] 美国 Mac mini 常驻服务不得放入用户 LaunchAgents，须使用系统域 LaunchDaemon 与正确用户（来源: area）
- [服务清单] 新增常驻宿主服务须同步加入 launchd-patrol.js 对应 manifest（来源: area）
- [冒烟铁律五] smoke 铁律（来源: area）
- [单槽串行] 一个 slot 内任务严格串行；任务内只读可扇出，但同一时刻只能有一个代码实现者（来源: area）
- [环境推导] 环境假设值不得写死，必须从环境推导或真机校准（来源: area）
- [真境完成] 依赖真机、生产环境或真实调用方的接缝断言，未在目标环境验证只能标 logic-done-pending（来源: area）
- [多租户测试] 单元与 E2E 测试默认至少种两个租户并断言互不串（来源: area）
- [凭据安全] secrets 不得硬编码、进入 Git 或进入日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得发货（来源: area）
- [租户隔离] 涉及租户数据的查询与写入必须限定当前租户，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 环境填入真实、可重复执行的测试脚本。
# 验收 1：连续启动同一 initiative/task 的两个 run，第二个 run 继承同一最新 approved contract 的 id/version/branch，且 proposer/reviewer 计数不增加。
# 验收 2：在 PRD、合同批准、PR 确认等不同里程碑后重启 Brain，恢复后的里程碑不回退、不丢失，derive 从正确后继状态继续。
# 验收 3：制造 expired lease 与 orphan running；有 provider session 时只 resume 原 attempt，无 session 时结构化终结原 attempt 后再推导，任一分支都不创建并行 attempt。
# 验收 4：让同一结构化失败签名在后续 run 再现，generator 计数不增加，出口为现有规则决定的 wait:human_review 或 FAILED。
# 验收 5：执行现有 Harness 合同回归池与新增真实回归，保存严格 Red→Green、两 run、Brain restart、orphan、同签名、CI rollup 结构化证据。
# 验收 6：断言未新增第二账本、未写生产数据库、未自动 merge，PR 保持 OPEN 并等待独立复审。
```

## journey_type: autonomous
## journey_type_reason: 变更锚定 Cecelia `packages/brain/` 的 Kernel Harness 纯后端恢复行为。
## target_environment: local_api
## target_environment_reason: Cecelia Brain 内部纯后端 hotfix，由本地 evaluator 在 Brain API 与隔离测试数据库环境验证。
## journey_id: 741d4acc-9ca8-4545-a971-efa12fce8150
## step_id: none（PrepPRD 未锚定）
