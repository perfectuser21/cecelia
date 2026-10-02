# Sprint PRD — 修复统一能力系统实施中的Fleet终态清理503
## 合同与证据
- 本次仅执行 planner；run_id=93d42a9a-c26f-4f8c-824a-3b5868b9cece，attempt_id=ae1f85a0-4549-4e0e-b39f-949c48facff2。
- implementation_baseline: perfectuser21/cecelia@d796960828aec166ad022f9aa394ef16472b751d；全角色与 GAN 轮次冻结，不以 checkout/main 替换。
- planner_branch: cp-harness-prd-079c8ff4-r93d42a9a-a11；review_required: false；仅交付本文件。
- 输入由任务 API 核验：079c8ff4-0568-4ea6-90cb-4f360caba1ee；thin_prd 与提供证据一致。
- 原故障：run 15821014-0539-4a69-b248-3efd89b7f276 / attempt 6a458ffe-c63c-478e-9539-a12fe878fbe6，隔离 PG 正常、清理 503 三次；runs API 确认 blocked_by_cleanup_pool_wiring。
- 用户批准记录引用 f0255442-9f66-4dd0-8903-b4a97f39f3ea；父项目 f0ea54ee-b439-4f95-9db9-4da202c3c487；本轮未重写决策。
## OKR 对齐
- context 返回 O3 公司自转进度 4%；任务无明确 KR，不捏造 KR 或增量；本次消除统一能力系统的前置故障。
## Golden Path（核心场景）
1. 真实 Fleet PG 角色完成工作并提交合法终态回调，进入 Fleet终态清理503 的既有故障路径。
2. 服务启动构造的生产 transport 获得数据库 pool，回调与后台 cleanup 均可完成既有清理协议，不再因 execution_directory_database_required 失败。
3. 清理得到 verified cleaned/already_clean，权威记录正式 completed；重复清理维持幂等，失败仍返回 503，错误 receipt 仍被拒绝。
## 范围限定
- 业务实现仅 server.js 中 createProductionExecutionTransport factory 传入既有 pool；证据指向 server.js:152、transport-authority.js:5、callback:931；行号仅为输入证据。
- run.js/watchdog 已正确传 pool；不改授权、清理回执、DB schema、租户/登录体系，不扩大为统一能力系统功能建设。
- NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；仅受控开发 checkout 允许最小修复，不直接编辑部署中的生产源码。
## 边界情况
- 清理异常：维持 503，不能吞错或提前 completed；伪造/错配 receipt：拒绝且不得写成功状态。
- 重复合法回调与后台重试：仅接受身份一致的 verified cleaned/already_clean，不以进程退出或任务登记替代清理成功。
## 假设与风险
- [ASSUMPTION: 任务描述 hotfix-v1/phase=generate 与本次 planning 合同不一致；runs API 当前返回 planning。本角色仅交付规划证据，不改 phase，不派发其他角色；后续由控制器按最新 snapshot 路由 Generate→Evaluate→Judge。]
- [ASSUMPTION: map_scope=[F1] 但 map_repo 缺失，Unified Map 未配置；不得猜测 repo 映射。]
- [ASSUMPTION: step_id 未锚定；ability_id 为空，feature NFR/invariant 不适用；步骤 NFR/invariant 与 journey golden-paths 返回 HTTP 410，历史覆盖未知，不能记成已确认无历史。]
- [ASSUMPTION: 本缺陷 RED 为纯单元依赖注入，无真实 PG 业务 RED 前提；真实 PG 回调仍是恢复验收必需证据。]
## 预期受影响文件
- `packages/brain/server.js`：唯一业务改动位置（输入所指 server.js）；Generator 在冻结基线核实实际位置，存在歧义先报告，不扩范围。
- `attempt-cleanup-server-wiring.test.js`：永久回归测试，路径由 Generator 在既有测试目录核实或创建；执行真实初始化片段并 mock factory，断言同一 pool 对象传入。
- 既有清理/回调行为测试：覆盖失败 503、错误 receipt 拒绝、合法与重复清理、后台 cleanup。
- 版本与 `DEFINITION.md`：按既有同步规则更新；本 Planner 不改代码、测试、版本或 CI 文件。
## 验收标准（DoD）
- D1：永久测试先提交；在冻结基线执行因 pool 缺失的断言失败，记录命令、退出码、原始断言与 RED commit；依赖缺失/零测试不算 RED。
- D2：后续独立实现 commit 仅补 pool 依赖，原测试转绿且验证对象身份，不复制一份假初始化逻辑作为被测对象。
- D3：回调及后台 cleanup 回归为绿；异常清理保留 503，错误 receipt 不可产生 completed，重复合法清理幂等。
- D4：永久测试被正常 CI 收集；DevGate、版本同步、PR 必需检查与 Evaluate/Judge 全部通过，禁止直推 main 或 admin merge。
- D5：部署版本与验收 SHA 一致；真实 Fleet PG 角色回调有 verified cleaned/already_clean，权威任务/attempt 记录正式 completed，清理资源实际消失或已不存在。
- D6：证据记录 actor、run/attempt、SHA、结果；Commander evidence_refs 仅 event:<整数>/attempt:<UUID>；登记任务不算完成。
## NFR 约束
- 超时/频控：PrepPRD 未指定业务数值，不新增指标；下述命令预算仅为验收停止条件。
- 兼容与安全：维持授权与 receipt 校验；凭据不入 git/日志；不新增租户机制。
- NFR 副源查询 HTTP 410；feature 无 ability_id；仅使用明确的 PrepPRD 约束，历史 NFR 未确认。
## Invariant 约束（铁律，proposer/evaluator 不得违反）
- [历史约束] learning: [ ] dashboard 新页三件套缺一不可：navigation 组件映射+菜单项+InstanceContext features 表（漏最后一个=菜单静默不显示）。 [ ] dashboard 新页三件套缺一不可：navigation 组件映射+菜单项+InstanceContext features 表（漏最后一个=菜单静默不显示）。（来源: area；decision_id=d7e2d132-a957-489e-8613-52b08e7288af）
- [历史约束] learning: [ ] 枚举语义常量（非终态集合）只允许一份，落在被各消费方共同 import 的 service；手抄同值副本=H-3 类 sweep 的隐形炸弹。 [ ] 枚举语义常量（非终态集合）只允许一份，落在被各消费方共同 import 的 service；手抄同值副本=H-3 类 sweep 的隐形炸弹。（来源: area；decision_id=76cb816c-73df-45b6-b2eb-eb18568bd8b5）
- [历史约束] learning: [ ] "SELECT 判态再 UPDATE" 的幂等一律升级为 UPDATE ... WHERE status=ANY(非终态) 的 CAS——超时重试就是并发的标准形态，串行幂等防不住。 [ ] "SELECT 判态再 UPDATE" 的幂等一律升级为 UPDATE ... WHERE status=ANY(非终态) 的 CAS——超时重试就是并发的标准形态，串行幂等防不住。（来源: area；decision_id=761f242b-b248-4c6b-8921-0f1c56dfe411）
- [历史约束] learning: [ ] jsonb `||` 是浅合并：往任务 result 里塞回执要用固定子键（receipt），不覆盖发布包 payload。 [ ] jsonb `||` 是浅合并：往任务 result 里塞回执要用固定子键（receipt），不覆盖发布包 payload。（来源: area；decision_id=55f0d846-7d42-41bd-8bb1-69d5a6f60490）
- [历史约束] handoff: fix(kernel): PR 与 main 冲突(DIRTY)路由 generator-fix rebase，根除死等/判死 [r84] verdict=PASS 完成: Provider-neutral Harness gates passed and PR merged. 下一步: 完成，无下一步（来源: area；decision_id=3ecd7ffa-4cf3-4bc1-bd8e-8980ec2619ea）
- [历史约束] learning: 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权 徐啸的纠正指出：在处理飞书、钉钉等多账号系统的集成时，如果要代表某个团队成员操作其资源，必须使用那个人的授权（App ID/Secret （来源: area；decision_id=848aeef2-f930-4379-8408-61cab34432b3）
- [历史约束] learning: [ ] nightly-red issue 自动化文案：连续 ≥3 晚同一 job 红时，把失败 step 的最后 20 行原始 stdout（不是 PowerShell `Write-Error` 截断后的）贴进 issue，避免"No  [ ] nightly-red issue 自动化文案：连续 ≥3 晚同一 job 红时，把失败 step 的最后 20 行原始 stdout（不是 PowerShell `Write-Error` 截断后的）贴进 issue，避免"No mo"这种残缺报错让人放弃归因。（来源: area；decision_id=7a4ccb09-e45a-4ccd-8889-5d6676c5be65）
- [历史约束] learning: [x] 守卫：`lint-nightly-sparse-checkout-deps.sh` 机械对账"脚本 `os.path.join(_HERE, ...)` 依赖目录 ⊆ 该 job sparse 列表"，接进 ci-l1 requir [x] 守卫：`lint-nightly-sparse-checkout-deps.sh` 机械对账"脚本 `os.path.join(_HERE, ...)` 依赖目录 ⊆ 该 job sparse 列表"，接进 ci-l1 required gate；含变异测试（单/双引号、`|-` 块标量、守卫解析不到时自报红）——守卫失明必须报红而不是放行。（来源: area；decision_id=b8091f6c-62e6-403c-afdd-1085bd7f1f52）
- [历史约束] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix。（来源: area；decision_id=53f23a09-16bf-4073-93de-c4166cdab3c6）
- [planner_role_branch] Planner workspace must start on the exact server-owned planner_branch; Provider may validate but must not checkout or switch branches.（来源: area；decision_id=ae95068e-1576-454a-9675-9de4f0bffa38）
- [历史约束] learning: [ ] 每次改注入/启动路径必须在 4号机（rog 192.168.1.96:5555，e2e 包 `DEBUG_E2E scan` 广播）跑后台冷启动探针 ≥3 次，修前红修后绿才算数。 [ ] 每次改注入/启动路径必须在 4号机（rog 192.168.1.96:5555，e2e 包 `DEBUG_E2E scan` 广播）跑后台冷启动探针 ≥3 次，修前红修后绿才算数。（来源: area；decision_id=f7f63417-1814-4933-8473-74364d4e1f42）
- [历史约束] learning: [ ] 读 logcat 判根因时，`targets O+, restricted` 一类 ActivityManager 信息日志先查其语义（广播/进程限制），别直接对号入座到自己怀疑的模块。 [ ] 读 logcat 判根因时，`targets O+, restricted` 一类 ActivityManager 信息日志先查其语义（广播/进程限制），别直接对号入座到自己怀疑的模块。（来源: area；decision_id=c5438d6c-c247-4c6d-b72e-d6841dc530d1）
- [历史约束] 本地 Dispatcher 与 Fleet Worker 必须同时注入服务端权威 HARNESS_BRAIN_URL；Generator 仅在通用 BRAIN_URL 缺失时从该变量恢复，预检仍 fail-closed，禁止手工为单个 Attempt 绕过。（来源: area；decision_id=39624ab8-b14e-4a51-bceb-f068297b3f19）
- [历史约束] smoke 铁律（来源: area；decision_id=0e030008-d299-42a2-a7f1-c4cfe8bd8c96）
- [历史约束] 保留 validation_clock_required 默认 fail-closed。仅 gear=hotfix 且 payload 显式 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时，首个 Evaluator intent 可建立一次共享 validation clock；后续 Judge 复用。缺失或不一致一律拒绝。（来源: area；decision_id=ddca7267-7e76-4e80-a537-7a610a4e71e4）
- [历史约束] learning: judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证轮（behavior_tests 扩容）而非改代码，避免对正确实现无谓返工 judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证轮（behavior_tests 扩容）而非改代码，避免对正确实现无谓返工（来源: area；decision_id=42d6c346-4c01-4c89-884c-57a72d334700）
- [历史约束] learning: 合同里的验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 1，写进合同前先跑一次 合同里的验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 1，写进合同前先跑一次（来源: area；decision_id=c906dd6c-724c-435e-9cc5-fa1d5bff4486）
- [历史约束] learning: judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result.json 必须把一手证据（root-cause 输出、Red→Green 时序、exit_code 字段）排序进窗口前列，否则会因证 judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result.json 必须把一手证据（root-cause 输出、Red→Green 时序、exit_code 字段）排序进窗口前列，否则会因证据截断被误打回（来源: area；decision_id=a39272f7-12ce-403d-a82f-a6d1f5b7e9e6）
- [历史约束] learning: 指标口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理：m2 欠账 +5 实为冒烟噪声，真库 debt 462→288-290 指标口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理：m2 欠账 +5 实为冒烟噪声，真库 debt 462→288-290（来源: area；decision_id=ff1895e3-b4f5-47db-944e-b9218d1e296d）
- [历史约束] learning: 毕业步与 canonical 不可变 lint 存在结构性矛盾，涉 canonical 文件的收尾 commit 前先核对不可变清单（issue 8d2a9ff2） 毕业步与 canonical 不可变 lint 存在结构性矛盾，涉 canonical 文件的收尾 commit 前先核对不可变清单（issue 8d2a9ff2）（来源: area；decision_id=a9aca4b2-d396-4adf-babe-5e2443605b64）
- [历史约束] learning: controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo 造成跨任务污染（issue 78016a5f） controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo 造成跨任务污染（issue 78016a5f）（来源: area；decision_id=933701a3-5768-4eb5-8342-8bad79f646d5）
- [历史约束] learning: judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁：此类任务需在合同预先声明验证真相形态或对闸⑤放行（issue 0f586765） judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁：此类任务需在合同预先声明验证真相形态或对闸⑤放行（issue 0f586765）（来源: area；decision_id=a0bac43b-6b9a-4c26-9356-03ee979d6844）
- [历史约束] learning: Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障（非 required check），功能 PR 遇到时应确认既有性并单独立案，不在功能 PR 里追修 Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障（非 required check），功能 PR 遇到时应确认既有性并单独立案，不在功能 PR 里追修（来源: area；decision_id=909ce765-d91e-4695-a0dc-ba5663267806）
- [历史约束] learning: 高频合并 repo（如 cecelia）上 update-branch 后应立即挂 gh pr merge --auto 抢竞态，避免反复 BEHIND re-anchor 高频合并 repo（如 cecelia）上 update-branch 后应立即挂 gh pr merge --auto 抢竞态，避免反复 BEHIND re-anchor（来源: area；decision_id=91ee7d53-1faf-428d-9e04-b87c5ea1310f）
- [历史约束] learning: headed 前台点火任务必须在点火时用 Brain 同款 jsonb merge 把 worktree_path 写进 task payload，且路径必须在受控 Harness 根目录（DEFAULT_BASE_REPO/.claude headed 前台点火任务必须在点火时用 Brain 同款 jsonb merge 把 worktree_path 写进 task payload，且路径必须在受控 Harness 根目录（DEFAULT_BASE_REPO/.claude/worktrees/harness-v2/）内，否则 judge API 会因 filesystem authority mismatch 返回 409（来源: area；decision_id=17722a93-f9bc-4d2c-bcd4-ab6b6f2af89e）
- [历史约束] learning: watchdog 对『从未启动的进程』必须走 never_started 分类兜底且不覆盖已有 error_message/failure_class，防止 process_disappeared→liveness_dead 假标签污染 u watchdog 对『从未启动的进程』必须走 never_started 分类兜底且不覆盖已有 error_message/failure_class，防止 process_disappeared→liveness_dead 假标签污染 urgent 学习流（来源: area；decision_id=56a0ba9f-7540-488c-bd1f-b13fc6630050）
- [历史约束] learning: relay 单session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写 node 级 done 事件并推进 run.phase，否则 finalize 收账闸报 no_e relay 单session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写 node 级 done 事件并推进 run.phase，否则 finalize 收账闸报 no_evaluator_gate/pr_not_found 降级、harness/complete Dashboard 更新被拒，report 棒被迫手工补账（来源: area；decision_id=c6f9e985-4a4d-4a48-88aa-ceee1cfebd61）
- [历史约束] learning: PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge main 解冲突再等 CI PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge main 解冲突再等 CI（来源: area；decision_id=70bce96e-384f-418c-b2e9-c97a3f78c132）
- [历史约束] learning: capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 open 任务时合并而非裂变新单（实证：a6e6afc7 与 78e812c0 同 m7 探针双修复撞车，合流成本 5 轮 CI fix 中占 2  capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 open 任务时合并而非裂变新单（实证：a6e6afc7 与 78e812c0 同 m7 探针双修复撞车，合流成本 5 轮 CI fix 中占 2 轮）（来源: area；decision_id=81294701-6e35-4738-b28b-40bc5eb477b4）
- [历史约束] learning: 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染（来源: area；decision_id=8078e342-e902-4dba-b4f8-a859fb875b6d）
- [历史约束] learning: 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计（来源: area；decision_id=d736a17d-9087-40ec-b48d-a7e3cf93182d）
- [历史约束] learning: evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证导致首跑 FAIL evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证导致首跑 FAIL（来源: area；decision_id=3b9804e6-b489-48be-99a3-5687732703d1）
- [历史约束] learning: cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层交叉验证兜底，但需在 cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层交叉验证兜底，但需在报告里如实标注为已知覆盖余留，不能算作等价于全链路测试（来源: area；decision_id=dcb1602b-335d-4243-a294-9db508cc5b9f）
- [历史约束] learning: 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染（来源: area；decision_id=f437b0fd-7110-4ecd-abf0-b35adc051dfa）
- [历史约束] learning: proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈） proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈）（来源: area；decision_id=e6513dff-559c-4f4c-b183-2411606fc38f）
- [历史约束] learning: contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点 contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点（来源: area；decision_id=052e10a0-0c53-44a6-af2f-e044f37c6925）
- [历史约束] learning: watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功） watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area；decision_id=636296d4-2271-4957-ac00-058dfd764665）
- [历史约束] learning: 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证） 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area；decision_id=588a76b9-13e9-4085-84e9-a7f87c2fc808）
- [历史约束] learning: dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单 dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area；decision_id=442d9ce8-f776-4336-b31f-67be636699da）
- [历史约束] learning: headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断 headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断裂）（来源: area；decision_id=4284ca38-1d24-48ea-8573-ae44f92e8f6f）
- [历史约束] learning: 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失效）（来源: area；decision_id=46e9afb4-363d-4ee7-9b77-5c18f0ee9ab9）
- [历史约束] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area；decision_id=f200769d-dca0-4cd1-a450-c80b7277c1a7）
- [历史约束] learning: manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。 manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area；decision_id=d9e4f4c1-094d-4c6d-9ce8-cf72e5f78e35）
- [历史约束] smoke 铁律（来源: area；decision_id=6041333c-7467-4c98-9738-4c2179bb43d9）
- [历史约束] smoke 铁律（来源: area；decision_id=a3989e96-30c6-45e8-ad88-7d0dabf382cb）
- [历史约束] learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测 [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测不出来（来源: area；decision_id=b9e7a730-760c-4b9c-9569-db4b5067facb）
- [历史约束] learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的 [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的问题（来源: area；decision_id=e06d4aa2-c9d7-47c7-b824-be34f269aa88）
- [历史约束] learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测 [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测试覆盖到——本次这个 bug 潜伏在 3 个独立 Task 的接缝处，任何单个 Task 的测试都测不出来，只有对整个分支做"跨任务组合"审查的最后一轮才抓到（来源: area；decision_id=394a904a-fff9-4fc9-8da9-7c6fc38bb45d）
- [历史约束] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area；decision_id=be2b7dfe-cdf3-41f4-98b1-ca239e72dc84）
- [历史约束] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area；decision_id=f91cbfc7-c4a2-4abf-8a82-b3171e57867a）
- [历史约束] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area；decision_id=de6a2ee1-1861-4a28-ba76-ecae24d60365）
- [历史约束] learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工 [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工作模式里，不是边缘 case（来源: area；decision_id=d976752e-cf7a-4f96-9a60-1da3ca47784e）
- [历史约束] learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit message 的一句话总结——本次靠这个方法把"死因不明的历史教训"变成了"可复现、可规避的具体 bug 模式"（来源: area；decision_id=6ede438b-8eaf-41be-a759-0372f38267e3）
- [历史约束] learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见 [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（`pushCapture`/`claimDedupeKey` 等），review 时应主动搜索"这个函数会不会抛异常"再判断调用方的错误处理是否对得上（来源: area；decision_id=e9c7752f-de01-4597-b8b8-98dd72d82ee7）
- [历史约束] smoke 铁律（来源: area；decision_id=33ede9f1-0682-48b6-a630-261e1307cf2a）
- [历史约束] learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检 journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area；decision_id=5abda98e-246e-4b61-81a8-e12b19c4c092）
- [历史约束] learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0  harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 判定 task 完成，应校验 pr_merged_at/notion_synced_at 等 report 产出物是否真的写入（来源: area；decision_id=e83b2f0d-eaa5-4cdb-90ca-9d848fad883a）
- [历史约束] learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area；decision_id=9f14c074-a9f4-45e6-9d41-7505c0eaaf72）
- [历史约束] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub  headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub 反查双双失明（pr_not_found 拒绝 completed）（来源: area；decision_id=37e0d7c9-f275-4c0b-8113-ddb757052816）
- [历史约束] learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留） [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area；decision_id=ea7d9c3e-3fe4-4b9a-9222-e522f26e6bb4）
- [历史约束] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area；decision_id=42a4d7c3-d3d9-44ac-b55b-65cd2174ddda）
- [历史约束] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area；decision_id=1676385f-644e-41d2-b6f8-f47038454ef8）
- [历史约束] learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者） [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area；decision_id=1bd4e034-383d-4d53-a928-ee1915b6c16c）
- [历史约束] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性扫描找同类'字段有但下游UI未接线'模式。（来源: area；decision_id=8dbe91ee-708a-4a52-b0f0-96a2efed1194）
- [历史约束] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area；decision_id=113a9330-135e-4b10-bd50-bbafe68eeac5）
- [历史约束] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量 [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area；decision_id=26a1d06e-d34f-4983-a267-bde8157047df）
- [历史约束] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子 [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子逐个显式设，跳过项列在 smoke 头注释（来源: area；decision_id=66f41f70-50ff-4699-b143-7e7380dc7963）
- [历史约束] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸 [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸死 set -e 脚本）（来源: area；decision_id=9202c14e-1dd2-44e9-acdc-99764ce463cd）
- [历史约束] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱 [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area；decision_id=5775d866-07bd-4624-b55c-06424b55199c）
- [历史约束] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area；decision_id=6414193b-18e2-4084-bd80-f6bc29d585e8）
- [历史约束] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area；decision_id=14ed5336-317c-4795-b7f6-10449fa41bc3）
- [历史约束] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入 Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area；decision_id=755fb846-b413-4a4d-8400-63d027b64913）
- [历史约束] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area；decision_id=c674ab49-62db-40ed-b46d-c3619f2d2d0c）
- [历史约束] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area；decision_id=55cb4cb7-c590-47c2-95c3-777432a75979）
- [历史约束] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area；decision_id=e8230eb5-9e2d-4c8c-bf60-3ac9397aa5a1）
- [历史约束] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NODE 等），必须在 innerCmd 字符串中显式 export，而非依赖 _spawnHeadedSession 调用方的进程环境。（来源: area；decision_id=72890f7c-50c6-491d-8586-af80ef3d8a6e）
- [历史约束] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area；decision_id=8d92f7b1-6da0-4b4d-be9c-4d9c39308a79）
- [历史约束] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享判定文件未经合同显式授权不可修改），遇到自身改动触发 CI 红时必须另开独立 sprint 走 GAN 流程（来源: area；decision_id=1100cb8f-a14f-4430-a72d-81d49dc413f7）
- [历史约束] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合 PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合并 sha 一致，确认无代码漂移后才能在报告中标注流程完整性未受损（来源: area；decision_id=26886b60-8a93-45a4-bf96-713524d34df5）
- [历史约束] smoke 铁律（来源: area；decision_id=552520d0-e07d-4592-bfb2-c84101d8b995）
- [历史约束] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红 [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area；decision_id=3efefc23-4622-43b5-a645-6b177484f336）
- [历史约束] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher cap+lock+bridge 三防线（来源: area；decision_id=5b91a042-9fe2-4531-ba9a-c03d2c5c538c）
- [历史约束] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a） [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area；decision_id=365d645a-5cf4-4ba8-9d9f-6d7025706fc3）
- [历史约束] learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator`（bridge 先例）（来源: area；decision_id=02e74e46-e988-48d9-8a3d-0109686c1c20）
- [历史约束] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTEN_PORTS）（来源: area；decision_id=b145c74a-c83a-4b69-b7cb-d07b063d0703）
- [历史约束] smoke 铁律（来源: area；decision_id=4b73376c-63f2-4381-a549-67dcba5e4c64）
- [单 slot 串行任务，并行只许跨 slot] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出，但动手写代码的实现者同一时刻永远只有一个（与 subagent-driven 的禁并行实现者规则一致，防多写手改冲同一文件）。分水岭不是 agent 数量，是任务状态数量：一个会话里只允许存在一个任务的状态。（来源: area；decision_id=7ccfa168-c55f-4172-9bfe-3085319b05d3）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area；decision_id=5e125909-a05b-487f-ba44-00dd4e0bdc2d）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area；decision_id=3c30394c-ee76-4ff9-b087-bafa137e1d75）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area；decision_id=55b8eb46-2b50-4a75-ba96-f84436ba08e8）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area；decision_id=564802ee-cec8-4735-ad23-bfa165127f45）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area；decision_id=459b6ff9-1392-46a5-a33f-9054b6c4b9a2）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area；decision_id=50954d28-8eb7-4148-9e70-3b5eb82f386c）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area；decision_id=68976b17-3f9b-4ffb-9c23-83ae1d2ce4c0）
## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）
（本 line 历史不可确认：golden-paths 端点 HTTP 410；不得将本 sprint 新行为登记为累积 FR。）
## E2E 验收
- 以下是交给 Generator/Evaluator 的执行计划，本轮未执行 RED/GREEN 或部署；L1/L2 单元结果不能替代 L3 恢复证据。
- 编码前在仓库根目录依次执行，每步必须 exit 0，单步预算 120 秒；任一步失败先修复门禁问题：
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```
- RED/GREEN 同一命令如下，预算 180 秒；RED 必须是 pool 缺失断言，GREEN 必须全部通过；Generator 将实际路径和日志回填执行证据：
```bash
set -euo pipefail
cd packages/brain
mapfile -t wiring_tests < <(rg --files -g attempt-cleanup-server-wiring.test.js)
[ "${#wiring_tests[@]}" -eq 1 ]
npx --no-install vitest run "${wiring_tests[0]}"
```
- 行为回归：在既有测试中运行 D3 的四类用例，记录每条测试名与退出码；受影响测试及仓库 required CI 全绿才能合并，不删除 RED 测试。
- L3：通过既有调度路径创建/运行真实 Fleet PG 角色；预算 300 秒，采集合法回调、清理回执与权威终态，以及相同 attempt 的 PG/工作区资源清理结果。
- L3 操作须由 Evaluator 按现有调度/API 协议执行；本证据未提供精确派发请求和终态字段路径，禁止捏造 curl/SQL。缺少机器可执行脚本时不能宣告 L3 通过。
- 预期：清理回执 verified 且状态 cleaned/already_clean，身份对应同一 run/attempt；数据库或权威 API 读回 completed；任一缺失/超预算即恢复未证实。
- 真相形态为回调、清理 receipt、权威记录与实际资源查询，无 UI 截图要求；仅已有旧 attempt 的故障日志不足以验收修复。
## journey_type: autonomous
## journey_type_reason: Brain 终态清理的后端依赖注入修复，不改变远端 agent 协议。
## target_environment: linux_server
## target_environment_reason: 最终要求部署后生产 Brain 与真实 Fleet PG 角色验证；目标节点由服务端调度确定，当前 Fleet 证据为 us-mac-m4，禁止据此猜测 Brain 宿主。
## journey_id: 51754939-247e-4b22-8f93-f8464a8eb985
## step_id: none（PrepPRD 未锚定）
