# Sprint PRD — Kernel capability gate：派发前能力预检

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：83%

## 背景

Kernel Harness 现在会在 provider/account 未登录、真实 PostgreSQL/模型凭证/测试依赖缺失、或合同能力与执行环境冲突后才失败，导致冻结合同无法被 Generator 修改，控制器仍反复进入 generator-fix。这个 sprint 要把派发前能力预检、server-owned capability snapshot、ExecutionTarget 路由与 failure 分类前置成 Kernel 的稳定入口能力。

## Golden Path（核心场景）

系统从 Kernel 准备派发 role attempt → 先对 provider/account/machine 的 ExecutionTarget 做有时限的结构化 auth/capability preflight → 形成 server-owned capability snapshot 并决定执行或阻断 → 到达不白跑 attempt、不误进 generator-fix 的可观测出口。

具体：
1. 当合同批准/生成前需要执行 Kernel Harness role，系统先生成 capability snapshot，覆盖 provider auth、GitHub、PostgreSQL/测试依赖、外部模型能力与 canonical machine identity。
2. 当 preflight 判定 ExecutionTarget 缺 auth、未验证机器、容量不一致、合同能力不匹配或五个 Codex 账号全池不可用，系统不创建白跑 attempt，记录 `infrastructure_blocked` 或 `wait:human_review`，并发出告警。
3. 当结构化 provider transient failure 命中 HTTP 500/502/503/504、`high_demand`、`biscuit_baker_*_circuit_open`，系统在同账号同 logical_cycle 最多恢复重试一次；仍失败则短时熔断该账号，并按确定性账号/机器矩阵故障转移。
4. 当 Codex 可跨机器恢复，系统从 Git/PR/DB 真相 fresh attempt 恢复同一 role、phase、logical_cycle 与 task bundle；不得伪造跨机 session resume。
5. 当 failure 属 product failure，系统才进入 generator-fix；当 failure 属 infrastructure 或 contract capability mismatch，系统停止 generator-fix 循环，转人审并保留结构化证据。

## 边界情况

- 网络瞬断可重试，但同签名重复失败必须受收敛闸约束。
- `role_assignments.account` 只是首选账号，不是永久硬绑定。
- 未列入白名单或未实机验证的 provider×account×machine 组合 fail-closed。
- 缺失或未知 `CECELIA_MACHINE_ID` / Fleet canonical id 时 fail-closed，容器 hostname 不得污染 `attempt.machine_id`。
- CM4/CM1 不得本地启动 Claude Code/Grok；Codex 池耗尽时迁回 USM4 或阻断。

## 范围限定

**在范围内**：派发前 preflight、server-owned capability snapshot、ExecutionTarget 选择、账号/机器故障转移、failure 分类、结构化 decision/attempt 证据、注入依赖的永久回归测试。
**不在范围内**：跨 run contract 继承、telemetry schema、LLM Commander、Commander Memory、CommanderDirective、Harness Actor Inbox、唤醒策略、新事件账本、生产数据库写入、自动 merge。

## 假设

- [ASSUMPTION: task.payload 未提供 thin_prd 字段，本 PRD 使用 Brain task.description 作为 PrepPRD scope 锚定来源。]
- [ASSUMPTION: active OKR API 未返回稳定 KR 编号，本 PRD 按活跃 OKR 列表第二项标记 KR-2。]
- [ASSUMPTION: PrepPRD 未提供 step_id，末尾以 none（PrepPRD 未锚定）标注。]

## 预期受影响文件

- `packages/brain/src/orchestrator/preflight/` 或 `packages/brain/src/orchestrator/capability-gate/`: Kernel 派发前能力预检与 snapshot 行为归属。
- `packages/brain/src/**/dispatcher*` 与 `packages/brain/src/**/derive*`: 只做 preflight、ExecutionTarget 与 failure 分类的最小接线。
- `packages/brain/src/**/*.test.*`: 注入 provider/GitHub/PostgreSQL/model/Fleet 依赖的永久回归测试。
- `DEFINITION.md` 与 Brain 版本账本: Brain 源码变更后的版本记录。

## NFR 约束

<!-- 来源: PrepPRD 显式值优先；decisions 表 category=nfr 本次为空 -->
- 超时/延迟: preflight 必须有有时限的结构化结果；网络瞬断允许有限重试。
- 频控: 同账号同 logical_cycle 的 transient 恢复重试最多一次；同签名重复失败受收敛闸约束。
- 版本要求: 使用 canonical Fleet machine id，只允许 `{us-mac-m4,xian-mac-m4,xian-mac-m1}`。
- 可观测: 每次选择/降级记录 `from_target`、`to_target`、`fallback_reason`、`capability_snapshot_id`。
- 安全: 不调用真实外部服务、不写生产数据库、不记录 secrets。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本次只有 area 级数据 -->
- [重跑恢复] watchdog_overdue 标 failed 的 relay run 经 orphan requeue 与外部真相核查后，从头重跑是安全恢复路径（来源: area）
- [语义成功] 通知/写库接口的成功判定必须看 sent/accepted 等语义字段，不能只 grep ok:true（来源: area）
- [审计修复] dep-audit 新 advisory 翻红时先查 fixAvailable；布尔 true 走兼容修复，不急加白名单（来源: area）
- [Relay心跳] headed relay 长 CI 等待循环必须周期性 PATCH relay-runs 心跳，防止 Brain reaper 误标 failed（来源: area）
- [测试入册] 毕业 commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push（来源: area）
- [Oracle] 合同批准前必须记录 manual oracle 真实 exit code，并确认目标解释器确实启动（来源: area）
- [Node真跑] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑（来源: area）
- [Smoke1] smoke 铁律（来源: area）
- [Smoke2] smoke 铁律（来源: area）
- [多轮扫描] 跨扫描周期逻辑必须补真实多轮扫描、状态不重置、时间真实流逝的集成测试（来源: area）
- [重扫去重] 周期性重扫同批数据且引入外部付费调用时，必须有是否已处理过的前置检查（来源: area）
- [时间常数] 跨模块时间常数存在隐含大小关系时，必须显式写不变量断言或注释（来源: area）
- [环境匹配] contract 文本含 android 关键词即使在排除列表也会触发 theater_mismatch，环境需正确标注（来源: area）
- [环境路由] target_environment 从 DB tasks.payload 读取，任务注册时必须正确设置（来源: area）
- [Judge格式] Brain judge 结果必须有顶层 exit_code、log_tail、behavior_tests[]，每条也需 exit_code 与 log_tail（来源: area）
- [字段长度] DB varchar 等字段写入前若来源无天然长度保证，必须显式截断（来源: area）
- [退役复活] 复活/重做退役功能前，必须读退役前真实代码并核对 death cause（来源: area）
- [失败分支] 返回 null/false 表示失败的函数，成功分支后必须显式处理失败分支（来源: area）
- [Smoke3] smoke 铁律（来源: area）
- [Report探针] journey_features.updated_at 长期早于 PR 合并时间可作为 report 阶段漏跑兜底探针（来源: area）
- [收账守卫] Brain 侧不应只凭 relay 容器 exit code 0 判定 Step 6 后 Step 7 已完成（来源: area）
- [Host白名单] 起草 host/环境白名单断言时必须核对 headed 人工接管场景（来源: area）
- [Payload锚定] headed relay 点火必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id（来源: area）
- [数据退役] 退役判断必须查生产库和消费方真相，不能靠记忆误删活模块（来源: area）
- [Job告警] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [表名认领] 建新表/复用表前先 grep 写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [消费方] 新增后台 job 必须同时声明消费方；无下游读方的落库 job 不允许上线（来源: area）
- [字段消歧] 新字段与既有字段语义重叠时必须本 sprint 消解或建正式 decision，不能只写技术债（来源: area）
- [语义一致] 同一语义在判变端与终验端必须同一处理策略，防止跨脚本假绿（来源: area）
- [Ref校验] git rev-parse 判 ref 存在必须带 `--verify "<ref>^{commit}"`（来源: area）
- [Worktree隔离] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对是否触碰生产资源（来源: area）
- [失败显式] 部署链任何失败路径禁止 warning 降级，必须显式 FAIL、Bark 与非零退出（来源: area）
- [生产自报] 判变基准永远用生产实体自报对账 origin/main，禁用工作区 diff（来源: area）
- [测试质量] lint-test-quality 要求 await fn() ≥ 1，读源码必须包装 async function（来源: area）
- [合同表格] Test Contract 表格固定 4 列，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [Red精确] Red commit 必须只 git add 精确测试路径，禁止 git add . 或 git add .harness/（来源: area）
- [接线验证] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [Cron入口] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [生成权限] harness-generator 禁止自行 merge PR，merge 权归 controller（来源: area）
- [环境继承] headed relay 的 tmux innerCmd 子 shell 不自动继承父进程环境变量，所需上下文必须显式传入（来源: area）
- [合同复用] Proposer 复用历史合同模板时必须核对本次真实派发/执行历史（来源: area）
- [基建禁区] generator 默认不得改共享 CI 基础设施文件，除非合同明确允许（来源: area）
- [合并核验] PR 被 CI 兜底提前合并时，必须核对 evaluator/judge verdict 文件锚定 sha 与实际合并 sha（来源: area）
- [Smoke4] smoke 铁律（来源: area）
- [BrainSmoke] feat+brain/src PR 开 PR 前带齐 smoke.sh 与 smoke-allowlist 登记（来源: area）
- [Task接线] 新 task_type 接线必须过 CHECK 约束、task-router、executor 分支等七点清单（来源: area）
- [服务双信号] 服务存活判定用 launchctl 状态 + 端口监听双信号（来源: area）
- [LaunchDaemon] 美国 Mac mini 禁止再往 ~/Library/LaunchAgents 放需常驻服务（来源: area）
- [宿主巡检] 新增常驻宿主服务时必须同步加入 launchd-patrol manifest（来源: area）
- [Smoke5] smoke 铁律（来源: area）
- [Slot串行] 一个 slot/会话内严格串行执行任务，并行只许跨 slot（来源: area）
- [环境假设] 屏幕坐标、UIA阈值、环境变量等环境假设值禁止写死，必须推导或真机校准（来源: area）
- [真环境] 依赖真机/生产 env/真实调用方的接缝断言必须在真目标验证才算 done（来源: area）
- [多租户] 单元/E2E 测试默认种至少两个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
export NODE_ENV=test
export HARNESS_NO_REAL_EXTERNALS=1
export CECELIA_MACHINE_ID=us-mac-m4

npm --prefix packages/brain exec -- vitest run \
  src/orchestrator/preflight/capability-gate.test.js \
  src/orchestrator/preflight/execution-target-routing.test.js \
  src/orchestrator/preflight/failure-classification.test.js \
  src/orchestrator/preflight/machine-identity.test.js

# 期望验收点：
# - provider 未登录或依赖缺失时不创建白跑 attempt，落 infrastructure_blocked。
# - snapshot 覆盖 provider auth、GitHub、PostgreSQL/测试依赖、外部模型能力。
# - transient provider failure: team4 503 可转 team1 成功；全池失败转人审；容量缓存误报 fail-safe。
# - 路由矩阵只允许已验证 ExecutionTarget；CM4/CM1 禁用 Claude/Grok；Codex 可跨机 fresh recovery。
# - Docker hostname 不会写入 attempt.machine_id。
```

## journey_type: autonomous
## journey_type_reason: 任务是 Cecelia Kernel/Harness 纯后端调度与 failure 分类能力，不涉及 Dashboard UI。
## target_environment: local_api
## target_environment_reason: Brain 内部/纯后端能力，在本地 evaluator 以注入依赖和本地测试验证；禁止真实外部服务与生产 DB 写入。
## journey_id: 74d3dbc0-7f36-4422-9f7a-138cc66c0174
## step_id: none（PrepPRD 未锚定）
