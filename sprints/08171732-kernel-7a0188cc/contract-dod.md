---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 gan_no_push_streak 误判（提案 remote 退 origin + 缺 base_repo 不兜底）

**范围**: packages/brain kernel 观测（ground-truth.js 提案 remote 解析 / derive.js gan_no_push 触发条件 + 重观测 / work-routing-store.js 缺 base_repo 回填）；Brain semver 四处同步。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] ground-truth.js 导出纯函数 resolveProposalRemote（base_repo→repo 兜底 + 禁退 origin）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!/export function resolveProposalRemote/.test(c)||!/proposalRemoteUnresolved/.test(c))process.exit(1)"

- [ ] [ARTIFACT] work-routing-store.js 导出 canonicalRepoCloneUrl 并在 createRoutedTask 回填 payload.base_repo
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/work-routing-store.js','utf8');if(!/export function canonicalRepoCloneUrl/.test(c)||!/base_repo/.test(c))process.exit(1)"

- [ ] [ARTIFACT] derive.js 消费两个新 failure_reason 与 crossCheckMismatch 重观测
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/proposal_remote_unresolved/.test(c)||!/proposal_observation_mismatch/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 真 PG 集成测试落位（Generator 复用 seedActiveF1 验 base_repo 回填）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/work-routing-base-repo.integration.test.js')"

## BEHAVIOR 条目（五行剧本，evaluator 原样执行）

- [ ] [BEHAVIOR] [L2] B-01: 提案 remote 解析走 base_repo→repo 兜底并打 GitHub URL（观测到真 push 分支 rn≥1）
  动作: 对 payload={repo:'cecelia'}（base_repo 空）与 payload={} 两种输入跑 ground-truth 合同测试
  预期观察: 前者 ls-remote 命令串含 github.com/perfectuser21/cecelia.git 且 proposeBranchRn=1；后者不打 origin 且 proposalRemoteUnresolved=true
  等待预算: 0s
  留证: vitest 输出末 5 行（含 pass 计数）进 log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run --no-cache sprints/08171732-kernel-7a0188cc/tests/ground-truth-proposal-remote.test.ts --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: derive 消费观测——crossCheckMismatch 时不误判 gan_no_push_streak + unresolved 独立失败
  动作: 对 crossCheckMismatch=true/false、proposalRemoteUnresolved=true、连续 0/2/3 次观测故障各输入跑 derive 合同测试
  预期观察: crossCheckMismatch=true 走 wait:running(proposal_observation_mismatch)、3 次后 mark_failed(proposal_observation_mismatch)；unresolved→mark_failed(proposal_remote_unresolved)；crossCheckMismatch=false 仍 gan_no_push_streak
  等待预算: 0s
  留证: vitest 输出末 5 行进 log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run --no-cache sprints/08171732-kernel-7a0188cc/tests/derive-gan-observation.test.ts --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-03: 建任务口 base_repo 短名/别名规范化为完整 clone URL，未知短名不猜测
  动作: 对 'cecelia'/'zenithjoy'/完整 URL/未知短名跑 canonicalRepoCloneUrl 合同测试
  预期观察: cecelia→https://github.com/perfectuser21/cecelia.git；zenithjoy→…/zenithjoy-workspace.git；完整 URL 幂等；未知短名返回 null
  等待预算: 0s
  留证: vitest 输出末 5 行进 log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run --no-cache sprints/08171732-kernel-7a0188cc/tests/work-routing-base-repo.test.ts --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-04: DB 写路径真验——缺 base_repo 的 coding_mutation 任务落库为完整 URL [接缝×2]
  动作: 用注入的 scratch DB_URL bootstrap 空库后，跑 base_repo 回填真 PG 集成测试，psql 真查 tasks.payload
  预期观察: within 5min 出现 payload->>'work_kind'='coding_mutation' 且 payload->>'base_repo'='https://github.com/perfectuser21/cecelia.git' 的新行
  等待预算: 120s
  留证: psql 查询输出（count≥1）进 evidence
  Test: manual:bash -c 'set -euo pipefail; : "${DB_URL:?}"; cd /workspace; (cd packages/brain && DB_URL="$DB_URL" DATABASE_URL="$DB_URL" npx vitest run --no-cache ./src/__tests__/integration/work-routing-base-repo.integration.test.js --reporter=basic); C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE payload->>'"'"'work_kind'"'"'='"'"'coding_mutation'"'"' AND payload->>'"'"'base_repo'"'"'='"'"'https://github.com/perfectuser21/cecelia.git'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "${C:-0}" -ge 1 ] || { echo "FAIL: 无 base_repo 回填落库"; exit 1; }; echo OK'

## Invariant 覆盖条目（铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [retry_identity] 重观测不得伪造新失败——crossCheckMismatch=true 时不递增 noPushStreak，前 3 次只 wait:running 重观测
  动作: 跑 derive 合同测试的 crossCheckMismatch 重观测用例（2 次未失败 / 3 次才失败）
  预期观察: 2 次 mismatch → action=wait:running 非 mark_failed；3 次 → mark_failed(proposal_observation_mismatch)
  等待预算: 0s
  留证: vitest 输出进 log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run --no-cache sprints/08171732-kernel-7a0188cc/tests/derive-gan-observation.test.ts --reporter=basic'

- [ ] [BEHAVIOR] [L2] INV-2 [真观测优先] 真实 push 的提案分支绝不算成 no-push——退本地 origin 属禁止行为
  动作: 跑 ground-truth 合同测试（URL 侧有两条 propose 分支、origin 侧空）
  预期观察: proposeBranchRn=1（打 GitHub URL 观测到真 push），无 ls-remote --heads origin 命令
  等待预算: 0s
  留证: vitest 输出进 log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run --no-cache sprints/08171732-kernel-7a0188cc/tests/ground-truth-proposal-remote.test.ts --reporter=basic'

- INV-3 [planner_role_branch] N/A：本单不涉及 provider 自行 checkout/switch 分支（纯 kernel 观测 + 建任务口 payload 规范化）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——A/B 逻辑由真实 ground-truth/derive 代码路径验证（仅注入 git 子进程与 DB 读），C 的 DB 写路径由真 Postgres 集成测试（B-04，seedActiveF1 真 PG）验证，无 force_*/stub/假数据顶替真实链路点。
