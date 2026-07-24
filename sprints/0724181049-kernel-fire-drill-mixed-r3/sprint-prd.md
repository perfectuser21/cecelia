# Sprint PRD — Kernel v1 mixed provider fire drill 终试（r3）：新增 docs/fire-drills/kernel-v1-mixed-20260724-r3.md

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：83%（Kernel v1 mixed-provider 接力链上岗验证闭环）

## 背景

PR #4294（merge commit 19887912bbb581597f12c714a9ed187f051e2850，生产版本 1.267.67）合并部署后，需正式 mixed-provider fire drill 终试，验证 kernel-v1 接力链在 planner/proposer=claude(account1)、reviewer/evaluator=grok(grok)、generator=codex(team3) 混合供应商下全链真实可用。上一轮 run（6dd62a2a）因 evaluator account2 配额 429 失败，本轮 r3 换 grok 账号重试。

## Golden Path（核心场景）

系统从 [Brain 派发 fire drill 任务] → 经过 [kernel-v1 接力链各角色按 mixed provider 实际运行并留证] → 到达 [docs/fire-drills/kernel-v1-mixed-20260724-r3.md 验收通过，human review 批准后 merge]

具体：
1. [触发条件] Brain 派发 harness_initiative（orchestrator=skill-relay，harness_runtime=kernel-v1），接力链依次运行 planner → proposer → 独立 reviewer → generator → 独立 evaluator → independent judge
2. [系统处理] generator 仅新增 docs/fire-drills/kernel-v1-mixed-20260724-r3.md，内容必须字面包含：标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3、生产版本 1.267.67、merge commit 19887912bbb581597f12c714a9ed187f051e2850，以及各角色 provider/account（planner=claude/account1、proposer=claude/account1、reviewer=grok/grok、evaluator=grok/grok、generator=codex/team3）的实际运行证据摘要
3. [可观测结果] `test -f docs/fire-drills/kernel-v1-mixed-20260724-r3.md` 与 `grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3` 均通过；evaluator/judge PASS 后进入 authenticated human review，human review 批准前禁止 merge

## 边界情况

- 任一角色 provider 配额/鉴权失败（如上轮 429）→ run 如实记 failure_reason，禁止伪造运行证据
- 同名文件已存在 → 视为重跑，以本次 r3 实际证据覆盖
- diff 仅允许 docs/fire-drills/ 下新增；触碰 packages/brain、现有合同测试、migrations、产品逻辑即 FAIL

## 范围限定

**在范围内**：新增 docs/fire-drills/kernel-v1-mixed-20260724-r3.md 一个文件；各角色实际运行证据摘要的收集与写入
**不在范围内**：packages/brain 任何改动、现有合同测试、迁移、产品逻辑、CI workflow、其他文档

## 假设

- [ASSUMPTION: 各角色 provider/account 运行证据可由本次 run 的 attempt 日志 / Brain harness runs API 汇总，无需新增基础设施]
- [ASSUMPTION: 生产版本 1.267.67 与 merge commit 19887912b… 以任务 payload 为事实源，本 sprint 不另行核验部署]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-mixed-20260724-r3.md`: 本 sprint 唯一新增交付物（位置词锚定 docs/fire-drills/，禁止漂移到 packages/brain/）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/journey_feature 双源均为空数组），PrepPRD 显式值优先 -->
- 超时/延迟: 整链 timeout_seconds=28800（task payload 显式给定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 生产版本 1.267.67（文件内容必须字面包含）
- 可观测: 各角色 provider/account 实际运行证据摘要必须写入交付文件；失败如实记入 run failure_reason，禁止伪造

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 为空，area 53 条全量注入） -->
- [capture-triage] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manu（来源: area）
- [capture-triage] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 ex（来源: area）
- [通用] smoke-invariant-1784808160-58494（来源: area）
- [通用] smoke-invariant-1784806023-5054（来源: area）
- [capture-triage] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至（来源: area）
- [capture-triage] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假（来源: area）
- [capture-triage] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注（来源: area）
- [agent-offline-alert] theater_mismatch 检查——contract 中 android 关键词即使在排除列表也会触发，可用 windows_cloud 环境绕过（来源: area）
- [agent-offline-alert] target_environment 从 DB tasks.payload 读取，不从文件读，任务注册时必须正确设置（来源: area）
- [agent-offline-alert] Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]，每条需含 exit_code + log_tail（来源: area）
- [capture-triage] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，（来源: area）
- [capture-triage] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:（来源: area）
- [capture-triage] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else`（来源: area）
- [通用] smoke-invariant-1784543934-2387（来源: area）
- [capture-triage] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探（来源: area）
- [capture-triage] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因（来源: area）
- [capture-triage] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 j（来源: area）
- [capture-triage] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task shor（来源: area）
- [capture-triage] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（convers（来源: area）
- [capture-triage] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） catch 吞错（来源: area）
- [capture-triage] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 表名认领冲突：建新表（来源: area）
- [capture-triage] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消（来源: area）
- [通用] 多设备类型(os_type/device_platform)UI区分必须在设计/审查阶段强制检查（来源: area）
- [capture-triage] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 同一语义（如 gi（来源: area）
- [capture-triage] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-pars（来源: area）
- [capture-triage] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（b（来源: area）
- [capture-triage] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚（来源: area）
- [capture-triage] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用（来源: area）
- [capture-triage] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFi（来源: area）
- [capture-triage] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Tes（来源: area）
- [capture-triage] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness（来源: area）
- [capture-triage] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code in（来源: area）
- [capture-triage] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新（来源: area）
- [capture-triage] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，g（来源: area）
- [capture-triage] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude sessi（来源: area）
- [capture-triage] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 6（来源: area）
- [capture-triage] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml（来源: area）
- [capture-triage] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR （来源: area）
- [通用] smoke-invariant-1783850042-79911（来源: area）
- [capture-triage] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI（来源: area）
- [capture-triage] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR （来源: area）
- [capture-triage] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d（来源: area）
- [capture-triage] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存（来源: area）
- [capture-triage] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（来源: area）
- [通用] smoke-invariant-1783693282-93097（来源: area）
- [系统] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [系统] 禁止写死环境假设值（来源: area）
- [系统] 真环境验证才算done（来源: area）
- [系统] 测试默认多租户（来源: area）
- [系统] 凭据安全（来源: area）
- [系统] 日志脱敏（来源: area）
- [系统] 端点鉴权（来源: area）
- [系统] 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块只框定验收点；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出。

```bash
# 占位：proposer 将填入真实脚本（test -f + grep + diff 范围检查）
# 期望验收点（自然语言）：
# 1. test -f docs/fire-drills/kernel-v1-mixed-20260724-r3.md 通过
# 2. grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3 docs/fire-drills/kernel-v1-mixed-20260724-r3.md 通过
# 3. 文件字面包含 1.267.67 与 19887912bbb581597f12c714a9ed187f051e2850
# 4. 文件包含 planner/proposer/reviewer/generator/evaluator/judge 各角色 provider/account 运行证据摘要
# 5. PR diff 仅含 docs/fire-drills/ 新增文件，未触碰 packages/brain、现有合同测试、migrations
# 6. authenticated human review 批准前禁止 merge（review_required=true）
```

## journey_type: autonomous
## journey_type_reason: 不涉及 apps/dashboard、agent 协议、packages/engine，为后台接力链自证 + 文档产物，命中 else 默认 autonomous
## target_environment: local_api
## target_environment_reason: 验收为本地文件断言（test -f + grep，evaluator 本地执行），非 playground/前端/Windows/生产部署场景
## journey_id: none
## step_id: none（PrepPRD 未锚定）
