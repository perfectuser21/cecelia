contract_branch: cp-08040930-harness-prd
sprint_dir: sprints/08040916-relay-78e812c0

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: ledger-hygiene m7 探针口径修正 + 自主循环产出登记覆盖

**范围**: packages/brain 内部——ledger-hygiene.js（m7 窗口/排除/文案/自产打标）、auto-learning.js（VALUABLE_TASK_TYPES）、capture-inbox.js（签名恢复）、handoff.js（pushHandoffAtom）、routes/tasks.js（PATCH 接线）；不含 P2 台账闭环/会话捕获/生产部署/watchdog（PRD 显式裁剪）
**大小**: M

**环境前置**（evaluator 执行 BEHAVIOR 前须满足，不满足 = 环境未就绪 = FAIL，禁止兜底跳过）：
- Brain 已以本 PR 代码运行于 localhost:5221；psql 可连 `${DB:-cecelia}`
- packages/brain/node_modules 已安装（场景脚本需 pg；缺失时先 `cd packages/brain && npm ci`）

## ARTIFACT 条目

- [ ] [ARTIFACT] capture-inbox.js 签名恢复：无 `_routedToTable/_routedToId` 丢弃形态，atom INSERT 含 routed_to_table/routed_to_id/lane 三列
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/capture-inbox.js','utf8');if(c.includes('_routedToTable')||c.includes('_routedToId'))process.exit(1);const m=c.match(/INSERT INTO capture_atoms[\s\S]*?RETURNING id/);if(!m||!/routed_to_table/.test(m[0])||!/routed_to_id/.test(m[0])||!/lane/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] ledger-hygiene.js：m7 SQL 含 Asia/Shanghai 北京日窗口与 lane 排除；raiseBreachAlerts 的 pushCaptureAtom 带 lane:'ledger-hygiene'
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/ledger-hygiene.js','utf8');if(!/Asia\/Shanghai/.test(c))process.exit(1);if(!/ledger-hygiene/.test(c.match(/lane/g)?'x':'')&&!/lane.*ledger-hygiene|ledger-hygiene.*lane/s.test(c))process.exit(1)"

- [ ] [ARTIFACT] auto-learning.js：VALUABLE_TASK_TYPES 含 harness_initiative（源级声明，运行级由 B5 验）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/auto-learning.js','utf8');const m=c.match(/VALUABLE_TASK_TYPES\s*=\s*\[[^\]]*\]/);if(!m||!m[0].includes('harness_initiative'))process.exit(1)"

- [ ] [ARTIFACT] handoff.js 导出 pushHandoffAtom 且 saveHandoff 复用；routes/tasks.js PATCH 接线调用（同口径保证）
  Test: node -e "const h=require('fs').readFileSync('packages/brain/src/handoff.js','utf8');if(!/export\s+(async\s+)?function\s+pushHandoffAtom/.test(h))process.exit(1);const t=require('fs').readFileSync('packages/brain/src/routes/tasks.js','utf8');if(!t.includes('pushHandoffAtom'))process.exit(1)"

- [ ] [ARTIFACT] cortex.js/learning.js/chat-action-dispatcher.js/conversation-consolidator.js 调用方仍传 routedToTable/routedToId（source-code inspection，铁律 INV-1 授权：触发条件窄路径可结构性验证）
  Test: node -e "for(const f of ['cortex.js','learning.js','chat-action-dispatcher.js','conversation-consolidator.js']){const c=require('fs').readFileSync('packages/brain/src/'+f,'utf8');if(c.includes('pushCaptureAtom')&&!c.includes('routedToTable'))process.exit(1)}"

- [ ] [ARTIFACT] 回归测试永久入 CI：4 个真 PG 测试入册 src/__tests__/integration/ 且登记 POSTGRES_INTEGRATION_TESTS；auto-learning-harness.test.ts 入册 src/__tests__/（NFR：修 bug failing test 必须 commit 进 CI，不得删除）
  Test: node -e "const fs=require('fs');for(const f of ['ledger-hygiene-m7-beijing-window.integration.test.ts','breach-issue-copy.integration.test.ts','capture-atom-routing.integration.test.ts','handoff-atom-relay.integration.test.ts']){fs.accessSync('packages/brain/src/__tests__/integration/'+f)};fs.accessSync('packages/brain/src/__tests__/auto-learning-harness.test.ts');const v=fs.readFileSync('packages/brain/vitest.config.js','utf8');if(!v.includes('ledger-hygiene-m7-beijing-window.integration.test.ts'))process.exit(1)"

- [ ] [ARTIFACT] 既有测试不回退：ledger-hygiene-m7.test.js 既有 it() 全保留（mock SQL 桩可随新窗口 SQL 更新，语义不变）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/ledger-hygiene-m7.test.js','utf8');for(const s of ['enabled=false','debt=1','debt=0','表不存在']){if(!c.includes(s))process.exit(1)}"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type = autonomous，测真实 Brain/DB）

> B1-B4 走真 Postgres（TEMP 影子表隔离，不污染真实数据，DB 解析与 Brain 同源 db-config.js）；B5-B8 走真 Brain HTTP + psql（5 分钟时间窗防历史数据冒充，脚本自清理）。全部命令从 repo 根目录可直接执行。

- [ ] [BEHAVIOR] m7 统计窗为上一完整北京日：仅当前时刻 atom 不计入 → debt=1（旧口径 NOW()-24h 下此断言必 FAIL，判别性防假绿；真实零产出击穿有效性保留）
  Test: manual:bash -c 'node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" window'
  期望: stdout 含 "OK window"，exit 0

- [ ] [BEHAVIOR] m7 排除探针自产 atoms：上一北京日仅 lane=ledger-hygiene 自产 issue atom → debt=1 正确击穿；加 1 条非自产 atom → debt=0 清偿
  Test: manual:bash -c 'node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" exclusion'
  期望: stdout 含 "OK exclusion"，exit 0

- [ ] [BEHAVIOR] debt=0 无击穿 → ratchet streak 复位为 0（prev streak=2 → 0，breaches 空）
  Test: manual:bash -c 'node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" reset'
  期望: stdout 含 "OK reset"，exit 0

- [ ] [BEHAVIOR] debt 持平时 issue 文案不含「上升」且含持平或连续第 N 天表述；title 前缀 [ledger-hygiene] 指标名不变（频控去重键）；自产 atom 带 lane=ledger-hygiene 且 routed_to_table=issues、routed_to_id 非空
  Test: manual:bash -c 'node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" copy'
  期望: stdout 含 "OK copy"，exit 0

- [ ] [BEHAVIOR] harness_initiative 任务 failed（真 execution-callback）→ learnings 新增 1 行且 capture_atoms 新增 1 行 routed_to_table=learnings、routed_to_id=该 learning id（5 分钟时间窗）
  Test: manual:bash -c 'bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b5-autolearn.sh"'
  期望: stdout 含 "OK b5"，exit 0

- [ ] [BEHAVIOR] relay PATCH tasks result.handoff（真 Brain HTTP）→ capture_atoms 新增 1 行 target_type=handoff、routed_to_table=tasks、routed_to_id=task_id（与 saveHandoff 同口径，5 分钟时间窗）
  Test: manual:bash -c 'bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b6-handoff-patch.sh"'
  期望: stdout 含 "OK b6"，exit 0

- [ ] [BEHAVIOR] error path — result.handoff 为空对象 → PATCH 仍 200（主流程不阻断）且不产 atom
  Test: manual:bash -c 'bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b7-handoff-empty.sh"'
  期望: stdout 含 "OK b7"，exit 0

- [ ] [BEHAVIOR] error path — 非 VALUABLE_TASK_TYPES 任务（code_review）failed → 不产 learning（高频低价值过滤不回退，防全量放行造垃圾）
  Test: manual:bash -c 'bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b8-nonvaluable-skip.sh"'
  期望: stdout 含 "OK b8"，exit 0

- [ ] [BEHAVIOR] DevGate 三件套通过（PRD ASSUMPTION 3：改 packages/brain 必过）
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs'
  期望: 三命令全 exit 0

## Invariant 覆盖（铁律清单逐条映射 — PRD 62 条，每条要么 INV 条目要么 N/A）

**有对应断言的铁律（4 条，命令复用上方 BEHAVIOR oracle）：**

- [ ] [BEHAVIOR] INV-2 冒烟/校验脚本写入侧与校验侧 DB_NAME 同一解析逻辑——m7-scenarios.mjs 与 Brain 同用 db-config.js DB_DEFAULTS，b5-b8 统一 `${DB:-cecelia}` 单变量，无两处各自默认值
  Test: manual:bash -c 'node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" window'
  期望: exit 0（脚本能连上与 Brain 同源解析出的库即证同一逻辑）

- [ ] [BEHAVIOR] INV-6 写库接口成功判定看语义字段——b6 断言 capture_atoms 行本体三字段（target_type/routed_to_table/routed_to_id）而非 HTTP 200 或 ok:true
  Test: manual:bash -c 'bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b6-handoff-patch.sh"'
  期望: exit 0

- [ ] [BEHAVIOR] INV-56 禁止写死环境假设值——北京日窗口从 Asia/Shanghai 时区推导（非写死服务器本地时区偏移），window 场景在真 Postgres 上验证推导正确
  Test: manual:bash -c 'node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" window'
  期望: exit 0

- [ ] [BEHAVIOR] INV-57 真环境验证才算 done——登记链路在真 Brain（localhost:5221）+ 真 cecelia 库上验证，非 mock/CI 绿
  Test: manual:bash -c 'bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b5-autolearn.sh"'
  期望: exit 0

**N/A 铁律（58 条，注明理由）：**

- N/A INV-1（cortex source-code inspection 可用）：本合同据此授权 ARTIFACT-A5 结构性核对 cortex 调用方——铁律为授权条款而非断言项
- N/A INV-3（agents 表字段先 psql 核对）：本 sprint 不触及 agents 表；涉及表（capture_atoms/captures/issues/learnings/tasks）列名已于起草前 psql \d 实核
- N/A INV-4（status 枚举硬编码断言全仓扫描）：本 sprint 无新增状态值
- N/A INV-5（watchdog 误杀 relay run 外部真相核查）：PRD 显式裁剪"watchdog 误杀 relay run（另案）"
- N/A INV-7（dep-audit fixAvailable）：本 sprint 无依赖变更
- N/A INV-8（headed relay CI 等待心跳）：执行体运行时约束，非本合同交付物断言；generator 侧遵守
- N/A INV-9（毕业 commit 先跑 lint-tdd-commit-order 与 check-test-coverage）：generator 流程义务，写入 task-plan notes；非 evaluator oracle
- N/A INV-10（manual oracle 记录真实 exit code + 解释器启动确认）：已履行——本合同全部 manual 命令在 GAN Round 1 真跑并记录 exit code（见 propose 报告 Red/oracle 证据）
- N/A INV-11（manual:node -e 的 ${} 先真跑）：已履行——ARTIFACT node -e 命令全部真跑验证，无双引号 ${} 陷阱
- N/A INV-12/13/23/48/54（smoke-invariant 占位 5 条）：无可执行语义的占位铁律
- N/A INV-14（冷启动写法测试补充 sentinel 场景）：本 sprint 无 sentinel/sinceMs 类增量扫描逻辑
- N/A INV-15（周期性重扫 + 付费调用前置检查）：探针无 LLM/付费调用
- N/A INV-16（跨模块时间常数依赖断言）：窗口改为日历日语义，不新增与其他模块时间常数的大小关系依赖（05:10 触发窗与"上一完整日"天然无依赖冲突）
- N/A INV-17（theater_mismatch android 关键词）：无 android 内容，target_environment=local_api
- N/A INV-18（target_environment 从 DB tasks.payload 读）：任务注册由 controller/Brain 完成，本合同 target_environment 与 PRD 一致为 local_api
- N/A INV-19（.brain-result.json 顶层 exit_code 等）：evaluator 侧输出协议，非本合同交付物；proposer 侧 .brain-result.json 按 proposer 协议输出
- N/A INV-20（varchar 长度显式截断）：atom content 已有 MAX_CONTENT_LEN=2000 截断（既有）；lane 写入固定短常量 'ledger-hygiene'（13 字符 < varchar(100)）
- N/A INV-21（复活死功能先查删除历史）：routed_to 落库非复活死功能——列存在且 94/170 历史行有值，属修签名断裂
- N/A INV-22（null/false 失败契约显式 else）：pushCaptureAtom 返回 null 属"进箱失败不阻塞主流程"的既有有意契约，调用方吞错为设计而非遗漏；pushHandoffAtom 沿用同契约并在测试断言 null 分支
- N/A INV-24（journey_features updated_at 停滞兜底）：report 阶段职责，非本合同
- N/A INV-25（relay 容器跳过 Step 7）：controller 流程职责
- N/A INV-26（host/环境白名单断言核对 headed 接管）：本合同无 host 白名单类断言
- N/A INV-27（headed relay 点火写 base_repo/pr_url）：controller 点火职责
- N/A INV-28（退役判断查生产库实锤）：本 sprint 无退役动作
- N/A INV-29（catch 吞错后台 job 失败计数指标）：本 sprint 不新增后台 job；探针失败可见性由分数卡断更暴露（八要素死亡告警行）
- N/A INV-30（表名认领冲突 grep 全部写入方）：已履行——capture_atoms 全部写入方（pushCapture 单点 INSERT）已 grep 实核，无双写方
- N/A INV-31（新增后台 job 必须声明消费方）：无新增后台 job；capture_atoms 既有消费方为 m7 探针与 triage
- N/A INV-32（多设备类型 UI 区分）：无 UI
- N/A INV-33（git_sha=unknown 同一处理策略）：无判变/终验 git_sha 语义
- N/A INV-34（git rev-parse --verify）：合同命令仅用 `git rev-parse --show-toplevel`（取根目录，非判 ref 存在）
- N/A INV-35（smoke 用真实 worktree 核对生产资源）：TEMP 影子表 + 自清理已保证不触碰生产数据；b5-b8 写入均带标记并 trap 清理
- N/A INV-36（部署链失败禁止 warning 降级）：本合同无部署链脚本；E2E set -euo pipefail 无降级分支
- N/A INV-37（判变基准用生产实体自报）：无部署判变逻辑
- N/A INV-38（lint-test-quality await 包装）：合同测试均含 await 真调用，非纯 readFile
- N/A INV-39（Test Contract 表 4 列 + testFile backtick）：已按格式执行（见 contract-draft Test Contract 表）
- N/A INV-40（Red commit 只 add 精确路径）：generator commit 纪律，写入 task-plan notes
- N/A INV-41（source-code inspection 验调度接线）：本 sprint 无调度接线变更（无 scheduler/tick 改动）
- N/A INV-42（新增 cron 先查 scheduler-jobs.js）：无新增 cron，探针触发机制不变
- N/A INV-43（generator 禁自行 merge PR）：generator 纪律，merge 权归 controller（task-plan notes 载明）
- N/A INV-44（tmux 子 shell 环境变量）：无 tmux/headed 启动逻辑
- N/A INV-45（复用历史合同模板先核对派发历史）：已履行——本合同 E2E 未复用历史模板断言，全部按本次代码现状新写（tasks.js/execution.js 真实路由实核）
- N/A INV-46（共享 CI 基础设施文件禁区）：本合同不触及 .github/workflows/*.yml；测试入册走 vitest.config.js POSTGRES_INTEGRATION_TESTS 白名单（既有登记机制，非 CI workflow 文件）
- N/A INV-47（PR 提前合并核查）：controller/watchdog 流程职责
- N/A INV-49（feat+brain/src PR 带齐 smoke.sh + smoke-allowlist 登记）：generator PR 义务，写入 task-plan notes（开 PR 前核对 smoke-allowlist 是否需登记）
- N/A INV-50（新 task_type 七点清单）：无新 task_type
- N/A INV-51（服务活着双信号）：无常驻服务判活逻辑
- N/A INV-52（本机禁 LaunchAgents）：无新增常驻服务
- N/A INV-53（launchd-patrol manifest）：同上
- N/A INV-55（单 slot 串行）：单 Generator 单 PR，无并行 slot
- N/A INV-58（测试默认多租户）：Brain 内部单实例探针链路，无租户维度表（capture_atoms/learnings 无 tenant 列）
- N/A INV-59（凭据安全）：无凭据引入；DB 连接走 db-config.js 既有解析
- N/A INV-60（日志脱敏）：新增日志仅含 id/计数/固定文案，无敏感载荷
- N/A INV-61（端点鉴权）：无新端点；既有端点鉴权面不变
- N/A INV-62（租户隔离）：同 INV-58，无租户维度

## 生效备注

- 判定点登记：见 contract-draft.md 判定点登记表（⚠️ 标注 1 条：北京日窗口判定，PrepPRD/research 已拍板方案 B，无 judgment-pending-user）
- 接缝清单：见 contract-draft.md（3 条，前 2 条已在真目标验证路径内，第 3 条 PRD 显式裁剪）
