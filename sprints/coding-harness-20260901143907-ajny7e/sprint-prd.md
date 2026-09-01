# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: bc14a97ec00d82e50fd85b14ab035098cf345c44da0e5a8afd2ed679cb2e1346

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可查阅操作契约，不承诺改变 KR 百分比

## 背景

为宿主和远端调用方提供一页中文《attempt-run 桥接使用说明》，让调用者能正确发起、查询并理解失败回滚。权威实现基线固定为 `perfectuser21/cecelia@5599211397c88c3827d5ce4e9c6061b3802b4fc5`；本 Sprint 只新增文档，不改变运行行为。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下的《attempt-run 桥接使用说明》进入 → 按文档鉴权并用 `POST /api/brain/harness/attempt-run` 发起运行 → 用 `GET /api/brain/harness/attempt-run/:id` 查询状态 → 能判断成功派发或 `run→failed/session→closed/task→cancelled` 的失败回滚出口。

具体：
1. 文档分别说明 POST 发起端点和 GET 查询端点的用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档逐项列出服务端允许的九项角色白名单，并明确白名单外角色不在支持范围。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败会依次形成 `run→failed/session→closed/task→cancelled`，使调用方能识别完整回滚结果。

## 边界情况

- 区分本机 loopback 与宿主/远端鉴权要求，避免把 loopback 例外误写成远端免鉴权。
- 区分 payload 必填字段与可省略的 `base_sha`，不得把后者写成必填。
- 九项角色的名称与数量必须和固定实现基线一致；不得自行发明别名。
- 回滚状态和顺序必须完整，不得只描述 run 失败而遗漏 session/task 收口。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段和派发失败回滚。
**不在范围内**：不修改任何代码、测试、接口、鉴权、角色白名单、数据库结构或运行行为；不改动 `docs/current/` 外文件。

## 假设

- [ASSUMPTION: 文档文件名采用 `docs/current/attempt-run-bridge-guide.md`；标题必须为《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 九项角色的精确名称由 Proposer 以固定实现基线中的既有白名单断言为唯一真相生成，Planner 不引入未由 task payload 提供的角色名。]
- [ASSUMPTION: payload 未配置 `journey_id` 或可用 Golden Path step 锚点，故元数据分别记为 none 与 none（PrepPRD 未锚定）。]
- [ASSUMPTION: Unified Map 未配置（`map_scope` 为空且 `map_repo` 缺失），不进行领域结构猜测。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文《attempt-run 桥接使用说明》；这是唯一允许的交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 内容必须对应实现基线 `5599211397c88c3827d5ce4e9c6061b3802b4fc5`
- 可观测: 文档必须明确 GET 查询状态及完整失败回滚链
- 安全: 不得记录或示例化真实 `CECELIA_INTERNAL_TOKEN` 值

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [handoff: fix] handoff: fix(kernel): PR 与 main 冲突(DIRTY)路由 generator-fix rebase，根除死等/判死 [r84] verdict=PASS 完成: Provider-neutral Harness gates passed and PR merged. 下一步: 完成，无下一步（来源: area）
- [learning: 多人] learning: 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权 徐啸的纠正指出：在处理飞书、钉钉等多账号系统的集成时，如果要代表某个团队成员操作其资源，必须使用那个人的授权（App ID/Secret（来源: area）
- [learning: [ ] learning: [ ] nightly-red issue 自动化文案：连续 ≥3 晚同一 job 红时，把失败 step 的最后 20 行原始 stdout（不是 PowerShell `Write-Error` 截断后的）贴进 issue，避免"No [ ] nightly-red issue 自动化文案：连续 ≥3 晚同一 job 红时，把失…（来源: area）
- [learning: [x] learning: [x] 守卫：`lint-nightly-sparse-checkout-deps.sh` 机械对账"脚本 `os.path.join(_HERE, ...)` 依赖目录 ⊆ 该 job sparse 列表"，接进 ci-l1 requir [x] 守卫：`lint-nightly-sparse-checkout-deps.sh` …（来源: area）
- [generator_in] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix。（来源: area）
- [planner_role] Planner workspace must start on the exact server-owned planner_branch; Provider may validate but must not checkout or switch branches.（来源: area）
- [learning: [ ] learning: [ ] 每次改注入/启动路径必须在 4号机（rog 192.168.1.96:5555，e2e 包 `DEBUG_E2E scan` 广播）跑后台冷启动探针 ≥3 次，修前红修后绿才算数。 [ ] 每次改注入/启动路径必须在 4号机（rog 192.168.1.96:5555，e2e 包 `DEBUG_E2E scan` 广播）跑后…（来源: area）
- [learning: [ ] learning: [ ] 读 logcat 判根因时，`targets O+, restricted` 一类 ActivityManager 信息日志先查其语义（广播/进程限制），别直接对号入座到自己怀疑的模块。 [ ] 读 logcat 判根因时，`targets O+, restricted` 一类 ActivityManager 信息日志先查其…（来源: area）
- [Fleet Genera] 本地 Dispatcher 与 Fleet Worker 必须同时注入服务端权威 HARNESS_BRAIN_URL；Generator 仅在通用 BRAIN_URL 缺失时从该变量恢复，预检仍 fail-closed，禁止手工为单个 Attempt 绕过。（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [Kernel exist] 保留 validation_clock_required 默认 fail-closed。仅 gear=hotfix 且 payload 显式 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时，首个 Evaluator intent 可建立一次共享 validation clock；后续 Judge 复用。缺失或不一致一律拒绝。（来源: area）
- [learning: ju] learning: judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证轮（behavior_tests 扩容）而非改代码，避免对正确实现无谓返工 judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走…（来源: area）
- [learning: 合同] learning: 合同里的验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 1，写进合同前先跑一次 合同里的验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 1，写进合同前先跑一次（来源: area）
- [learning: ju] learning: judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result.json 必须把一手证据（root-cause 输出、Red→Green 时序、exit_code 字段）排序进窗口前列，否则会因证 judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain…（来源: area）
- [learning: 指标] learning: 指标口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理：m2 欠账 +5 实为冒烟噪声，真库 debt 462→288-290 指标口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理：m2 欠账 +5 实为冒烟噪声，真库 debt 462→288-290（来源: area）
- [learning: 毕业] learning: 毕业步与 canonical 不可变 lint 存在结构性矛盾，涉 canonical 文件的收尾 commit 前先核对不可变清单（issue 8d2a9ff2） 毕业步与 canonical 不可变 lint 存在结构性矛盾，涉 canonical 文件的收尾 commit 前先核对不可变清单（issue 8d2a9ff2）（来源: area）
- [learning: co] learning: controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo 造成跨任务污染（issue 78016a5f） controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo…（来源: area）
- [learning: ju] learning: judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁：此类任务需在合同预先声明验证真相形态或对闸⑤放行（issue 0f586765） judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁：此类…（来源: area）
- [learning: De] learning: Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障（非 required check），功能 PR 遇到时应确认既有性并单独立案，不在功能 PR 里追修 Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故…（来源: area）
- [learning: 高频] learning: 高频合并 repo（如 cecelia）上 update-branch 后应立即挂 gh pr merge --auto 抢竞态，避免反复 BEHIND re-anchor 高频合并 repo（如 cecelia）上 update-branch 后应立即挂 gh pr merge --auto 抢竞态，避免反复 BEHIND re-…（来源: area）
- [learning: he] learning: headed 前台点火任务必须在点火时用 Brain 同款 jsonb merge 把 worktree_path 写进 task payload，且路径必须在受控 Harness 根目录（DEFAULT_BASE_REPO/.claude headed 前台点火任务必须在点火时用 Brain 同款 jsonb merge 把 wo…（来源: area）
- [learning: wa] learning: watchdog 对『从未启动的进程』必须走 never_started 分类兜底且不覆盖已有 error_message/failure_class，防止 process_disappeared→liveness_dead 假标签污染 u watchdog 对『从未启动的进程』必须走 never_started 分类兜底且不覆盖已…（来源: area）
- [learning: re] learning: relay 单session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写 node 级 done 事件并推进 run.phase，否则 finalize 收账闸报 no_e relay 单session 模式必须在各 phase 完成时调 POST /api/bra…（来源: area）
- [learning: PR] learning: PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge main 解冲突再等 CI PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge main 解冲突再等 CI（来源: area）
- [learning: ca] learning: capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 open 任务时合并而非裂变新单（实证：a6e6afc7 与 78e812c0 同 m7 探针双修复撞车，合流成本 5 轮 CI fix 中占 2 capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 o…（来源: area）
- [learning: 守卫] learning: 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染（来源: area）
- [learning: 探针] learning: 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计（来源: area）
- [learning: ev] learning: evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证导致首跑 FAIL evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证导致首跑 FAIL（来源: area）
- [learning: co] learning: cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层交叉验证兜底，但需在 cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本…（来源: area）
- [learning: 冒烟] learning: 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染（来源: area）
- [learning: pr] learning: proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈） proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_i…（来源: area）
- [learning: co] learning: contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点 contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查…（来源: area）
- [learning: wa] learning: watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功） watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相…（来源: area）
- [learning: 通知] learning: 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证） 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/…（来源: area）
- [learning: de] learning: dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单 dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm …（来源: area）
- [learning: he] learning: headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断 headed relay session 在长 CI 等待循环中应周期性 PATCH rel…（来源: area）
- [learning: 毕业] learning: 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与…（来源: area）
- [learning: 合同] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [learning: ma] learning: manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。 manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion fa…（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [learning: [ ] learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测 [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 senti…（来源: area）
- [learning: [ ] learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的 [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API）…（来源: area）
- [learning: [ ] learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测 [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小…（来源: area）
- [learning: th] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area）
- [learning: ta] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）
- [learning: Br] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [learning: [ ] learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工 [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长…（来源: area）
- [learning: [ ] learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=…（来源: area）
- [learning: [ ] learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见 [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `…（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [learning: jo] learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检 journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [learning: ha] learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 harness-controller relay 容器可能在 Step 6(merge) 后异…（来源: area）
- [learning: co] learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge …（来源: area）
- [learning: he] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub headed relay 点火时必须把 base_repo 或 pr_url 写入 task …（来源: area）
- [learning: [ ] learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留） [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（c…（来源: area）
- [learning: [ ] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [learning: [ ] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [learning: [ ] learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者） [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [多设备类型(os_typ] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统…（来源: area）
- [learning: [ ] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [learning: [ ] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量 [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [learning: [ ] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子 [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT…（来源: area）
- [learning: [ ] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸 [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark +…（来源: area）
- [learning: [ ] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱 [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 ori…（来源: area）
- [learning: li] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [learning: Te] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [learning: Re] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入 Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [learning: 回归] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [learning: 新增] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [learning: ha] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 con…（来源: area）
- [learning: he] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父…（来源: area）
- [learning: Pr] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历…（来源: area）
- [learning: 给 ] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则…（来源: area）
- [learning: PR] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合 PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluato…（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [learning: [ ] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红 [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [learning: [ ] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router…（来源: area）
- [learning: [ ] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a） [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [learning: [ ] learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAge…（来源: area）
- [learning: [ ] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launc…（来源: area）
- [smoke-invari] smoke 铁律（来源: area）
- [单 slot 串行任务，] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查…（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

最终验收由测试文件机械覆盖，最多八条断言：

1. `docs/current/attempt-run-bridge-guide.md` 存在，正文包含中文且标题为《attempt-run 桥接使用说明》。
2. 文档同时包含 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id`，并分别说明发起和查询用途。
3. 文档包含 `internalAuthOrLoopback`、`Bearer CECELIA_INTERNAL_TOKEN`，并明确宿主/远端必须携带 Bearer。
4. 文档有独立“角色白名单”章节，逐项列出且恰好九项；名称逐项匹配固定实现基线中的服务端白名单。
5. 文档有独立“payload 必填字段”章节，包含 `sprint_dir`、`base_repo`、`branch`，并说明 `base_sha` 可省略且由生产 Brain 自解析。
6. 文档有独立“派发失败自动回滚”章节，并按顺序包含 `run→failed/session→closed/task→cancelled`。
7. 变更文件集合严格等于新增文档文件；任何代码、测试或其他文件变化均判失败。

```bash
# 占位：proposer 将按 target_environment 产出可执行的文档契约测试。
# 期望验收点：测试文件对上述七条断言逐项检查，并将工作树变更范围与实现基线比对。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 内部 Harness API 的操作说明文档，不包含用户界面流程或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档契约测试在该角色签发环境执行。
## journey_id: none
## step_id: none（PrepPRD 未锚定）

