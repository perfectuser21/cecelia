---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel Knife1 Recovery 3：PR #4372 F1 等价基线收口

**范围**: current-main 重绑、PR `#4372` Draft 收口、migration 366 双跑稳定、evaluator 测试库护栏、F1 fail-closed suite、same-SHA approval/judge/evaluator 只读证明、风险显式化
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/migrations/366_kernel_harness_f1_baseline.sql` 存在且成为 F1 唯一 baseline migration
  Test: node -e "const fs=require('fs');const p='packages/brain/migrations/366_kernel_harness_f1_baseline.sql';if(!fs.existsSync(p))process.exit(1);const t=fs.readFileSync(p,'utf8');if(!/schema_version|CREATE|ALTER|INDEX|CONSTRAINT|INSERT/i.test(t))process.exit(1)"

- [ ] [ARTIFACT] evaluator 入口导出 `validateHarnessTestDatabaseUrl` 或同等命名的写前安全守卫
  Test: node -e "import('./packages/engine/src/harness/evaluate.js').then(m=>{if(typeof m.validateHarnessTestDatabaseUrl!=='function')process.exit(1);}).catch(()=>process.exit(1))"

- [ ] [ARTIFACT] F1 等价 suite 固定落点 `packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh`
  Test: node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh';if(!fs.existsSync(p))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [L2] current main 漂移会作废旧 merge-base 证据并重绑 final head SHA
  动作: 读取 current `origin/main` 与 PR `#4372` 当前 head SHA
  预期观察: 若 current main 不等于 `1dc9d4107`，旧 merge-base/old checks/old approvals 全部视为 stale；PR 仍 Draft
  Test: manual:bash -c 'git fetch origin main --quiet && CUR=$(git rev-parse origin/main) && PR=$(gh pr view 4372 --json isDraft,headRefOid,autoMergeRequest) && [ -n "$CUR" ] && echo "$PR" | jq -e ".isDraft==true and .autoMergeRequest==null and (.headRefOid|type==\"string\")" >/dev/null && [ "$CUR" != "1dc9d4107" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 六个重叠语义面对 current main 零 conflict marker 且零 parallel old/new behavior path
  动作: 运行语义面对账套件，对 current main 而不是旧 merge-base 做逐项比对
  预期观察: 没有 `<<<<<<<`/`=======`/`>>>>>>>`，没有 parallel old/new behavior path，同一语义面只保留 current-main 兼容实现
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "六个重叠语义面与 current main 对账" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] migration 366 文件存在且双跑稳定快照可验证
  动作: 在同一个 isolated DB 中连续执行 migration 366 两次，并抓取 schema/data/index/constraint 快照
  预期观察: 第二次执行后快照与第一次等价，不依赖五分钟 `schema_version` 行；仓库合法历史 363/364/365 文件继续存在
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "migration 366 文件存在且双跑稳定快照可验证" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] HARNESS_TEST_DATABASE_URL 写前 fail-closed
  动作: 用 `cecelia`、`postgres`、`127.0.0.1`、非 `host.docker.internal`、以及合法 `*_test|preview_*` URL 分别调用 evaluator 写前守卫
  预期观察: 非法 URL 在任何连接/写入前失败；合法 URL 需继续校验 `current_database()` 与 `inet_server_addr()`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "HARNESS_TEST_DATABASE_URL 写前 fail-closed" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 合法测试库必须要求 host.docker.internal 与白名单库名并回读 current_database/inet_server_addr
  动作: 以合法 `HARNESS_TEST_DATABASE_URL` 真连隔离库并执行 `SELECT current_database(), inet_server_addr()`
  预期观察: 库名仅允许 `*_test` 或 `preview_*`；server addr 非空且不接受 `127.0.0.1`
  Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; psql "$HARNESS_TEST_DATABASE_URL" -t -A -c "SELECT current_database() || ''|'' || COALESCE(inet_server_addr()::text,'''')" | awk -F"|" '"'"'NF==2 && $1 ~ /(_test$|^preview_)/ && $2 != "127.0.0.1" && length($2)>0 {ok=1} END{exit ok?0:1}'"'"''
  期望: exit 0

- [ ] [BEHAVIOR] [L2] F1 fail-closed 套件覆盖七个 legacy smokes 与 exact oracle
  动作: 真执行 F1 suite 入口，串行覆盖合同 oracle、真实集成测试、端点语义、运行时非回归、DevGate/current-SHA、以及七个具名 legacy smokes
  预期观察: suite 不含 `|| true` 或 grep-only proxy；最终 summary 精确断言 `1 journey / S0-S12 / 143 cells / 11 elements / 8 legacy families`
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh --print-summary | jq -e ".journeys==1 and .cells==143 and .elements==11 and .legacy_families==8 and .steps==[\"S0\",\"S1\",\"S2\",\"S3\",\"S4\",\"S5\",\"S6\",\"S7\",\"S8\",\"S9\",\"S10\",\"S11\",\"S12\"]" >/dev/null'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 同 SHA evaluator judge human review 只读证明路径存在
  动作: 运行 same-SHA fixture，读取 server-owned evaluator PASS、judge PASS、human approval 记录并对当前 head SHA 对账
  预期观察: 三条记录都绑定同一 final head SHA；head 变化后旧记录立刻失效且 required checks 不可复用
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "同 SHA evaluator judge human review 只读证明路径存在" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] PR #4372 仍为 Draft 且 review_required 继续由服务端持有
  动作: 读取 PR `#4372` 当前状态与 ground-truth/derive/gates 同 SHA 规则
  预期观察: `isDraft=true`、`autoMergeRequest=null`；`review_required=true` 时双 PASS 仍等待 human review；不允许 evaluator PASS 代替人工批准
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "PR 4372 保持 Draft 且 review_required 由服务端控制" --reporter=verbose'
  期望: exit 0

## Invariant 条目（逐条映射 PRD 铁律）

- [ ] [BEHAVIOR] [L2] INV-1 target_environment 仍从 tasks.payload 读取并保持 `local_api`
  动作: 读取 sprint PRD 与 kernel 任务派发输入
  预期观察: `target_environment=local_api`，不从文件旁路覆盖
  Test: manual:bash -c 'grep -q "^## target_environment: local_api" sprints/07272235-kernel-aee91b5d/sprint-prd.md'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-2 judge `.brain-result.json` 结构仍含 `exit_code`/`log_tail`/`behavior_tests[]`
  动作: 读取 `packages/brain/src/harness-judge.js` 机械预检逻辑
  预期观察: 缺任一字段即 FAIL，结构不退化
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const t=fs.readFileSync(\"packages/brain/src/harness-judge.js\",\"utf8\");[\"behavior_tests\",\"exit_code\",\"log_tail\"].forEach(k=>{if(!t.includes(k))process.exit(1)});"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-3 PR head SHA 变化时 evaluator/judge verdict 必须重对账
  动作: 读取 derive/gates/ground-truth same-SHA 规则并运行 fixture
  预期观察: stale verdict 不满足 merge gate
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "同 SHA evaluator judge human review 只读证明路径存在" --reporter=verbose'
  期望: exit 0

- N/A：INV-4 CI 共享基础设施文件未经合同授权不可改。原因：本合同未授权修改共享 CI 基础设施，只要求新增/调整本 sprint 直连 smoke 与 tests。
- N/A：INV-5 `feat+brain/src` 类 PR 开 PR 前带齐 smoke/allowlist。原因：本 sprint 验收要求已把七个 legacy smokes 与 F1 suite 纳入，不额外改铁律本体。
- [ ] [BEHAVIOR] [L2] INV-6 复用历史合同模板前先核对本次真实派发/执行历史
  动作: 读取本 PRD 与旧 proposer/reviewer 历史证据
  预期观察: 旧 proposer commit 与 reviewer attempt 仅作为 evidence，不是 current approval
  Test: manual:bash -c 'grep -q "d8db6d9f07711fec53d5c88dce60ad03066dfeea" sprints/07272235-kernel-aee91b5d/contract-draft.md && grep -q "6dc36461-01db-443c-9e71-31b7895386dd" sprints/07272235-kernel-aee91b5d/contract-draft.md'
  期望: exit 0

- N/A：INV-7 manual-exit-code 记录真实 exit code。原因：由 evaluator/judge 执行期落证，本合同只要求 fail-closed oracle，不改结果文件协议。
- N/A：INV-8 `node -e` 双引号中的 `${}` 必须真跑。原因：本合同行为命令已尽量避免复杂 `${}`，Generator 实现期按真跑落实。
- [ ] [BEHAVIOR] [L2] INV-9 任何失败路径禁止 warning 降级
  动作: 检查 F1 suite 与 evaluator guard
  预期观察: 不存在 `|| true`、`exit 0` fallback、warning-only 放行
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");for(const p of [\"packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh\",\"packages/engine/src/harness/evaluate.js\"]){if(!fs.existsSync(p))process.exit(1);const t=fs.readFileSync(p,\"utf8\");if(/\\|\\| true|else\\s+exit 0|warning.*pass/i.test(t))process.exit(1);}"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-10 判变与验收使用生产实体或目标实体自报 SHA 对账 current origin/main
  动作: 读取 git/gh current sha 与 same-SHA fixture
  预期观察: 不依赖旧 merge-base 或旁路缓存
  Test: manual:bash -c 'git fetch origin main --quiet && gh pr view 4372 --json headRefOid >/tmp/pr.json && jq -e ".headRefOid|type==\"string\"" /tmp/pr.json >/dev/null'
  期望: exit 0

- N/A：INV-11 单 slot/单会话内严格串行。原因：本合同仅定义收口与验收，不改变 slot 调度实现。
- [ ] [BEHAVIOR] [L2] INV-12 禁写死环境：测试 host/库名从 env 或真验证据导出
  动作: 检查 evaluator guard 与 E2E 脚本
  预期观察: 不硬编码生产库/默认库；只接受 env 提供的 `HARNESS_TEST_DATABASE_URL`
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const t=fs.readFileSync(\"sprints/07272235-kernel-aee91b5d/contract-draft.md\",\"utf8\");if(t.includes(\"postgresql://localhost/cecelia\"))process.exit(1);"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-13 真环境接缝必须在真目标上验证
  动作: 对 migration 双跑、写前 DB 校验、same-SHA 记录都跑真 PG / 真 route / 真 git/gh
  预期观察: 不以 mock/静态 grep 代替接缝断言
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts --reporter=verbose'
  期望: exit 0

- N/A：INV-14 默认多租户。原因：本 sprint 核心是 isolated test DB 与 SHA/approval 收口，不新增跨租户数据读写路径。
- N/A：INV-15 secrets 不进 git/日志。原因：本合同不引入新 secrets，只要求读取现有 approver token / test DB URL。
- N/A：INV-16 日志脱敏。原因：本 sprint 不新增用户内容日志面。
- N/A：INV-17 租户隔离。原因：本 sprint 不新增租户数据读写路径。

