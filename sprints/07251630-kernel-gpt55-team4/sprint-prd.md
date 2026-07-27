# Sprint PRD — Kernel v1 GPT-5.5 canary

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：83%

## 背景

本 sprint 是一条最小、非破坏性的 Kernel v1 GPT-5.5 canary，用来验证 Harness 接力链的 planner、proposer、reviewer、generator、evaluator 五个 Agent 角色都按任务级显式配置运行。它只产出审计文档，不改变产品代码、配置、migration、测试基础设施或生产数据。

## Golden Path（核心场景）

系统从 Kernel v1 GPT-5.5 canary 任务点火 → 经过五个 fresh session Agent 角色接力 → 到达可审计的 docs/fire-drills/kernel-v1-gpt55-team4-20260725.md 交付文件与 PASS 裁决。

具体：
1. 任务以 provider=codex、account=team4、payload.model=gpt-5.5 启动，planner、proposer、reviewer、generator、evaluator 都必须 fresh session。
2. 每个角色的执行证据都能在 Brain harness_attempts 中看到 provider=codex、account_id=team4，且任务 payload.model 仍为 gpt-5.5。
3. 交付文件 docs/fire-drills/kernel-v1-gpt55-team4-20260725.md 记录 task id、run id、五个角色的 provider/account、payload model、最终 evaluator/judge verdict 和 PR URL。
4. PR diff 除 sprint 合同、裁决留痕等 Harness 必需产物外，只允许包含该 fire-drill 文档，不包含 packages/**、apps/**、scripts/**、配置、migration、测试基础设施或生产数据改动。
5. CI 绿、evaluator PASS、independent judge PASS 后才允许 merge；Judge 保持现有 independent-judge/deepseek-v4-flash，不伪称为 GPT-5.5。

## 边界情况

- 如果任一 Agent 角色不是 provider=codex/account=team4，验收失败。
- 如果任一 Agent 角色复用旧 session，验收失败。
- 如果 payload.model 不是 gpt-5.5，验收失败。
- 如果 PR diff 出现产品代码、配置、migration、测试基础设施或生产数据改动，验收失败。
- 如果 evaluator 或 independent judge 未 PASS，不允许 merge。

## 范围限定

**在范围内**：运行 Kernel v1 canary；生成 fire-drill 审计文档；验证五个 Harness 角色的 provider/account/model/fresh-session 证据；验证 diff 限定、CI、evaluator、judge 裁决。

**不在范围内**：修改 packages/**、apps/**、scripts/**、配置、migration、测试基础设施、生产数据；替换 independent judge；把 judge 伪称为 GPT-5.5；新增业务功能。

## 假设

- [ASSUMPTION: Brain harness_attempts 表可用于按本 task id 或 run id 核查五个角色的 provider/account 证据。]
- [ASSUMPTION: fresh session 证据由 Harness 运行记录或 session 标识体现，Proposer 需把可机检 oracle 固化到合同。]
- [ASSUMPTION: sprint 合同与裁决留痕属于 Harness 必需产物，可出现在 PR diff 中。]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-gpt55-team4-20260725.md`: 记录本次 canary 的 task id、run id、五角色 provider/account、payload model、最终 evaluator/judge verdict 和 PR URL。

## NFR 约束

<!-- 来源: PrepPRD 显式值优先；decisions 表 category=nfr 本次为空 -->
- 超时/延迟: task payload timeout_seconds=7200
- 频控: 最小、非破坏性 canary；production_db_mutation_allowed=false
- 版本要求: provider=codex；account=team4；payload.model=gpt-5.5；judge=independent-judge/deepseek-v4-flash
- 可观测: 交付文档必须可追溯 task id、run id、五角色 provider/account、payload model、evaluator/judge verdict、PR URL；Brain harness_attempts 必须能核查五角色证据

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [watchdog恢复] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [语义成功] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [依赖审计] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [relay心跳] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（来源: area）
- [毕业门禁] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push，毕业 rename 是高危触发点（来源: area）
- [oracle记录] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [manual真跑] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [smoke] smoke 铁律（来源: area）
- [smoke] smoke 铁律（来源: area）
- [多轮扫描] 测试如果全部依赖“重置状态=冷启动”的写法，必须补至少一条真实多轮扫描、状态不重置、时间真实流逝的集成测试（来源: area）
- [重扫防重] 周期性重新扫描同一批数据且有外部付费调用时，必须设计“是否已处理过”的前置检查（来源: area）
- [时间常数] 跨模块时间常数如果有隐含大小关系依赖，必须在设计阶段显式写不变量断言或注释（来源: area）
- [theater检查] contract 文本出现 android 关键词即使在排除说明内也会触发 theater_mismatch，target_environment 必须按真实执行环境设置（来源: area）
- [环境路由] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，POST /api/brain/tasks 时必须正确设置（来源: area）
- [judge格式] Brain judge API 必须有顶层 exit_code、log_tail、behavior_tests[]，且每条 behavior_test 有 exit_code 与 log_tail（来源: area）
- [字段长度] DB 表字段长度约束在写入前若来源数据没有天然长度保证，必须显式截断（来源: area）
- [退役复活] 复活/重做曾经死过的功能前，先用 git 历史读退役前真实代码并核对 death cause（来源: area）
- [错误码契约] 调用返回 null/false 表示失败的函数时，必须显式写 else 处理失败分支，不能只依赖 try/catch（来源: area）
- [smoke] smoke 铁律（来源: area）
- [report兜底] journey_features.updated_at 长期停滞可作为 report 阶段漏跑的兜底探针信号（来源: area）
- [收账核查] harness-controller relay 容器可能在 merge 后异常退出并跳过 report，Brain 侧不应仅凭容器 exit code 0 判完成（来源: area）
- [环境白名单] contract-proposer 起草 host/环境白名单类断言时必须核对 headed 人工接管场景（来源: area）
- [headed点火] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id（来源: area）
- [退役数据] 退役判断依据数据不靠记忆，必须查生产库与消费方 grep 等外部真相（来源: area）
- [后台告警] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [表名认领] 建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [消费方] 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [多端完整] 涉及多设备类型或 os_type 时，合同、planner 与 reviewer 必须覆盖展示层区分与多端完整性（来源: area）
- [语义一致] 同一语义在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [git引用] git rev-parse 判 ref 存在必须带 --verify "<ref>^{commit}"，裸 rev-parse 失败会回显字面量（来源: area）
- [生产资源] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（来源: area）
- [失败不降级] 部署链任何失败路径禁止 warning 降级，必须显式 FAIL 变量、Bark 与非零退出（来源: area）
- [判变基准] 判变基准永远用生产实体自报对账 origin/main，禁用工作区 diff（来源: area）
- [lint质量] lint-test-quality 要求 await fn() >= 1：读源码必须包装 async function，不能直接 readFileSync（来源: area）
- [测试契约] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [Red提交] Red commit 必须只 git add 精确测试路径，禁止 git add . 或 git add .harness/（来源: area）
- [源码检查] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [cron入口] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [merge权限] harness-generator 禁止自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [tmux环境] headed relay 的 tmux innerCmd 子 shell 不自动继承父进程环境变量，需要显式传入 HARNESS 上下文变量（来源: area）
- [模板复用] Proposer 复用历史合同模板时必须先核对本次任务真实派发/执行历史，不能假设与先例路径相同（来源: area）
- [共享禁区] harness-generator 需把共享 CI 基础设施文件纳入默认禁区规则（来源: area）
- [提前合并] PR 被 CI 侧兜底机制提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 锚定的 sha 与实际合入 sha（来源: area）
- [smoke] smoke 铁律（来源: area）
- [task接线] 新 task_type 接线用七点清单：约束、router、executor kind、dispatch、override、requeue、验收全覆盖（来源: area）
- [服务存活] 服务“该活着”的判定用 launchctl 状态 + 端口监听双信号（来源: area）
- [LaunchDaemon] 本机美国 Mac mini 禁止再往 ~/Library/LaunchAgents 放需要常驻的服务，使用系统域 LaunchDaemon（来源: area）
- [巡检清单] 新增常驻宿主服务时，必须同步加进 packages/brain/src/launchd-patrol.js manifest（来源: area）
- [smoke] smoke 铁律（来源: area）
- [slot串行] 一个 slot/会话内严格串行执行任务，同一 slot 同时只允许一个任务在跑；并行只许跨 slot 或任务内部只读扇出（来源: area）
- [环境假设] 屏幕外坐标、UIA 气泡阈值、调用方参数、.env 值等环境假设禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境] 依赖真机、生产 env、真实调用方的接缝断言必须在真目标上验证过才算 done（来源: area）
- [多租户测试] 单元/E2E 测试默认种至少 2 个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本。
# 期望验收点：
# 1. docs/fire-drills/kernel-v1-gpt55-team4-20260725.md 存在并记录 task id、run id、五角色 provider/account、payload model、evaluator/judge verdict、PR URL。
# 2. Brain harness_attempts 中 planner/proposer/reviewer/generator/evaluator 五种角色均出现 provider=codex 且 account_id=team4。
# 3. 任务 payload.model=gpt-5.5；五角色均为 fresh session。
# 4. PR diff 除 sprint 合同/裁决留痕等 Harness 必需产物外，不包含产品代码、配置、migration、测试基础设施或生产数据。
# 5. CI 绿、evaluator PASS、independent judge PASS；judge 身份保持 independent-judge/deepseek-v4-flash。
```

## journey_type: dev_pipeline
## journey_type_reason: 本任务验证 Kernel Harness planner/proposer/reviewer/generator/evaluator 接力链，属于开发流水线 canary。
## target_environment: local_api
## target_environment_reason: payload.target_environment 显式为 local_api，验收围绕 Brain harness_attempts 与本地 PR/diff 证据。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
