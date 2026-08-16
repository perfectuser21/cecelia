---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 gan_no_push_streak 误判（提案分支观测退回本地 origin + 缺 base_repo 不兜底）

**范围**: `ground-truth.js` 提案 remote 解析加 repo 兜底 + 禁退 origin；`derive.js` gan_no_push_streak 门 crossCheckMismatch + 两个独立 failure_reason；`work-routing-store.js` 建任务口回填规范 base_repo URL。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] ground-truth.js 导出 resolveProposalRemote / observeProposalBranch，且不再对无法解析 remote 时退 origin
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!c.includes('resolveProposalRemote')||!c.includes('observeProposalBranch')||!c.includes('proposalRemoteUnresolved'))process.exit(1)"

- [ ] [ARTIFACT] derive.js 新增两个独立 failure_reason 字面值
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('proposal_remote_unresolved')||!c.includes('proposal_observation_mismatch'))process.exit(1)"

- [ ] [ARTIFACT] work-routing-store.js 导出 canonicalBaseRepoUrl 并在 coding_mutation 缺 base_repo 时回填 payload.base_repo
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/work-routing-store.js','utf8');if(!c.includes('canonicalBaseRepoUrl')||!c.includes('base_repo'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [L2] B-01: work-routing canonicalBaseRepoUrl 短名/别名规范化为完整 clone URL
  动作: 运行 work-routing 冻结合同测试，真调 canonicalBaseRepoUrl（cecelia / owner-repo / 空值）
  预期观察: 短名 cecelia 与 owner/repo 皆得 https://github.com/perfectuser21/cecelia.git；空值/未知返回 null
  等待预算: 0s
  留证: vitest 输出末尾 pass 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170551-kernel-73870d1b/tests/work-routing-base-repo-backfill.test.ts --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: ground-truth 用 GitHub URL 而非 origin 观测提案分支，回归夹具 rn=1 [接缝×2]
  动作: 运行 ground-truth 冻结合同测试（复现 run 7a8e5319，假 ls-remote 对 URL 返两条分支、对 origin 返空）
  预期观察: base_repo 空 repo=cecelia → proposeBranchRn=1 且 ls-remote 命中 GitHub URL；base_repo 与 repo 皆空 → 不发 ls-remote、proposalRemoteUnresolved=true
  等待预算: 0s
  留证: vitest 输出末尾 pass 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170551-kernel-73870d1b/tests/ground-truth-proposal-remote.test.ts --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: derive 消费 crossCheckMismatch 门控 gan_no_push_streak + proposal_remote_unresolved 独立终态
  动作: 运行 derive 冻结合同测试（crossCheckMismatch=true+noPushStreak>=MAX / proposalRemoteUnresolved=true / crossCheckMismatch 缺省零回归）
  预期观察: crossCheckMismatch=true 时不判 gan_no_push_streak；proposalRemoteUnresolved=true → reason=proposal_remote_unresolved；crossCheckMismatch 缺省仍判 gan_no_push_streak
  等待预算: 0s
  留证: vitest 输出末尾 pass 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170551-kernel-73870d1b/tests/derive-proposal-observation.test.ts --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: 独立观测 oracle——observeProposalBranch 用 GitHub URL 观测 rn=1，皆空不退 origin [接缝×2]
  动作: 运行独立 node oracle，真调 ground-truth 导出函数复现 run 7a8e5319 提案分支观测
  预期观察: 打印 OK（rn>=1 来自 GitHub URL；皆空场景 0 次 ls-remote 调用、unresolved=true）
  等待预算: 0s
  留证: oracle stdout 末行 OK
  Test: manual:bash -c 'cd /workspace && node sprints/08170551-kernel-73870d1b/tests/oracle-dryrun-observe.mjs'

- [ ] [BEHAVIOR] [L2] B-05: payload.base_repo 回填 URL 经真 Postgres JSONB 往返一致（scratch 库真 psql）
  动作: 运行 DB 写入类 oracle：node 真调 canonicalBaseRepoUrl 得 URL → psql 对 scratch 库 INSERT jsonb 再回读
  预期观察: psql 回读 payload->>'base_repo' 等于 https://github.com/perfectuser21/cecelia.git
  等待预算: 5s
  留证: oracle stdout 的 psql roundtrip 行 + OK 行
  Test: manual:bash -c 'cd /workspace && bash sprints/08170551-kernel-73870d1b/tests/oracle-db-backfill.sh'

## 已知约束映射（回归 / Invariant）

- [ ] [BEHAVIOR] INV-零回归 crossCheckMismatch 缺省/false 时 gan_no_push_streak 判死语义不变
  动作: 运行既有 derive 回归测试
  预期观察: derive.test.js「守护：no_push_streak >= 2 → failed」仍 green（reason=gan_no_push_streak）
  等待预算: 0s
  留证: vitest 输出 pass 行
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/orchestrator/__tests__/derive.test.js -t "no_push_streak" --reporter=dot'
