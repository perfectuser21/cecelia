---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — conversation-capture 人声闸

**范围**: session 出处登记、已知 Claude 启动路径 machine 声明、采集 human allowlist、哨兵、人工 cleanup SOP、回归与版本同步。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] migration、生产改动、测试、cleanup SOP 与版本同步文件齐全
  Test: node -e "const fs=require('fs');const required=['packages/brain/migrations/360_session_provenance.sql','scripts/claude-launch.sh','packages/brain/scripts/cecelia-run.sh','packages/brain/src/harness-skill-relay.js','packages/brain/src/conversation-capture.js','packages/brain/scripts/cleanup-conversation-captures.sh','packages/brain/src/__tests__/integration/session-provenance.integration.test.js','packages/brain/src/__tests__/conversation-capture-human-gate.test.js','scripts/__tests__/claude-launch-session-provenance.test.sh','packages/brain/scripts/__tests__/cleanup-conversation-captures.test.sh'];for(const p of required){if(!fs.existsSync(p))throw new Error('missing '+p)}"

- [ ] [ARTIFACT] Red→Green 证据覆盖 Implementation Plan Tasks 1-5，且每片测试先于生产实现提交
  Test: bash packages/engine/scripts/devgate/check-tdd-commit-order.sh && node packages/engine/scripts/devgate/check-test-coverage.cjs sprints/07251213-kernel-0a8c796b/contract-draft.md

- [ ] [ARTIFACT] Brain 源码 smoke 与 allowlist 登记、四处版本和 `.brain-versions` 同步
  Test: bash scripts/check-version-sync.sh

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] BEH-01 覆盖 Golden Path Step 1：provenance migration 在真 PostgreSQL 中约束 human/machine 并可重复应用
  动作: 在隔离 schema 连续两次应用真实 migration，插入 human、machine、空/非空 task_id，并尝试非法 kind 与重复 session。
  预期观察: 两种合法 kind 可定点读回，非法 kind 被拒绝，首次声明保持，migration 重跑不报错。
  验证命令: Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run src/__tests__/integration/session-provenance.integration.test.js'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-02 覆盖 Golden Path Step 2：launcher 按 dispatch 优先、双 TTY、unknown 与失败语义登记出处
  动作: 用 fake Claude 和受控 TTY/no-TTY 场景执行真实 launcher，并以真 test DB roundtrip 补验 INSERT。
  预期观察: machine/human/不登记三路互斥；dry-run 零写入；psql 失败两秒内仍调用 Claude。
  验证命令: Test: manual:bash -c 'bash -n scripts/claude-launch.sh && bash scripts/__tests__/claude-launch-session-provenance.test.sh'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-03 覆盖 Golden Path Step 3：cecelia-run 与 headed relay 真实命令构造器透传 machine shape
  动作: 执行 headed dispatch 生产命令构造器测试与 cecelia-run dry-run。
  预期观察: 两条 Claude 路径均含逐字一致的三个 env 字段；首次 attempt 登记一次；resume 与 Codex/Grok 不伪造 human。
  验证命令: Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/headed-dispatch.test.js && cd ../.. && bash packages/brain/scripts/cecelia-run.sh --dry-run'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-04 覆盖 Golden Path Step 4：混合 idle 批次仅 human 进入 raw+summary capture
  动作: 以真实 transcript fixture、生产 `runConversationCapture` 和真 PostgreSQL 跑 human/machine/unknown 混合批次。
  预期观察: 每轮仅一次批量 provenance 查询；恰好 human 被处理并产生 raw 与 summary 两行。
  验证命令: Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run src/__tests__/conversation-capture-human-gate.test.js src/__tests__/integration/conversation-capture.integration.test.js -t "registered human|mixed batch|原始文本"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-05 覆盖 Golden Path Step 5：machine、unknown 与 provenance 查询错误全部失败关闭并写哨兵
  动作: 分别执行 registered machine、unregistered 与真实查询故障场景。
  预期观察: 三路均零 capture，错误路零 LLM/零 dedupe，并持久化六个 sentinel 字段。
  验证命令: Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run src/__tests__/conversation-capture-human-gate.test.js -t "registered machine|unregistered|provenance query error"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-06 覆盖 Golden Path Step 6：Codex/Grok unknown 失败关闭，private-tmp/dedupe/复聊/多轮重扫不回退
  动作: 连续运行适配器、gate 与现有真实 DB 回归池，保留至少一次不重置状态的多轮扫描。
  预期观察: Codex/Grok unknown 零 capture，相同 human session 多轮只摘要一次。
  验证命令: Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run src/__tests__/conversation-capture.test.js src/__tests__/conversation-capture-claude.test.js src/__tests__/conversation-capture-codex.test.js src/__tests__/conversation-capture-grok.test.js src/__tests__/conversation-capture-human-gate.test.js src/__tests__/integration/conversation-capture.integration.test.js'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-07 覆盖 Golden Path Step 7：cleanup SOP 在 disposable 真 PostgreSQL 中先备份、后限定删除，失败不删
  动作: 在 test DB 写入 conversation 与非 conversation fixture，执行无确认、备份失败和成功三路。
  预期观察: 无确认/备份失败均非零且零删除；成功只删 conversation%，输出 before/backed_up/deleted/after。
  验证命令: Test: manual:bash -c 'bash packages/brain/scripts/__tests__/cleanup-conversation-captures.test.sh'
  期望: exit 0

## Invariant 铁律逐条映射

- INV-01 失败恢复：N/A，本单不改 watchdog/orphan requeue。
- INV-02 语义成功：BEH-01/04/07 以 DB 业务行与计数断言，不只检查命令启动。
- INV-03 依赖修复：N/A，本单不处理依赖 advisory。
- INV-04 长等心跳：N/A，本单不改 relay wait/heartbeat。
- INV-05 毕业校验：ARTIFACT-02 要求 lint-tdd-commit-order；权威 DevGate 必跑 coverage checker。
- INV-06 手工证据：BEH-01 至 BEH-07 必须记录真实 exit code；生产清理另由主 session记录。
- INV-07 命令真跑：本合同 ARTIFACT 的 node 命令需真跑，不以 bash -n 替代。
- INV-08 烟测铁律：ARTIFACT-03 覆盖源码 smoke 与 allowlist。
- INV-09 烟测铁律（重复来源）：同 INV-08。
- INV-10 多轮扫描：BEH-06 覆盖不重置状态的连续扫描。
- INV-11 重扫幂等：BEH-06 断言相同 session 只调用一次摘要。
- INV-12 时间关系：BEH-06 保持 `LOOKBACK_WINDOW_MS > IDLE_THRESHOLD_MS` 的既有回归。
- INV-13 剧场匹配：target_environment 由 PRD 明确为 local_api，未受排除文本的平台词影响。
- INV-14 环境来源：task-plan 与 frontmatter 均写 local_api；N/A 于运行时代码。
- INV-15 Judge格式：N/A，本单不改 judge 结果。
- INV-16 字段长度：新 session_id/launched_by 为 TEXT；现有 repo 截断回归由 BEH-06 覆盖。
- INV-17 退役追溯：N/A，本单不是复活退役功能。
- INV-18 失败分支：BEH-02 覆盖 psql 非零；BEH-05 覆盖 lookup error；BEH-06 保持 pushCapture null 计数。
- INV-19 烟测铁律（重复来源）：同 INV-08。
- INV-20 停滞探针：N/A，本单不改 journey_features/report。
- INV-21 产物核验：ARTIFACT 条目核验具体文件与测试，不只看 controller exit 0。
- INV-22 有头核对：BEH-03 明确覆盖 headed Claude，不复用无头先例。
- INV-23 派发锚点：既有 headed payload/base_repo/pr_url 合同不得回退，由 headed-dispatch 回归池覆盖。
- INV-24 退役实证：PRD 已给生产表行数与消费者实证；生产删除仍需主 session重新记录。
- INV-25 后台告警：BEH-05 断言 lookup failure 进入 errors 与 sentinel；不新增通知渠道。
- INV-26 表名认领：`session_provenance` 写入方=launcher，读取方=capture；schema 由 BEH-01 锁定。
- INV-27 消费闭环：新登记行的真实消费者为 `runConversationCapture` allowlist，BEH-04/05 证明闭环。
- INV-28 多端完整：Claude/Codex/Grok 全覆盖于 BEH-04/06。
- INV-29 语义一致：启动端 human/machine 与终验端 allowlist 使用同一 kind 字面值。
- INV-30 引用核验：N/A，本单不新增 git ref 判定。
- INV-31 测试隔离：BEH-01/04/05/07 只连接 `_test`/`_scratch`，fixture 不扫宿主真实历史。
- INV-32 部署失败：生产部署非本 worker动作；主 session必须按非零失败处理。
- INV-33 生产真相：第 7 天验收按生产部署时间和生产 DB 新行，不用 workspace diff。
- INV-34 测试质量：命令构造器测试可等待生产函数；静态检查仅归 ARTIFACT。
- INV-35 合同表格：contract-draft Test Contract 固定四列，Test File 用反引号。
- INV-36 红灯提交：Generator 必须精确 add 每片测试路径，不得 `git add .`。
- INV-37 接线回归：BEH-03 执行生产命令构造器，静态源码只作补充。
- INV-38 定时入口：N/A，本单不新增 cron/JOBS。
- INV-39 合并权限：Generator 只推分支/PR，不得 merge。
- INV-40 环境透传：BEH-03 逐字断言 headed tmux 的三个 provenance env。
- INV-41 历史合同：本合同已读取当前真实派发器、launcher 与 capture 测试，不复用旧路径假设。
- INV-42 共享禁区：N/A；不授权共享 CI 基础设施变更。
- INV-43 提前合并：PR `review_required=true`；evaluator/judge 前不得 merge。
- INV-44 烟测铁律（重复来源）：同 INV-08。
- INV-45 源码烟测：ARTIFACT-03 要求 brain/src smoke 与 allowlist。
- INV-46 类型接线：N/A，本单不新增 task_type。
- INV-47 服务存活：N/A，本单不改宿主服务存活判定。
- INV-48 宿主服务：N/A，本单不新增常驻服务。
- INV-49 巡检清单：N/A，本单不新增常驻服务。
- INV-50 烟测铁律（重复来源）：同 INV-08。
- INV-51 单槽串行：task-plan 仅 ws1，一个实现者。
- INV-52 环境假设：DB 名、备份目录、session/task 均从环境/调用输入推导，不写死生产路径。
- INV-53 真境完成：生产 cleanup 与第 7 天验收在完成前标 `logic-done-pending`。
- INV-54 多租户测：N/A，`session_provenance`/captures 在现有 Cecelia 单租户面，无 tenant 字段。
- INV-55 凭据安全：psql 使用环境配置；SQL/日志不输出密码。
- INV-56 日志脱敏：sentinel 仅计数/布尔，不写 transcript 正文或 PII。
- INV-57 端点鉴权：N/A，本单不新增 API endpoint。
- INV-58 租户隔离：N/A，本单不触及租户数据模型。

## 生产接缝（不由 worker 自动执行）

- [ ] [L3-PENDING] 独立评审通过后主 session 运行 cleanup：必须记录仓外 backup path 与 before/backed_up/deleted/after，确认 after=0 且非 conversation 来源未变。
- [ ] [L3-PENDING] 正常 migration/deploy 完成后第 7 天抽检：新增 `conversation%` 中 strategist/relay/harness/deploy 噪音 = 0，并记录 skipped_machine/skipped_unregistered 汇总。
