---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: watchdog liveness「从未启动」误判 liveness_dead 修复（防复发）

**范围**: packages/brain/src/executor.js（checkExitReason/liveness 探针分类 + requeueTask 内 failure learning 文本真根因保真）+ packages/brain/src/dev-failure-classifier.js（never_started 识别）+ 回归测试永久入 CI。不含：capture_atoms 路由逻辑改动（PRD 排除的是路由逻辑；learnings 失败学习行文本保真在范围内，其 INSERT 位于 executor.js）、S2 豁免名单、1dfa40f7 补锚重跑
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] sprint 红测试文件原样保留（CONTRACT IS LAW 锚）且零 mock（无 vi.mock( 调用）
  Test: node -e "const c=require('fs').readFileSync('sprints/08041147-relay-2c1a4771/tests/liveness-never-started.integration.test.ts','utf8');if(!c.includes('never_started')||!c.includes('process_disappeared')||c.includes('vi.mock('))process.exit(1)"

- [x] [ARTIFACT] 毕业回归测试存在于 packages/brain/src/__tests__/integration/ 且零 mock（PRD「永久回归测试入 CI」载体）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/liveness-never-started.integration.test.js','utf8');if(!c.includes('never_started')||!c.includes('process_disappeared')||c.includes('vi.mock('))process.exit(1)"

- [x] [ARTIFACT] 毕业测试已登记 vitest.config.js POSTGRES_INTEGRATION_TESTS（brain-integration job 机械入口）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('liveness-never-started.integration.test.js'))process.exit(1)"

- [x] [ARTIFACT] 共享 CI 基础设施零改动（.github/workflows/ 禁区铁律）
  Test: bash -c 'git fetch origin main --quiet 2>/dev/null; [ -z "$(git diff --name-only origin/main...HEAD -- .github/workflows/)" ] || exit 1; echo OK'

## BEHAVIOR 条目（journey_type=autonomous，真 Postgres cecelia_test + 真模块 + 真 ps，零 mock）

> 4 类标准场景映射：本任务无 HTTP Response Schema（纯内部分类修复），对应关系为——
> 「schema 字段值」→ B1（DB 可观测字段 watchdog_kill.reason 字面值）；「禁用字段反向」→ B1 内含 not-liveness_dead/not-process_disappeared 反向断言 + B7 学习文本 not-liveness_dead 反向；
> 「数据完整性」→ B2（error_message/failure_class 不被覆盖）+ B7（PRD 行 20 (b)：failure learning 文本真根因保真）；「error/边界 path」→ B3/B4（曾启动回归 + 有日志边界）+ B5（下游误分类通道封堵）。

- [x] [BEHAVIOR] 从未启动任务（started_at=null ∧ 无进程日志 ∧ pid 未跟踪）双确认后 watchdog_kill.reason 为 never_started（真 PG 落库断言，含 not liveness_dead/process_disappeared 反向）
  Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/liveness-never-started.integration.test.ts -t "watchdog_kill.reason 为 never_started"'
  期望: exit 0（实现前实测 exit 1 = 真红）

- [x] [BEHAVIOR] 从未启动任务已有 error_message（S2 拒绝原文）与 payload.failure_class=missing_anchor 不被 watchdog 记账覆盖
  Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/liveness-never-started.integration.test.ts -t "不被 watchdog 记账覆盖"'
  期望: exit 0（实现前实测 exit 1 = 真红，联合分类断言）

- [x] [BEHAVIOR] 回归护栏：曾启动任务（started_at 非空 + 进程日志存在）仍判 process_disappeared，行为与现状完全一致
  Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/liveness-never-started.integration.test.ts -t "仍判 process_disappeared"'
  期望: exit 0（现状即绿，实现后不得变红——防误改）

- [x] [BEHAVIOR] 边界：started_at=null 但存在进程日志（确实曾启动）→ 不判 never_started，仍走既有 process_disappeared 判定
  Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/liveness-never-started.integration.test.ts -t "不判 never_started"'
  期望: exit 0（现状即绿，钉死判定面不扩大）

- [x] [BEHAVIOR] 下游分类保真：classifyDevFailure 对 never_started 失败文本不落 transient 环境重试通道（liveness_dead 假标签的下游闸口）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/dev-failure-classifier.js\").then(m=>{const r=m.classifyDevFailure({error:\"[watchdog] liveness_probe_failed reason=never_started\"});process.exit(r.class===\"transient\"?1:0)})"'
  期望: exit 0（实现前实测 exit 1 = 真红：现命中 /\[watchdog\]/i 误判 transient）

- [x] [BEHAVIOR] 回归测试已毕业入 CI 并在真 Postgres 下全绿（brain-integration job 同款命令）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/integration/liveness-never-started.integration.test.js --config vitest.integration.config.js'
  期望: exit 0（未毕业/未登记白名单时 vitest 报 No test files found exit 1——登记被执行路径隐式强制）

- [x] [BEHAVIOR] failure learning 文本真根因保真（PRD 行 20 (b)，r2 补）：never_started 任务双确认后 learnings 表该任务失败学习行（task_id 定位 + trigger_event='watchdog_kill' + created_at 5 分钟时间窗防历史冒充）存在，且文本含 never_started、不含 liveness_dead 假标签（真 Postgres cecelia_test 零 mock）
  Test: manual:bash -c 'NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/liveness-never-started.integration.test.ts -t "failure learning 文本含真实根因标签"'
  期望: exit 0（实现前实测 exit 1 = 真红：现 title/content 取 requeue 通道参数，含 [liveness_dead] 且缺 never_started）

## Invariant 覆盖（PRD 铁律 58 条逐条映射：可执行 INV 条目 或 显式 N/A）

- [x] [BEHAVIOR] INV-3 起草涉及表字段的合同/测试前 psql 核对真实列名（tasks 表 started_at/error_message/payload 三列实存）
  Test: manual:bash -c 'C=$(psql postgresql://localhost:5432/cecelia_test -t -A -c "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'tasks'"'"' AND column_name IN ('"'"'started_at'"'"','"'"'error_message'"'"','"'"'payload'"'"')"); [ "$C" = "3" ] || exit 1; echo OK'
  期望: OK（proposer 起草时已实查通过，evaluator 复跑防漂移）
  gate-allow: domain/db-no-time-window INV-3 为 information_schema 列元数据核对（表结构存在性），非业务数据聚合，无历史数据冒充面

- [x] [BEHAVIOR] INV-4 新增枚举值全仓库 grep 复查：引用 process_disappeared 枚举的生产源文件必须同时处理 never_started（ASSUMPTION 兑现）
  Test: manual:bash -c 'for f in $(grep -rln "process_disappeared" packages/brain/src --include="*.js" | grep -v __tests__); do grep -q "never_started" "$f" || exit 1; done; echo OK'
  期望: OK（实现前实测 exit 1 = 真红：executor.js 现无 never_started）

非可执行条目逐条声明（编号按 PRD Invariant 段顺序，1-58）：

- INV-1 触发条件窄路径两层验证法：采纳——B1/B2/B6/B7 即「同机制真实端到端触发（零 mock）」层；auto-learning 传参保真由 B1 的 watchdog_kill.reason DB 断言钉死（写入 watchdog_kill 与传给 auto-learning 的是同一 evidence 对象），requeueTask 学习文本保真由 B7 learnings 行真 PG 断言钉死，source-code inspection 层由 code-review-gate 覆盖
- INV-2 DB_NAME 写入侧/校验侧同源：结构满足——写入侧 node 走 db-config.js（NODE_ENV=test→cecelia_test 单源），校验侧 psql 由 E2E 脚本单一 TEST_DB_NAME 变量派生，无两处默认值；db-config.js 含测试环境禁连生产库 guard
- INV-3 见上方可执行条目
- INV-4 见上方可执行条目
- INV-5 watchdog_overdue relay run 恢复路径：N/A——本 sprint 不触及 relay run requeue 恢复
- INV-6 成功判定看语义字段：满足——本合同断言全部为语义字段直查（reason 字面值/error_message 内容/class 值），无 ok:true 探测；另无通知/外部写库接口
- INV-7 dep-audit fixAvailable：N/A——不改依赖
- INV-8 headed relay 心跳：N/A——无 headed relay 长等待环节（本合同产物自身）
- INV-9 毕业 commit 前先本地跑 lint-tdd-commit-order 与 check-test-coverage：已写入 contract-draft「测试不可变纪律」，generator 流程义务
- INV-10 合同批准前记录 manual oracle 真实 exit code 并确认解释器启动：已执行——见文末「manual oracle 实测 exit code 附录」
- INV-11 manual:node -e 双引号 ${} 逐条真跑：满足——本合同全部 node -e 均无 ${} 模板串（字符串拼接/纯断言），且已逐条真跑（见附录）
- INV-12 smoke 铁律：N/A——不改 smoke 脚本/allowlist（若 CI smoke 因 brain/src 变更要求登记，按 INV-46 处理）
- INV-13 跨扫描周期状态不重置的真实多轮测试：满足——B1-B4 均为真实两轮探针，suspect 状态跨轮真实保留（测试仅在 afterEach 清理，轮间不重置）
- INV-14 重扫+付费调用前置检查：N/A——本链路无 LLM/付费第三方调用
- INV-15 跨模块时间常数隐含依赖：N/A——不新增时间常数，复用现有双确认节奏与宽限期
- INV-16 theater 移动端关键词检查：N/A——target_environment=local_api，合同文本无移动端关键词
- INV-17 target_environment 从 DB tasks.payload 读取：流程满足——PRD 已声明 local_api；relay 派发 payload 由 controller 写入（controller 职责，非本合同产物）
- INV-18 judge API 格式（顶层 exit_code+log_tail+behavior_tests[]）：evaluator 侧义务——本合同每条 BEHAVIOR/E2E 均输出确定性 exit code 供其采集
- INV-19 varchar 长度截断：N/A——本 sprint 写入均为 jsonb 字段（watchdog_kill），无 varchar 新写入
- INV-20 复活死功能先读退役代码：N/A——非复活类改动
- INV-21 「失败返 null/false」契约显式 else：已写入 contract-draft generator 义务硬条款第 5 条
- INV-22 journey_features updated_at 巡检：N/A——report 阶段兜底探针，非本合同范围
- INV-23 controller Step 7 机械闸：N/A——controller 职责
- INV-24 host/环境白名单断言核对 headed 场景：N/A——本合同无 host 白名单类断言
- INV-25 headed relay payload 带 base_repo/pr_url：N/A——controller 点火职责
- INV-26 退役判断查生产库：N/A——非退役改动
- INV-27 catch 吞错后台 job 失败计数：N/A——不新增后台 job；探针失败路径本身即告警链（liveness 学习）
- INV-28 表名认领冲突：N/A——不建表不复用新表
- INV-29 后台 job 声明消费方：N/A——不新增落库 job；never_started 标签的消费方即既有 failure learning/capture_atoms 链（PRD Golden Path 第 3 点）
- INV-30 新字段与既有字段语义重叠须本 sprint 内消解：满足——never_started 与 process_disappeared 的语义边界在 contract-draft「判定点登记表」显式消解（从未启动 vs 曾启动互斥判据），无留债
- INV-31 git_sha 判变/终验同一策略：N/A——无部署判变环节
- INV-32 git rev-parse --verify：N/A——合同脚本无 rev-parse
- INV-33 测试 worktree 触碰生产资源核对：满足——tests/E2E 仅触 cecelia_test（db-config.js guard 禁测试连生产库），fixture 行 afterEach/trap 清理
- INV-34 失败路径禁 warning 降级：满足——E2E set -euo pipefail，全部失败路径显式 exit 1，唯一 || true 在 trap 清理（非断言路径）
- INV-35 判变基准用生产实体自报：N/A——无部署判变
- INV-36 lint-test-quality await 要求：满足——tests 每条 it 均 await 真实异步调用（probeTaskLiveness/pool.query/import）
- INV-37 Test Contract 表 4 列 + backtick testFile：满足——见 contract-draft Test Contract 表
- INV-38 Red commit 只 add 精确测试路径：已写入 generator 义务硬条款第 4 条
- INV-39 source-code inspection 验调度接线：采纳于 INV-1 覆盖方式说明
- INV-40 新 cron 先查 scheduler-jobs.js：N/A——不新增 cron
- INV-41 generator 禁自行 merge：已写入 generator 义务硬条款第 3 条
- INV-42 tmux 子 shell 环境变量继承：N/A——无 headed tmux 环节
- INV-43 复用历史合同模板须核对真实派发历史：满足——本合同 E2E/断言为本 sprint 新写并逐条真跑（见附录），非先例照抄
- INV-44 共享 CI 基础设施文件默认禁区：可执行——见 ARTIFACT 第 4 条（.github/workflows/ 零改动 diff 断言）
- INV-45 PR head SHA 核对 verdict 锚定：N/A——controller/evaluator 收账职责
- INV-46 feat+brain PR 一次带齐 smoke 登记：generator 义务——若 CI smoke 闸要求 allowlist 登记，随实现 commit 一次带齐，不等两连红
- INV-47 新 task_type 七点清单：N/A——不新增 task_type（never_started 是 payload 内 reason 值，非任务状态/类型枚举）
- INV-48 服务存活双信号：N/A——不改服务存活判定
- INV-49 LaunchAgents 禁用：N/A——无常驻服务改动
- INV-50 launchd-patrol manifest：N/A——无新常驻服务
- INV-51 slot 内严格串行：N/A——执行体调度纪律，非本合同产物
- INV-52 环境假设值禁写死：满足——判定条件全部从任务自身 DB 状态/文件系统实况推导（started_at、日志存在性、pid 跟踪态），无屏幕坐标/env 假设值
- INV-53 接缝断言必须真目标验证：满足——见 contract-draft「接缝断言清单」（真 PG + 真 ps 已真验；生产 tick 段显式 logic-done-pending 入未覆盖清单，不标 done）
- INV-54 测试默认种 ≥2 租户：N/A——tasks 为 Brain 内部调度表，无租户维度读写面
- INV-55 secrets 不硬编码不进 git：满足——合同/测试/E2E 零凭据（本地 trust 连接），无新增 env 秘密
- INV-56 PII 不明文进日志：N/A——无客户数据经过本链路
- INV-57 API 端点必须有 auth：N/A——不新增/不改任何端点
- INV-58 租户数据查询 scope：N/A——同 INV-54

## manual oracle 实测 exit code 附录（INV-10，proposer 2026-08-03 本机逐条真跑）

| 条目 | 命令首词 | 实测 exit code（实现前） | 判定 |
|---|---|---|---|
| B1 never_started 分类 | bash→npx vitest | 1 | 真红 ✓（现返 process_disappeared） |
| B2 字段不覆盖 | bash→npx vitest | 1 | 真红 ✓（联合分类断言） |
| B3 曾启动回归 | bash→npx vitest | 0 | 现状绿 ✓（回归护栏性质） |
| B4 有日志边界 | bash→npx vitest | 0 | 现状绿 ✓（边界护栏性质） |
| B5 classifier 保真 | bash→node | 1 | 真红 ✓（现判 transient） |
| B6 毕业+白名单 | bash→npx vitest | 1 | 真红 ✓（文件不存在→No test files found） |
| B7 学习文本保真（r2 补） | bash→npx vitest | 1 | 真红 ✓（现文本含 [liveness_dead] 缺 never_started，2026-08-03 实测） |
| ARTIFACT-1 sprint 测试存在 | node | 0 | 已交付 ✓ |
| ARTIFACT-2 毕业文件存在 | node | 1 | 真红 ✓ |
| ARTIFACT-3 白名单登记 | node | 1 | 真红 ✓ |
| ARTIFACT-4 workflows 零改动 | bash→git | 0 | 现状绿 ✓ |
| INV-3 列名核对 | bash→psql | 0 | 环境前提成立 ✓ |
| INV-4 枚举复查 | bash→grep 循环 | 1 | 真红 ✓（executor.js 无 never_started） |
| E2E 探针脚本 r3 修复版（$PWD 绝对路径 import） | bash→node | 0 | 脚本可跑 ✓（2026-08-04 实测：import 解析到 worktree 绝对路径、NODE_ENV=test 路由 cecelia_test、两轮 suspect→confirmed dead 真实执行；红移交断言层，非脚本崩溃） |
| E2E 步骤 4 REASON 断言（r3 修复版实测，fixture 注入→探针→断言全链） | bash→psql | 1 | 真红 ✓（现返 process_disappeared 兜底，实现后转绿） |
| E2E TID 捕获 r3 修复版（psql -q -t -A） | bash→psql | 0 | 环境前提成立 ✓（不加 -q 时 psql 17 附带 `INSERT 0 1` 命令标签行致 TID 两行、后续 uuid 语法错恒炸，实测 -q 后单行纯 UUID） |

假绿自查（每条心测「代码一行不写会 FAIL 吗」）：B1/B2/B5/B6/B7 + ARTIFACT-2/3 + INV-4 全部 YES（实测红）；B3/B4/ARTIFACT-4/INV-3 为回归护栏/环境前提，性质即「现状绿、防退化」，非实现性断言。
