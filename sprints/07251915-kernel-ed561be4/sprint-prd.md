# Sprint PRD — Kernel capability gate：派发前能力预检

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：83%

## 背景

Kernel Harness 已出现冻结合同与真实执行环境冲突后反复 generator-fix 的结构性问题：provider 未登录、PostgreSQL/测试依赖或模型凭证缺失在执行启动后才暴露；Generator 无权改冻结合同，控制器仍继续派发，导致白跑 attempt 与错误归因。本 sprint 要把能力预检前移到合同批准/生成与 attempt 启动前，并把 product failure 与 infrastructure/contract capability mismatch 明确分流。

## Golden Path（核心场景）

Kernel capability gate：派发前能力预检从合同准备 → server-owned capability snapshot → attempt 启动前结构化 preflight → 成功则派发、失败则阻断并归类，避免冻结合同和真实执行环境冲突后反复 generator-fix。

具体：
1. 合同批准/生成前，系统形成 server-owned capability snapshot，覆盖 provider auth、GitHub、PostgreSQL/测试依赖，以及合同要求的外部模型能力。
2. 每次 attempt 创建前，系统按 provider/account 与合同能力要求执行有时限的结构化 auth/capability preflight。
3. provider 未登录、GitHub 不可用、PostgreSQL/测试依赖缺失或模型能力不满足时，系统不创建白跑 attempt，任务落明确 `infrastructure_blocked` 或 capability mismatch 状态。
4. product failure 仍按合同进入 generator-fix；infrastructure/contract capability mismatch 不得进入 generator-fix 循环，必须转人审并告警。
5. preflight 遇到网络瞬断可按同一结构化签名有限重试；同签名重复失败受收敛闸约束，不能无限派发。
6. 所有状态判断只使用结构化 preflight/snapshot 证据，不从 Agent 自然语言猜 provider、账号或执行环境状态。
7. 验收完成后 PR 保持 OPEN，不自动 merge，PR 正文列出根因、Red→Green、回归池、CI rollup 与剩余风险。

## 边界情况

- provider/account 未登录：启动前阻断，不占用 attempt 轮次，不进入 generator-fix。
- 合同要求真实 PostgreSQL 或外部模型能力但执行环境缺失：归为 contract capability mismatch，告警并待人审。
- 网络瞬断：允许有限重试；同签名重复失败后收敛阻断。
- product 断言失败但能力 snapshot 满足：继续走 generator-fix。
- preflight 自身异常或超时：按基础设施阻断处理，日志记录结构化原因，不泄露凭据。

## 范围限定

**在范围内**：合同批准/生成前 capability snapshot；attempt 启动前 provider/account/GitHub/PostgreSQL/测试依赖/模型能力 preflight；失败分类与 generator-fix 分流；同签名收敛闸；注入依赖回归测试；Brain 版本与账本同步。

**不在范围内**：跨 run contract 继承语义；telemetry schema；生产数据库写入；真实外部服务调用测试；自动 merge；大范围重写 controller 或 scheduler。

## 假设

- [ASSUMPTION: task.payload.thin_prd 未提供，本 PRD 以 task.description 中的 Kernel capability gate 证据锚定 scope。]
- [ASSUMPTION: task 未提供 ability_id/step_id，本 sprint 作为 Kernel Harness hotfix 挂接现有 journey。]
- [ASSUMPTION: capability snapshot 的最终字段由 proposer 从现有 registry/contract 结构推导，但必须 server-owned、可机检。]

## 预期受影响文件

- `packages/brain/src/orchestrator/preflight*` 或 `packages/brain/src/orchestrator/capability-gate*`：承载 capability snapshot 与 preflight 行为。
- `packages/brain/src/harness*`、`packages/brain/src/*dispatcher*`、`packages/brain/src/*derive*`：仅做最小接线，确保派发前预检与分类分流生效。
- `packages/brain/src/__tests__/`：用注入依赖覆盖 auth、GitHub、PostgreSQL/测试依赖、模型能力、网络瞬断和收敛闸。
- `packages/brain/DEFINITION.md`、`.brain-versions`、`VERSION` 及既有版本账本：Brain 源码变更后同步版本。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: preflight 必须有明确超时预算；provider/account 单次预检超时按基础设施阻断处理。
- 频控: 同一 task、provider/account、能力缺口签名的重复 preflight 失败必须收敛，不得无限创建 attempt。
- 版本要求: Brain 源码变更必须更新 `DEFINITION.md` 与四处版本账本。
- 可观测: 失败必须落结构化分类、能力缺口、provider/account、snapshot 版本和告警，不读取 Agent 自然语言状态。
- 安全/数据: 测试必须使用注入依赖，不调用真实外部服务；不得执行生产数据库写入，凭据不得进日志。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [失败恢复] watchdog_overdue 误标 failed 的 relay run 应经 orphan requeue、PR/sprint 产物核查后从头安全重跑。（来源: area）
- [语义成功] 通知或写库接口必须检查 sent/accepted 等语义字段，不能只凭 ok:true 判成功。（来源: area）
- [依赖修复] dep-audit 新 advisory 先查 fixAvailable；可兼容修复时先用 npm audit fix，不急于加白名单。（来源: area）
- [长等心跳] headed relay 长 CI 等待必须周期更新 relay-runs 心跳，避免活 session 被 reaper 误标 failed。（来源: area）
- [毕业校验] 测试入册 rename 后、push 前必须运行 lint-tdd-commit-order 与 check-test-coverage。（来源: area）
- [手工证据] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [命令真跑] `node -e` 双引号中的 JavaScript 模板表达式必须在 GAN 批准前逐条真跑，bash -n 不足以验证。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [多轮扫描] 测试不能全依赖重置状态的冷启动，至少覆盖一次状态不重置、时间真实流逝的多轮扫描。（来源: area）
- [重扫幂等] 周期重扫引入付费调用时，必须先检查是否已处理，不能假设重扫罕见。（来源: area）
- [时间关系] 跨模块时间常数存在大小依赖时必须显式声明不变量，并覆盖跨任务组合审查。（来源: area）
- [剧场匹配] theater_mismatch 判断应基于真实功能环境，排除说明中的平台词不得驱动错误路由。（来源: area）
- [环境来源] target_environment 由 Brain task payload 提供，任务注册时必须正确设置。（来源: area）
- [Judge格式] Brain judge 结果必须含顶层 exit_code、log_tail、behavior_tests，且每条行为含 exit_code 与 log_tail。（来源: area）
- [字段长度] DB 有限长字段接收无天然上限的数据时，写入前必须显式处理长度边界。（来源: area）
- [退役追溯] 复活退役功能前必须读取删除历史与退役前代码，核对真实 death cause。（来源: area）
- [失败分支] 返回 null/false 表示失败的函数调用必须显式处理失败分支，不能只依赖 try/catch。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [停滞探针] journey_features.updated_at 明显早于对应 PR 合并时间可作为 report 漏跑探针，应定期巡检。（来源: area）
- [产物核验] Brain 不得仅凭 harness-controller exit code 0 判完成，必须核验 report 产物确实写入。（来源: area）
- [有头核对] 环境白名单断言必须核对 headed 人工接管场景，不能直接复用无头先例。（来源: area）
- [派发锚点] headed relay 点火必须在 payload 写 base_repo 或 pr_url，分支名带 task short id。（来源: area）
- [退役实证] 退役判断必须核查生产数据、表行数和真实消费方，不依赖记忆或同名推断。（来源: area）
- [后台告警] catch 吞错的后台 job 必须有失败计数，连续失败超过阈值必须告警。（来源: area）
- [表名认领] 建表或复用表前必须核对全部写入方，多模块共表须经 schema 对齐评审。（来源: area）
- [消费闭环] 新增后台落库 job 必须同时声明真实消费方，无下游读方不得上线。（来源: area）
- [多端完整] 涉及多个 os_type/device_platform 时，数据字段、合同和展示层必须逐端完整区分。（来源: area）
- [语义一致] 同一语义在判变端与终验端必须采用同一处理策略，禁止跨脚本分叉。（来源: area）
- [引用核验] `git rev-parse` 判断 ref 必须使用 `--verify "<ref>^{commit}"`。（来源: area）
- [测试隔离] smoke 用真实 worktree 时必须核对生产资源接缝并显式设置全部 SKIP 钩子。（来源: area）
- [部署失败] 部署链失败不得降级为 warning，必须显式失败、告警并非零退出。（来源: area）
- [生产真相] 部署判变基准使用生产实体自报信息与 origin/main 对账，禁止依赖工作区 diff。（来源: area）
- [测试质量] lint-test-quality 要求异步调用时，源码读取测试应通过可等待的函数契约完成。（来源: area）
- [合同表格] Test Contract 固定四列，testFile 用反引号包裹并保持 checker 可解析。（来源: area）
- [红灯提交] Red commit 只能精确 add 测试路径，禁止 git add . 或把非测试文件混入。（来源: area）
- [接线回归] 调度接线回归应以可执行生产命令构造器为准，必要时辅以源码契约检查。（来源: area）
- [定时入口] 新增 cron 首先核对 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径。（来源: area）
- [合并权限] harness-generator 禁止自行 merge，只能推 branch 并报告 ready，merge 权归 controller。（来源: area）
- [环境透传] headed relay 的 tmux innerCmd 必须显式 export session 内需要的 harness 环境变量。（来源: area）
- [历史合同] Proposer 复用历史合同前必须核对本任务真实派发与执行历史，不能假设路径相同。（来源: area）
- [共享禁区] 共享 CI 基础设施未经合同显式授权不可修改，自身触发的 CI 问题应另立 sprint。（来源: area）
- [提前合并] PR 若在 evaluator/judge 前被兜底机制合并，必须按 head SHA 核对 verdict 与合并代码一致。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [源码烟测] feat 且修改 brain/src 的 PR 在开 PR 前必须带齐 smoke.sh 与 smoke allowlist 登记。（来源: area）
- [类型接线] 新 task_type 必须核对约束、路由、executor、relay 映射及 dispatcher 防线的完整接线。（来源: area）
- [服务存活] 宿主服务存活判定必须结合 launchctl 状态与端口监听双信号。（来源: area）
- [宿主服务] 美国 Mac mini 常驻服务不得放入不存在的 GUI LaunchAgent 域，应使用合适的系统服务域。（来源: area）
- [巡检清单] 新增常驻宿主服务必须同步加入 launchd-patrol 对应 manifest。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [单槽串行] 单个 slot 同时仅推进一个任务；任务内只读工种可扇出，但同时只能有一个代码实现者。（来源: area）
- [环境假设] 环境相关假设值不得写死，应从环境推导或在真实目标校准。（来源: area）
- [真境完成] 依赖真实环境的接缝断言必须在目标环境验证；未真验只能标 logic-done-pending。（来源: area）
- [多租户测] 单元与 E2E 默认使用至少两个租户并断言互不串读串写。（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志。（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进入日志。（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得交付。（来源: area）
- [租户隔离] 涉及租户数据的查询与写入必须限定当前租户，禁止跨租户混读混写。（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 将按 target_environment=local_api 固化真实脚本，最少覆盖：
cd packages/brain
npx vitest run src/__tests__/capability-gate.test.js src/__tests__/harness-dispatch-preflight.test.js
cd ../..
bash scripts/devgate/check-version-sync.sh
```

验收出口：注入依赖测试证明 provider 未登录、GitHub 缺失、PostgreSQL/测试依赖缺失、外部模型能力缺失均在 attempt 创建前阻断，并落 `infrastructure_blocked` 或 capability mismatch；product failure 不被误分流，仍进入 generator-fix；网络瞬断可有限重试，同签名重复失败触发收敛闸；测试不调用真实外部服务、不写生产数据库；跨 run contract 继承与 telemetry schema 保持不变。

## journey_type: autonomous
## journey_type_reason: 这是 Cecelia Kernel Harness 纯后端派发/预检/故障分类 hotfix，无 Dashboard、远端 agent 协议或 playground 入口。
## target_environment: local_api
## target_environment_reason: 验证以本地 Brain 单元/集成测试和非生产结构化依赖注入为主，命中 localhost 本地 evaluator。
## journey_id: 74d3dbc0-7f36-4422-9f7a-138cc66c0174
## step_id: none（PrepPRD 未锚定）
