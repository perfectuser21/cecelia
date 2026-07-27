---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Harness Reviewer Result Channel 与 Feedback Lineage

**范围**: 仅现有 HarnessResult v1、真实 read-only ACTION_SPECS result channel、callback/DB、
round 2 lineage 与 final-SHA approval gate。  
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `execution-contract.js` 仍声明 `RESULT_CONTRACT_VERSION = '1.0'`，
  且 Brain 行为版本已同步更新。
  Test: `node -e "const fs=require('fs');const a=fs.readFileSync('packages/brain/src/orchestrator/execution-contract.js','utf8');const b=fs.readFileSync('packages/brain/DEFINITION.md','utf8');if(!a.includes(\"RESULT_CONTRACT_VERSION = '1.0'\")||!b.includes('Reviewer result channel'))process.exit(1)"`

- [ ] [ARTIFACT] RCI 测试位于 Brain integration 测试域，显式读取 `TEST_DATABASE_URL`，
  且不含生产 DB 默认值。
  Test: `node -e "const fs=require('fs');const p='packages/brain/src/orchestrator/__tests__/kernel-review-lineage.pg.integration.test.js';const s=fs.readFileSync(p,'utf8');if(!s.includes('TEST_DATABASE_URL')||s.includes('postgresql://localhost/cecelia'))process.exit(1)"`

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] INV-5 只读 ACTION_SPECS 动态获得 attempt 隔离 result channel
  动作: 派发每个真实 `readOnly=true` action，并对独立 attempt channel 执行正常写入及
  escape/symlink/hardlink/cross-attempt/non-regular/owner/mode/missing-result 对抗。
  预期观察: `/workspace` 保持只读；合法 result 被 runner 收取，所有非法 channel 在 callback
  前 fail-closed；未来真实 read-only action 无需新增硬编码即可继承。
  验证命令: Test: manual:bash -c 'cd packages/brain && npx vitest run --root /workspace sprints/07272253-kernel-ba630704/tests/reviewer-lineage-contract.test.ts -t "只读 ACTION_SPECS 动态获得 attempt 隔离 result channel"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-1 HarnessResult v1 绑定并重算 canonical digest
  动作: 以真实 v1 envelope 提交正确、篡改、stale SHA、同 digest replay 与异 digest conflict，
  并加入 secret/transcript/chain-of-thought、超限 feedback/rubric 负载。
  预期观察: 正确 result 归一化；客户端绑定字段不覆盖服务端；tamper/超限/敏感内容拒绝且不反射；
  同 digest 幂等，异 digest 稳定冲突。
  验证命令: Test: manual:bash -c 'cd packages/brain && npx vitest run --root /workspace sprints/07272253-kernel-ba630704/tests/reviewer-lineage-contract.test.ts -t "HarnessResult v1 绑定并重算 canonical digest"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-2 真实 callback 持久化完整 decision 与有界摘要
  动作: 用生产调用方 header/body shape 经 supertest/HTTP 调真实 callback Router，连接显式隔离
  PostgreSQL，覆盖 success、400、401、404、409、500。
  预期观察: within 30s 成功行写入 `harness_attempts.result`，decision log 只含摘要；
  每个错误体严格为 `{ok:false,error:{key,code}}`，持久化失败无半写。
  验证命令: Test: manual:bash -c 'test -n "${TEST_DATABASE_URL:-}" || exit 1; cd packages/brain && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run --root /workspace sprints/07272253-kernel-ba630704/tests/kernel-review-lineage.pg.integration.test.ts -t "真实 callback 持久化完整 decision 与有界摘要"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-3 ground truth 构建 round2 prior_review 与 resolutions
  动作: 从已持久化 reviewer attempt 行恢复/续跑 round 2 proposer，提交 resolutions，再派发 fresh
  round 2 reviewer；并发 run、missing history、legacy/first-round、重复/未知/缺 feedback id 一并验证。
  预期观察: within 30s round 2 proposer/reviewer TaskBundle 只含同一权威 `prior_review` 与逐 id
  resolution；非首轮缺历史阻断，worktree prose 不影响结果。
  验证命令: Test: manual:bash -c 'test -n "${TEST_DATABASE_URL:-}" || exit 1; cd packages/brain && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run --root /workspace sprints/07272253-kernel-ba630704/tests/kernel-review-lineage.pg.integration.test.ts -t "ground truth 构建 round2 prior_review 与 resolutions"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-4 只有同一 final SHA 三重批准允许一次合并
  动作: 对首个 `review_required=true` P0 task 组合 evaluator、judge、human approval 的
  missing/stale/mismatched/final SHA 状态并执行既有 gate。
  预期观察: 所有负路径 merge/deploy 调用均为 0；仅三者锚定服务端 current head 的正路径各 1；
  generator 永无合并权。
  验证命令: Test: manual:bash -c 'test -n "${TEST_DATABASE_URL:-}" || exit 1; cd packages/brain && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run --root /workspace sprints/07272253-kernel-ba630704/tests/kernel-review-lineage.pg.integration.test.ts -t "只有同一 final SHA 三重批准允许一次合并"'
  期望: exit 0

## 铁律映射

- INV-1 `[凭据安全]` → Behavior 2 的敏感输入拒绝及响应/日志/DB 零命中。
- INV-2 `[真实成功]` → Behavior 3 的 callback+真实 DB 语义回读。
- INV-3 `[合并权]` → Behavior 4 只传反馈，不能以 prose/agent claim 合并。
- INV-4 `[SHA一致]` → Behavior 5 的 evaluator/judge/human final-SHA 三重锚定。
- INV-5 `[环境路由]` → Behavior 1 由 TaskBundle/ACTION_SPECS 与 local_api 路由，不自报环境。
