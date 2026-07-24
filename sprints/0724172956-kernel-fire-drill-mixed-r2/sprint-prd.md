# Sprint PRD — Kernel v1 mixed provider 上岗复试 fire drill 证据文档（docs/fire-drills/kernel-v1-mixed-20260724-r2.md）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：83%（Kernel v1 mixed-provider 全链路上岗证据落档）

## 背景

PR #4294（merge commit 19887912bbb581597f12c714a9ed187f051e2850，生产版本 1.267.67）合并部署后，需做一次正式 mixed-provider fire drill：全链路（planner → proposer → 独立 reviewer → generator → 独立 evaluator → independent judge → authenticated human review）真跑一遍，并把各角色 provider/account 实际运行证据沉淀为文档。本 sprint 的唯一交付物是这份证据文档。

## Golden Path（核心场景）

系统从 [fire drill 链路各角色真实运行] → 经过 [证据汇总写入文档] → 到达 [文档存在且含 PASS 标记，可被验收命令机检]

具体：
1. [触发条件] Harness 链路以 mixed provider 配置跑完本 fire drill 各角色（planner/proposer/reviewer/generator/evaluator/judge）
2. [系统处理] generator 新增文件 `docs/fire-drills/kernel-v1-mixed-20260724-r2.md`，内容包含：标记 `KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2`、生产版本 `1.267.67`、merge commit `19887912bbb581597f12c714a9ed187f051e2850`、各角色 provider/account 的实际运行证据摘要
3. [可观测结果] `test -f docs/fire-drills/kernel-v1-mixed-20260724-r2.md` 通过，且 `grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2` 命中；PR 在 authenticated human review 通过前保持不 merge

## 边界情况

- 文档已存在同名文件 → 本 drill 为 r2 新文件，若意外已存在则内容必须被本次证据覆盖后仍满足全部 grep 断言
- 证据摘要缺某角色 → 不算完成：六个角色（planner/proposer/reviewer/generator/evaluator/judge）每个都必须有 provider/account 证据行
- human review 未完成 → 禁止 merge（链路必须停在 review 门前）

## 范围限定

**在范围内**：仅新增 `docs/fire-drills/kernel-v1-mixed-20260724-r2.md` 一个文档文件。
**不在范围内**：不得修改 `packages/brain`、现有合同测试、migrations、任何产品逻辑；不改 CI 配置。

## 假设

- [ASSUMPTION: task.payload.thin_prd 为空，本 PRD 以 task.description 为产品意图主源（description 已含完整交付物、标记与验收命令，scope 可锚定）]
- [ASSUMPTION: 各角色 provider/account 证据由 relay 链各步骤运行时产生，generator 汇总写入文档；planner 不指定证据具体格式，仅要求六角色齐全]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-mixed-20260724-r2.md`: 本 sprint 唯一新增交付物

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 双源均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 生产版本 1.267.67（来自任务描述，需字面写入文档）
- 可观测: human review 前禁止 merge；验收命令必须机检可跑（test -f + grep）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 级为空，以下均为 area 级） -->
- [learning: 合同批准] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解…（来源: area）
- [learning: manu] learning: manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。 manual:node -…（来源: area）
- [smoke-invarian] smoke 铁律（来源: area）
- [smoke-invarian] smoke 铁律（来源: area）
- [learning: [ ]] learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，…（来源: area）
- [learning: [ ]] learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bu…（来源: area）
- [learning: [ ]] learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > ID…（来源: area）
- [learning: thea] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 window…（来源: area）
- [learning: targ] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payloa…（来源: area）
- [learning: Brai] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式…（来源: area）
- [learning: [ ]] learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 workt…（来源: area）
- [learning: [ ]] learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death c…（来源: area）
- [learning: [ ]] learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这…（来源: area）
- [smoke-invarian] smoke 铁律（来源: area）
- [learning: jour] learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检 journey_features 表的…（来源: area）
- [learning: harn] learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain …（来源: area）
- [learning: cont] learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN contract…（来源: area）
- [learning: head] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账…（来源: area）
- [learning: [ ]] learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保…（来源: area）
- [learning: [ ]] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（in…（来源: area）
- [learning: [ ]] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 …（来源: area）
- [learning: [ ]] learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者） [ ] 新增后台 job 必须同时声明消费方——无下…（来源: area）
- [多设备类型(os_type/] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-re…（来源: area）
- [learning: [ ]] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略…（来源: area）
- [learning: [ ]] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量 [ ] `git rev-parse` …（来源: area）
- [learning: [ ]] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs…（来源: area）
- [learning: [ ]] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep…（来源: area）
- [learning: [ ]] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒…（来源: area）
- [learning: lint] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync lint-test-quality 要求 aw…（来源: area）
- [learning: Test] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Test Contract 表格固定 4 列格式，testFile…（来源: area）
- [learning: Red] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入 Red commit 必須只 git …（来源: area）
- [learning: 回归测试] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [learning: 新增 c] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新增 cron 功能首先检查 scheduler-jobs.j…（来源: area）
- [learning: harn] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch …（来源: area）
- [learning: head] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS…（来源: area）
- [learning: Prop] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄…（来源: area）
- [learning: 给 ha] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowl…（来源: area）
- [learning: PR 被] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge ve…（来源: area）
- [smoke-invarian] smoke 铁律（来源: area）
- [learning: [ ]] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红 [ ] feat+brain/src PR 开 P…（来源: area）
- [learning: [ ]] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / execu…（来源: area）
- [learning: [ ]] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a） [ ] 服务"该活着"的判定用双信号：la…（来源: area）
- [learning: [ ]] learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `Us…（来源: area）
- [learning: [ ]] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_…（来源: area）
- [smoke-invarian] smoke 铁律（来源: area）
- [单 slot 串行任务，并行] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个…（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿：以下为期望验收点，最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出。

```bash
# 占位：proposer 将按 target_environment 填入真实脚本（local_api→本地命令）
# 期望验收点（自然语言）：
# 1. test -f docs/fire-drills/kernel-v1-mixed-20260724-r2.md 通过（文件存在）
# 2. grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2 docs/fire-drills/kernel-v1-mixed-20260724-r2.md 命中
# 3. 文档含字面 "1.267.67" 与 "19887912bbb581597f12c714a9ed187f051e2850"
# 4. 文档含 planner/proposer/reviewer/generator/evaluator/judge 六角色各自的 provider/account 证据摘要
# 5. git diff 范围仅含 docs/fire-drills/ 新文件，不触碰 packages/brain、合同测试、migrations
```

## journey_type: autonomous
## journey_type_reason: 交付物为仓库文档，无 UI/agent 协议/engine 路径命中，走 else 默认 autonomous
## target_environment: local_api
## target_environment_reason: 验收命令为本地 test -f + grep，无需外部机器，走默认 local_api（本地 evaluator）
## journey_id: none
## step_id: none（PrepPRD 未锚定）
