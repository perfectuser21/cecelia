# Sprint PRD — ledger-hygiene m7 探针口径修正 + 自主循环产出登记覆盖

## OKR 对齐

- **对应 KR**：O2「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（无 KR 编号，锚定 objective 层）
- **当前进度**：82%
- **本次推进预期**：+1%（消除每日误报紧急任务对自主循环的空转消耗）

## 背景

ledger-hygiene m7 探针连续两日误报"自主循环零产出"（streak.m7=2），08-05 将 streak=3 自动升 P1+Bark。根因（见 `.harness/research-context.md`）：①探针 NOW()-24h 秒级窗口漂移 + 自产 issue atoms 自污染；②自主侧真实产出（harness_initiative 失败教训、relay handoff）零登记；③pushCaptureAtom 签名断裂致溯源字段全空。本 sprint 修 P0+P1；P2 台账闭环（僵尸 issue 自动关闭）裁剪为后续 sprint。

## Golden Path（核心场景）

系统从 [每日北京 05:10 ledger-hygiene 探针触发] → 经过 [m7 按完整北京日统计、排除自产 atoms、自主侧产出已被登记为 capture_atoms] → 到达 [debt 如实反映真实产出，不再自我延续误报]

具体：
1. [触发] harness_initiative 任务 failed → auto-learning 生成 learning，并写入 1 条 capture_atom（routed_to_table/routed_to_id 指向该 learning）
2. [触发] skill-relay 完成任务写 handoff（PATCH tasks.result.handoff）→ 该路径同样产生 1 条 handoff 来源的 capture_atom（与 saveHandoff 路径同口径）
3. [系统处理] 探针 05:10 运行：m7 统计窗 = 上一个完整北京日（00:00-24:00），不再用 NOW()-24h；统计时排除 ledger-hygiene 探针自产的 issue atoms
4. [可观测结果] 上一北京日内存在任意 1 条非自产 atom → m7 debt=0，不开新 issue，working_memory ratchet streak 复位；若真实零产出 → debt+1 照常（探针有效性保留）
5. [可观测结果] absolute 指标 debt 与前日持平时，issue 文案不再写"上升 X→X"（改为如实表述持平/连续第 N 天）
6. [可观测结果] 全部 pushCaptureAtom 调用方（ledger-hygiene.js / cortex.js / auto-learning.js / handoff.js 等）传入的 routed_to_table/routed_to_id 被真实落库，不再静默丢弃

## 边界情况

- 上一完整北京日恰好只有探针自产 issue atoms → 排除后为 0 → debt+1（正确击穿，不算误报）
- harness_initiative 任务无有效教训内容 → auto-learning 走既有 content_hash 去重/跳过逻辑，不产垃圾 atom
- relay handoff 为空或格式异常 → 不产 atom，不抛异常阻断 PATCH 主流程
- 跨时区/夏令时：统计窗按 Asia/Shanghai 固定 UTC+8 计算，不受服务器本地时区影响
- strategy_session 子探针（从未激活）行为不变，不在本次范围

## 范围限定

**在范围内**（research P0+P1）：
- m7 统计窗改为上一完整北京日 + 排除自产 issue atoms（含 debt 持平文案修正——同函数顺带）
- harness_initiative 纳入 auto-learning VALUABLE_TASK_TYPES
- relay 写 handoff 路径补齐 capture_atom 登记（统一走 saveHandoff 或 PATCH API 侧补 pushCaptureAtom）
- 修 pushCaptureAtom 签名断裂，恢复 routed_to_table/routed_to_id 落库

**不在范围内**（显式裁剪为后续 sprint）：
- P2 台账闭环：指标恢复当天自动关闭对应 [ledger-hygiene] issue；存量 26 条僵尸 issue 清理
- conversation-claude 会话捕获（captures→capture_atoms）补齐
- 生产 brain checkout 落后 66 commit 的部署问题
- watchdog 误杀 relay run 问题（另案）

## 假设

- [ASSUMPTION: "排除自产 atoms" 的判别依据为 ledger-hygiene 探针 pushCaptureAtom 时的固定来源标识（source/tag），若现有 atoms 无此标识则本次一并补上标识写入]
- [ASSUMPTION: relay 侧 PATCH API 补 pushCaptureAtom 与统一走 saveHandoff 二选一由 proposer 按代码现状定，行为验收口径相同：relay 完成任务后 capture_atoms 可查到对应记录]
- [ASSUMPTION: 改动全部落在 packages/brain，须先过 DevGate 三件套（facts-check / check-version-sync / check-dod-mapping）]

## 预期受影响文件

- `packages/brain/src/ledger-hygiene.js`: m7 统计窗口径、自产排除、issue 文案、自产 atom 标识
- `packages/brain/src/auto-learning.js`: VALUABLE_TASK_TYPES 增 harness_initiative；pushCaptureAtom 传参对齐
- `packages/brain/src/capture-inbox.js`: pushCaptureAtom 签名恢复 routed_to_table/routed_to_id 落库
- `packages/brain/src/handoff.js` 及 relay PATCH 路由: relay handoff 补 capture_atom 登记
- `packages/brain/src/cortex.js` 等其余调用方: 签名对齐（仅传参核对）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本次为空），以下为 PrepPRD（research-context）显式事实 -->
- 超时/延迟: 待定（PrepPRD 未指定；探针为每日批处理，无实时性要求）
- 频控: 每指标每日最多一条 issue（既有行为，不得回退）
- 版本要求: 无
- 可观测: 探针结果照旧写 design_docs(type=ledger_hygiene) 分数卡 + working_memory key=ledger_hygiene_ratchet，不得破坏既有写入；修 bug 的 failing test 必须 commit 进 CI 永久保留（regression test）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 两级为空，area 级 62 条全量） -->
- [capture-triage] cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code ins（来源: area）
- [capture-triage] 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一（来源: area）
- [capture-triage] proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实a（来源: area）
- [capture-triage] contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库（来源: area）
- [capture-triage] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/s（来源: area）
- [capture-triage] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（（来源: area）
- [capture-triage] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接（来源: area）
- [capture-triage] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reap（来源: area）
- [capture-triage] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 p（来源: area）
- [[capture] [capture-triage] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manu（来源: area）
- [capture-triage] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 ex（来源: area）
- [smoke] smoke-invariant-1784808160-58494（来源: area）
- [smoke] smoke-invariant-1784806023-5054（来源: area）
- [capture-triage] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至（来源: area）
- [capture-triage] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假（来源: area）
- [capture-triage] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注（来源: area）
- [agent-offline-alert] theater_mismatch 检查——contract 中 android 关键词即使在排除列表也会触发，可用 windows_cloud 环境绕过（来源: area）
- [agent-offline-alert] target_environment 从 DB tasks.payload 读取，不从文件读，任务注册时必须正确设置（来源: area）
- [agent-offline-alert] Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]，每条需含 exit_code + log_tail（来源: area）
- [capture-triage] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，（来源: area）
- [capture-triage] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:（来源: area）
- [capture-triage] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else`（来源: area）
- [smoke] smoke-invariant-1784543934-2387（来源: area）
- [capture-triage] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探（来源: area）
- [capture-triage] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因（来源: area）
- [capture-triage] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 j（来源: area）
- [capture-triage] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task shor（来源: area）
- [capture-triage] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（convers（来源: area）
- [[capture] [capture-triage] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错（来源: area）
- [[capture] [capture-triage] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表（来源: area）
- [capture-triage] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消（来源: area）
- [多设备类型(os] 多设备类型(os_type/device_platform)UI区分必须在设计/审查阶段强制检查（来源: area）
- [[capture] [capture-triage] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 gi（来源: area）
- [capture-triage] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-pars（来源: area）
- [capture-triage] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（b（来源: area）
- [capture-triage] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚（来源: area）
- [capture-triage] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用（来源: area）
- [capture-triage] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFi（来源: area）
- [[capture] [capture-triage] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Tes（来源: area）
- [capture-triage] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness（来源: area）
- [[capture] [capture-triage] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code in（来源: area）
- [[capture] [capture-triage] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新（来源: area）
- [capture-triage] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，g（来源: area）
- [capture-triage] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude sessi（来源: area）
- [capture-triage] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 6（来源: area）
- [capture-triage] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml（来源: area）
- [capture-triage] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR（来源: area）
- [smoke] smoke-invariant-1783850042-79911（来源: area）
- [capture-triage] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI（来源: area）
- [capture-triage] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR（来源: area）
- [capture-triage] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d（来源: area）
- [capture-triage] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存（来源: area）
- [capture-triage] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（来源: area）
- [smoke] smoke-invariant-1783693282-93097（来源: area）
- [单 slot 串行任务，] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁止写死环境假设值] 禁止写死环境假设值（来源: area）
- [真环境验证才算done] 真环境验证才算done（来源: area）
- [测试默认多租户] 测试默认多租户（来源: area）
- [凭据安全] 凭据安全（来源: area）
- [日志脱敏] 日志脱敏（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 租户隔离（来源: area）
## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path（payload 无 journey_id，非路径 C 点火，优雅降级） -->
（本 line 暂无历史）

## E2E 验收

> 占位：最终可执行脚本由 proposer 按 target_environment=local_api 产出（curl localhost:5221 + psql cecelia）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl + psql）
# 期望验收点（自然语言）：
# 1. psql 构造场景：上一完整北京日内仅有 1 条 ledger-hygiene 自产 issue atom → 触发探针 → m7 debt+1（自产被排除，正确击穿）
# 2. psql 构造场景：上一完整北京日内有 1 条非自产 atom → 触发探针 → m7 debt=0，无新 issue，ratchet streak 复位
# 3. 真实触发一个 harness_initiative failed 任务的 auto-learning 路径 → psql 查 capture_atoms 有对应记录且 routed_to_table/routed_to_id 非空
# 4. 走 relay PATCH handoff 路径写一条 result.handoff → psql 查 capture_atoms 有对应 handoff 记录
# 5. debt 持平场景 → 生成的 issue 文案不含"上升"字样
# 6. DevGate 三件套通过；修 bug 的 failing→passing regression test 已 commit 进 CI
```

## journey_type: autonomous
## journey_type_reason: 全部改动在 packages/brain 后端探针/登记链路，无 UI、无 engine、无远端 agent 协议
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端，本地 evaluator 用 curl localhost:5221 + psql cecelia 验收
## journey_id: none
## step_id: none（PrepPRD 未锚定）
