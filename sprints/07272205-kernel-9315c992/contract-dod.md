---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD - Provider-neutral Harness capacity gate

**范围**: `harnessSlotCheck` provider/account-aware capacity accounting、active attempt occupancy、candidate-aware fail-closed、legacy relay/Kernal run 回归、版本/RCI/review gate。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] provider-neutral capacity accounting 模块、`harnessSlotCheck` 接线和 llm-capacity safe concurrency 元数据已落到 Brain 源码
  Test: node -e "const fs=require('fs');const files=['packages/brain/src/harness-capacity-accounting.js','packages/brain/src/slot-allocator.js','packages/brain/src/llm-capacity.js'];for(const p of files){if(!fs.existsSync(p))throw new Error('missing '+p)}const s=fs.readFileSync('packages/brain/src/slot-allocator.js','utf8');for(const x of ['computeHarnessAccountCapacity','loadActiveHarnessAccountOccupancy','account_capacity','candidate_account'])if(!s.includes(x))throw new Error('slot allocator missing '+x);const l=fs.readFileSync('packages/brain/src/llm-capacity.js','utf8');if(!l.includes('safe_concurrency'))throw new Error('llm-capacity missing safe_concurrency')"

- [ ] [ARTIFACT] dispatcher/tick 没有新增绕过 `harnessSlotCheck` 的 Harness 直接派发路径
  Test: node -e "const fs=require('fs');const d=fs.readFileSync('packages/brain/src/dispatcher.js','utf8');if(!/harnessSlotCheck\\(\\{\\s*candidate\\s*\\}\\)/s.test(d))throw new Error('dispatcher no longer calls harnessSlotCheck with candidate');if(/acct_cap\\s*=\\s*getAvailableAccountCount\\(\\)\\s*\\*/.test(fs.readFileSync('packages/brain/src/slot-allocator.js','utf8')))throw new Error('Claude-only acct_cap still present')"

- [ ] [ARTIFACT] P0 capacity 状态机变更写入 DEFINITION/version/RCI 且 review_required=true
  Test: bash scripts/check-version-sync.sh && node -e "const fs=require('fs');const text=fs.readFileSync('DEFINITION.md','utf8')+'\n'+fs.readFileSync('packages/brain/DEFINITION.md','utf8');for(const s of ['provider-neutral Harness capacity','review_required=true','acct_cap']){if(!text.includes(s))throw new Error('missing '+s)}"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] BEH-01 覆盖 Golden Path Step 1：provider-neutral acct_cap 覆盖 Claude Codex Grok 且不固定为 4
  动作: 用合同 fixture 构造 2 Claude、5 Codex、1 Grok 全 available 的能力快照，并调用真实 provider-neutral capacity accounting。
  预期观察: 八个 provider/account 各按 `safe_concurrency=2` 计入，`acct_cap=16`；同一 provider/account 不重复计数；hard cap 放大时 effective 不是旧固定 4。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts -t "provider-neutral acct_cap 覆盖 Claude Codex Grok 且不固定为 4"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-02 覆盖 Golden Path Step 1-2：同账号多候选只计一次且固定 role_assignment 耗尽时拒绝该账号
  动作: 构造重复 `codex:team1` 候选和固定 generator role_assignment 到 `codex:team1` 的 candidate，再放入两条同账号 active attempts。
  预期观察: 重复候选只贡献 2 个槽；固定账号剩余 0 时返回 `allow=false` 和 `reason=candidate_account_exhausted`，不能借 `team2` 空槽放行。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts -t "同账号多候选只计一次且固定 role_assignment 耗尽时拒绝该账号"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-03 覆盖 Golden Path Step 3：缺快照 未知 provider 未知并发上限全部 fail-closed
  动作: 分别传入空 snapshot、unknown provider、缺 `safe_concurrency` 账号、`available=false` 与 `circuit_open=true` 账号。
  预期观察: 不可信账号不计入 `acct_cap`；candidate 命中不可信账号时机器可读 reason 明确，且没有 Claude-only fallback。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts -t "缺快照 未知 provider 未知并发上限全部 fail-closed"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-04 覆盖 Golden Path Step 2：真实 harness_attempts 非终态占用按 provider account 计数且终态不占用
  动作: 在真实 PostgreSQL 插入隔离 `initiative_runs/harness_attempts` fixture，混合 queued、starting、running 与终态 attempt，并用 role_assignment 补齐 provider/account。
  预期观察: 非终态三行占用；终态不占用；`codex:team2` active=2，`claude:account1` active=1，failed/cancelled/completed 不出现在 occupancy。
  验证命令: Test: manual:bash -c 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-attempt-occupancy.pg.contract.test.ts -t "真实 harness_attempts 非终态占用按 provider account 计数且终态不占用"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-05 覆盖 Golden Path Step 4-5：harnessSlotCheck 叠加 provider-neutral acct_cap active attempts reserve 和 hard cap
  动作: 调用真实 `harnessSlotCheck` 测试入口，注入体征、quota、provider-neutral snapshot 与 active attempt scope，模拟旧 Claude 四槽已满但 Codex/Grok 有空槽。
  预期观察: `cap.acct_cap>4`，Codex/Grok candidate 可放行进入统一 Controller；`cap.effective` 仍不超过 hard cap，mem/disk/quota/inflight/kernel_active 语义不回退。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts -t "harnessSlotCheck 叠加 provider-neutral acct_cap active attempts reserve 和 hard cap"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-06 覆盖 Golden Path Step 4：legacy relay、Kernel v1、inflight 与 dispatcher cap backstop 回归保持
  动作: 运行既有 Harness slot、Kernel active run 与 dispatcher admission 回归池。
  预期观察: 旧 relay 场景语义不变，Kernel v1 run 仍被计入，dispatcher 仍通过 `harnessSlotCheck` 并保留 task cap backstop。
  验证命令: Test: manual:bash -c 'npx vitest run packages/brain/src/__tests__/harness-slot-check.test.js packages/brain/src/__tests__/harness-slot-check-kernel.test.js packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-07 覆盖 Golden Path Step 5：llm-capacity ledger 保留 Claude/Codex/Grok shape 与 Codex team1-5
  动作: 运行现有 llm-capacity 回归，验证 provider ledger shape 与 Codex 五账号池。
  预期观察: `vendors.claude/codex/grok` 结构保留，Codex `total_count=5`，新增 `safe_concurrency` 不破坏摘要。
  验证命令: Test: manual:bash -c 'npx vitest run packages/brain/src/__tests__/llm-capacity.test.js packages/brain/src/__tests__/llm-capacity-pool.test.js'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] BEH-08 覆盖 P0 审批：DEFINITION version RCI review_required 均已声明
  动作: 运行版本同步脚本并检查仓库级/Brain 定义文档含 provider-neutral capacity、`acct_cap` 和 `review_required=true`。
  预期观察: 版本同步通过；主理人批准前 merge/deploy gate 可从文档/RCI 读到 review_required。
  验证命令: Test: manual:bash -c 'bash scripts/check-version-sync.sh && node -e "const fs=require(\"fs\");const text=fs.readFileSync(\"DEFINITION.md\",\"utf8\")+\"\\n\"+fs.readFileSync(\"packages/brain/DEFINITION.md\",\"utf8\");for(const s of [\"provider-neutral Harness capacity\",\"review_required=true\",\"acct_cap\"]){if(!text.includes(s))throw new Error(\"missing \"+s)}"'
  期望: exit 0

## Invariant 铁律逐条映射

- INV-01 失败恢复：BEH-06 保留 Kernel active / watchdog 相关回归，不改 orphan requeue。
- INV-02 语义成功：BEH-01/04/05 验证 `acct_cap`、DB occupancy 和 admission reason，不只 grep ok。
- INV-03 依赖修复：N/A，本单不处理 dependency advisory。
- INV-04 长等心跳：BEH-04 明确 stale 未终态继续占用，防心跳单信号误释放容量。
- INV-05 毕业校验：ARTIFACT-03 要求版本同步；Generator 仍需按 DevGate 执行。
- INV-06 手工证据：BEH-01 至 BEH-08 均需记录真实 exit code。
- INV-07 manual node 命令：ARTIFACT/BEH-08 的 `node -e` 必须真跑。
- INV-08 smoke 铁律：ARTIFACT-03 和 BEH-08 覆盖版本/RCI gate；源码 smoke 由 Generator DevGate 执行。
- INV-09 smoke 铁律（重复）：同 INV-08。
- INV-10 冷启动多轮：BEH-04 覆盖 stale 未终态占用，不靠重置状态。
- INV-11 重扫幂等：N/A，本单不做周期性内容重扫；容量重复候选去重由 BEH-02 覆盖。
- INV-12 时间常数：snapshot TTL 与 active DB 现查在合同边界声明；BEH-03 覆盖 stale fail-closed。
- INV-13 theater mismatch：target_environment 为 local_api；本单不触 Android/微信真机。
- INV-14 target 来源：contract/task-plan frontmatter 均写 local_api；不依赖本地隐式推断。
- INV-15 Judge 格式：N/A，本单不改 judge API。
- INV-16 字段长度：provider/account 字段沿现有 TEXT；不新增受限 varchar。
- INV-17 复活死因：PRD 已给生产病灶；不复活退役模块。
- INV-18 失败分支：BEH-03/04 覆盖缺快照、未知 provider、DB 查询失败 fail-closed。
- INV-19 smoke 铁律（重复）：同 INV-08。
- INV-20 report 停滞探针：N/A，本单不改 journey_features/report。
- INV-21 产出核验：BEH-05 验实际 admission 结果，不只看进程退出。
- INV-22 环境白名单：N/A，本单不改 headed 人工接管。
- INV-23 payload 锚点：真实调用 shape 固定 `tasks.payload.role_assignments`，BEH-02/04 覆盖。
- INV-24 退役依据：N/A，本单不是清理退役。
- INV-25 后台告警：失败 reason 机器可读；P0 review_required 在 BEH-08 覆盖。
- INV-26 表名认领：本单复用 `harness_attempts/initiative_runs/tasks`，不建新表；BEH-04 真 PG 证明 schema 对齐。
- INV-27 消费方：新 capacity accounting 的消费者是 `harnessSlotCheck`，BEH-05 覆盖闭环。
- INV-28 多端完整：provider 覆盖 Claude/Codex/Grok，BEH-01/07 覆盖。
- INV-29 语义一致：`provider/account` 在 snapshot、attempt、role_assignment、candidate 四处同名同义。
- INV-30 git ref verify：N/A，本单不新增 git ref 判定。
- INV-31 生产资源：BEH-04 只插入隔离 UUID fixture 并清理；E2E 默认只读 task 与测试 DB。
- INV-32 部署失败：P0 review_required 阻止未批准 deploy；BEH-08 覆盖。
- INV-33 生产真相：容量病灶以 PRD 生产实锤为准；验收用真实 `harnessSlotCheck` 与 PG。
- INV-34 lint 测试质量：合同测试不使用直接 source-only 代替行为；source 检查只放 ARTIFACT。
- INV-35 表格格式：contract-draft Test Contract 为固定四列且 Test File 用 backtick。
- INV-36 Red 提交：Generator 必须精确 add 测试路径，不得 `git add .`。
- INV-37 源码检查：dispatcher 接线静态检查只作 ARTIFACT，行为由 BEH-05/06 覆盖。
- INV-38 cron/JOBS：N/A，本单不新增 cron。
- INV-39 merge 权限：Generator 只推分支/PR，不得 merge；P0 review gate 由 BEH-08 记录。
- INV-40 环境透传：真实调用 shape 要求 `role_assignments` 透传，不依赖 shell 环境。
- INV-41 历史合同：本合同读取当前 slot-allocator/llm-capacity/attempt-store，不复用旧 Claude-only 假设。
- INV-42 共享 CI 禁区：本合同不授权 `.github/workflows/*.yml` 修改。
- INV-43 SHA 核验：P0 review_required；controller/evaluator 仍负责 SHA 对账。
- INV-44 smoke 铁律（重复）：同 INV-08。
- INV-45 smoke 登记：Generator 若改 brain/src 必须按现有 DevGate/smoke 登记。
- INV-46 task 接线：N/A，本单不新增 task_type。
- INV-47 双信号服务存活：N/A，本单不改常驻服务。
- INV-48 LaunchDaemon：N/A，本单不新增宿主服务。
- INV-49 常驻清单：N/A，本单不新增常驻服务。
- INV-50 smoke 铁律（重复）：同 INV-08。
- INV-51 单 slot 串行：task-plan 仅 ws1，一个实现者。
- INV-52 环境假设：账号容量来自 snapshot/DB，不写死屏幕/host 假设；默认 DB_URL 可覆盖。
- INV-53 真环境接缝：DB occupancy 和 harnessSlotCheck 必须真验；未真验不得标 done。
- INV-54 多租户：N/A，Harness capacity 表当前无 tenant 字段；本单不触租户数据。
- INV-55 凭据安全：不记录 token；llm-capacity 只输出账号可用性和 safe concurrency。
- INV-56 日志脱敏：capacity reason 不含凭据或 prompt。
- INV-57 端点鉴权：本单不新增 API endpoint。
- INV-58 租户隔离：N/A，本单不改租户查询。

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

HARNESS_TASK_ID="${HARNESS_TASK_ID:-9315c992-7061-4d17-8c88-628ed0eb0be2}"
TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/$HARNESS_TASK_ID")
echo "$TASK_JSON" | jq -e --arg id "$HARNESS_TASK_ID" '
  .id == $id
  and ((.payload.sprint_dir // "") == "sprints/07272205-kernel-9315c992")
' >/dev/null

DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run \
  sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts \
  sprints/07272205-kernel-9315c992/tests/kernel-attempt-occupancy.pg.contract.test.ts \
  packages/brain/src/__tests__/harness-slot-check.test.js \
  packages/brain/src/__tests__/harness-slot-check-kernel.test.js \
  packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js \
  packages/brain/src/__tests__/llm-capacity.test.js \
  packages/brain/src/__tests__/llm-capacity-pool.test.js

bash scripts/check-version-sync.sh
```
