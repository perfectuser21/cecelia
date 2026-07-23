# Sprint PRD — Codex Slot 安全硬切换

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：交付 Codex Slot 安全闭环；百分点由 KR 汇总任务统一核算。

## 背景

从 `main` 独立完成 Codex Slot 生产级安全整改，不依赖或合并 #4237–#4242 草稿栈；新 PR 合并后再将这些草稿标记为 superseded。
本 Sprint 的产品法律是：从 main 实现完整 Codex Slot：设备身份映射、自动 slot、公司账号租约、xian-m1/xian-m4 agent、固定美国 mmv exit node、broker 唯一 token issuer、硬切换旧入口、reaper 与真实主机假 token smoke。

## Golden Path（核心场景）

员工从 MacBook Air 或同事设备经受控 SSH 身份进入 → 系统自动选择安全可用的西安 agent 与 slot → broker 独占完成账号租约和 token 投递 → agent 在固定美国 `mmv` 出口下启动 Codex → reaper 精确维护生命周期 → 停止后安全释放。

具体：
1. 服务器依据有效 UID 或受控设备 SSH key 映射 actor；客户端声明、环境变量和自报 host 均不能改变身份。
2. client 查询 xian-m1/xian-m4 的身份、出口、新鲜容量，只从全部校验通过且有余量的同级 agent 自动选择 slot；resume 使用可读 session handle。
3. broker 在 rollout gate 允许时选择唯一未占用公司账号，先 durable write 租约与 session，再确认 acquire。
4. agent 在主机锁内 prepare worktree、私有目录和一次性 nonce，并以 root 管理配置声明真实主机身份与 slot 上限。
5. broker 作为唯一 token issuer，经固定 SSH 配置和 stdin 投递有限长度 auth snapshot；agent 写盘前实时验证固定 `mmv` stable node ID、peer、IP、在线与 backend 状态。
6. agent 仅在验证通过后以 `0600` durable write auth；launch 前再次验证 `mmv`，失败即删除暂存 auth 并拒绝启动。
7. client 对丢响应或未知结果执行精确 status/readback；不能证明安全时隔离租约，不自行推断成功、停止或释放。
8. reaper 每分钟以 broker registry 为唯一状态源核对 agent/tmux：alive heartbeat、明确 stopped release、unreachable/mismatch/unknown quarantine。
9. rollout 从 `frozen` 经存量盘点和 blocking lease 进入 `inventory_complete`；旧 `codex-request` 等直接入口禁用且验证不可写 auth 后，才原子切换到 `broker_only`。
10. xian-m1 与 xian-m4 分别用专用假 auth fixture 完成 prepare→deliver→launch→status→stop→release smoke，且结束后无秘密或资源残留。

## 边界情况

- 旧会话归属不明、主机不可达、SSH 响应丢失或 agent 回应不完整：只隔离，不自动释放。
- `mmv` 主机名相符但 stable node ID/peer/IP/backend 任一不符、超时或采样过期：fail closed。
- 容量字段缺失、为零、锁失败、目录未知或健康结果过期：该 agent 不可选。
- durable write 任一步失败：不得确认成功，不得产生双租约或部分开放 rollout。
- broker 重启或 reaper 重跑：租约/session 可恢复，状态转换保持幂等且审计不泄密。

## 范围限定

**在范围内**：设备身份映射、自动 slot、公司账号唯一租约、xian-m1/xian-m4 agent、固定美国 `mmv` 校验、broker 唯一 token 发放、durable state、旧入口一次性硬切换、reaper、安装运维、单元/进程/集成测试与假 token 真机 smoke。

**不在范围内**：长期双轨兼容旧 token 入口、按主机名自动学习 `mmv`、不可达时自动释放、真实公司 token 测试、公司账号计费策略重做、直接合并 #4237–#4242。

## 假设

- [ASSUMPTION: payload 明确指定 `target_environment=local_api`，因此主验收由本地 evaluator 编排；xian-m1/xian-m4 真实接缝仍必须分别留证后才能判 done。]
- [ASSUMPTION: 本 Sprint 按 task payload 的 anchor 锚定 `codex-slot-company-access` Journey、`secure-slot-lifecycle` Step 与 `broker-only-token-delivery` Golden Path。]
- [ASSUMPTION: `mmv` 的允许 stable node ID/IP、身份映射和 agent root 配置由部署时的受控配置提供，不在 PRD 中写死具体值。]

## 预期受影响范围

- Codex Slot broker：租约、session、rollout、audit、唯一 token 投递与 reaper。
- xian-m1/xian-m4 agent：受控身份、容量、prepare/accept-auth/launch/status/cleanup。
- client 与旧入口：自动 host/slot 选择、session handle、`codex-request` 硬切换提示。
- 安装与测试资产：broker/agent/client 角色安装、定时任务、Bash 3.2/现代 Bash、进程/集成/真机 smoke。

## NFR 约束

<!-- 来源: PrepPRD 显式约束优先；decisions category=nfr 两个副源均为空 -->
- 安全：测试、CI、fixture、日志和审计不得使用或暴露真实公司 token、prompt、完整 auth JSON、完整环境变量或 PII。
- 身份与授权：actor、agent 身份、host 白名单和 `mmv` 信任根只能来自服务器/root 受控配置；客户端输入不得提升权限。
- 一致性：公司账号同一时刻最多一个 active/quarantined/blocking lease；成功确认前 registry/session 必须完成临时文件 `0600`、fsync、原子 rename、父目录 fsync。
- 失效保护：身份、容量、出口、SSH、readback 或状态不明确时一律拒绝/隔离；不得以 TTL 单独释放可能仍在运行的账号。
- 时效：reaper 每分钟运行；出口采样必须无超时且在允许的新鲜度内，具体预算由 Proposer 锚定受控配置与测试合同。
- 兼容：安装器与测试同时通过 macOS Bash 3.2 和现代 Bash；空数组走显式零参数分支。
- 可观测：durable audit 仅记录批准的非秘密元数据；每个失败结果给出 sanitized reason，真实主机接缝未验证只能标 `logic-done-pending`。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 decision id 合并去重；本任务仅 area 源有数据 -->
- [冒烟铁律] smoke 铁律（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [测试如果全部] learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测 [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测不出来（来源: area）
- [涉及"周期性] learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的 [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的问题（来源: area）
- [跨模块的"时] learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测 [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测试覆盖到——本次这个 bug 潜伏在 3 个独立 Task 的接缝处，任何单个 Task 的测试都测不出来，只有对整个分支做"跨任务组合"审查的最后一轮才抓到（来源: area）
- [theate] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area）
- [target] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）
- [Brain ] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [DB 表字段] learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工 [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工作模式里，不是边缘 case（来源: area）
- [复活/重做一] learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit message 的一句话总结——本次靠这个方法把"死因不明的历史教训"变成了"可复现、可规避的具体 bug 模式"（来源: area）
- [调用任何"失] learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见 [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（`pushCapture`/`claimDedupeKey` 等），review 时应主动搜索"这个函数会不会抛异常"再判断调用方的错误处理是否对得上（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [journe] learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检 journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [harnes] learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 判定 task 完成，应校验 pr_merged_at/notion_synced_at 等 report 产出物是否真的写入（来源: area）
- [contra] learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [headed] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub 反查双双失明（pr_not_found 拒绝 completed）（来源: area）
- [退役判断依据] learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留） [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [catch ] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [表名认领冲突] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [新增后台 j] learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者） [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [多设备类型(] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性扫描找同类'字段有但下游UI未接线'模式。（来源: area）
- [同一语义（如] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [git re] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量 [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [smoke/] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子 [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子逐个显式设，跳过项列在 smoke 头注释（来源: area）
- [部署链任何失] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸 [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸死 set -e 脚本）（来源: area）
- [判变基准永远] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱 [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [lint-t] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [Test C] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [Red co] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入 Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [回归测试用 ] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [新增 cro] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [harnes] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [headed] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NODE 等），必须在 innerCmd 字符串中显式 export，而非依赖 _spawnHeadedSession 调用方的进程环境。（来源: area）
- [Propos] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area）
- [给 harn] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享判定文件未经合同显式授权不可修改），遇到自身改动触发 CI 红时必须另开独立 sprint 走 GAN 流程（来源: area）
- [PR 被 s] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合 PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合并 sha 一致，确认无代码漂移后才能在报告中标注流程完整性未受损（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [feat+b] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红 [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [新 task] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher cap+lock+bridge 三防线（来源: area）
- [服务"该活着] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a） [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [本机（美国 ] learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator`（bridge 先例）（来源: area）
- [新增常驻宿主] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTEN_PORTS）（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [单 slot] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出，但动手写代码的实现者同一时刻永远只有一个（与 subagent-driven 的禁并行实现者规则一致，防多写手改冲同一文件）。分水岭不是 agent 数量，是任务状态数量：一个会话里只允许存在一个任务的状态。（来源: area）
- [禁止写死环境] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [真环境验证才] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [测试默认多租] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: payload.anchor.journey_id=codex-slot-company-access；该 line 当前无已完成/working ability 历史 -->
- （本 line 暂无历史）

## E2E 验收

- actor 伪造、host 自报、错误 stable node ID、出口切换、缺失容量、SSH 未知结果均 fail closed。
- acquire→prepare→accept-auth→launch→status→stop→release 通过真实 stdin、agent 进程、tmux 与 git worktree 串通。
- broker 重启及 durable write 各故障点后，仍满足单账号单租约且状态可恢复。
- rollout 在存量盘点前不发新租约；旧入口禁用验证通过前不得进入 `broker_only`。
- reaper 对 alive/missing/unreachable/mismatch 分别产生 heartbeat/release/quarantine/quarantine。
- xian-m1、xian-m4 各自用专用假 auth fixture 完成真机 smoke，并确认固定美国 `mmv` 与零 auth/tmux/worktree/lease 残留。
- 全部安全测试、CI、独立代码复审与真机接缝留证通过后，PR 才能从 Draft 转 Ready。

```bash
# 占位：proposer 按 local_api 生成本地编排脚本，并把 xian-m1/xian-m4 假 token 真机 smoke 作为接缝验收。
```

## journey_type: agent_remote
## journey_type_reason: 核心链路涉及 client、broker 与 xian-m1/xian-m4 远端 agent 的 SSH 协议、身份和生命周期。
## target_environment: local_api
## target_environment_reason: task payload 明确指定 local_api，由本地 evaluator 编排；远端 xian 主机接缝另行真验留证。
## journey_id: codex-slot-company-access
## step_id: secure-slot-lifecycle
## gp_id: broker-only-token-delivery
