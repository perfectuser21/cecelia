---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 gan_no_push_streak 误判（提案分支观测退本地 origin + 缺 base_repo 不兜底）

**范围**: packages/brain 三处修改（ground-truth.js remote 解析 + derive.js 误判闸 + work-routing-store.js 建单回填）；新增 `initiative_runs.failure_reason` 两个字符串值；Brain semver 四处同步；DevGate 三项。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] ground-truth.js 导出可测单元 observeProposalBranch
  Test: manual:bash -c 'cd /workspace && node -e "import(\"./packages/brain/src/orchestrator/ground-truth.js\").then(m=>process.exit(typeof m.observeProposalBranch===\"function\"?0:1))"'
  期望: exit 0

- [ ] [ARTIFACT] derive.js 含新 failure_reason 字符串值 proposal_remote_unresolved / proposal_observation_mismatch
  Test: manual:bash -c 'cd /workspace && grep -q "proposal_remote_unresolved" packages/brain/src/orchestrator/derive.js && grep -q "proposal_observation_mismatch" packages/brain/src/orchestrator/derive.js && echo OK || { echo FAIL; exit 1; }'
  期望: OK

- [ ] [ARTIFACT] 合同冻结测试三文件落位 sprints/08170843-kernel-0a8f1e2f/tests/
  Test: manual:bash -c 'cd /workspace && ls sprints/08170843-kernel-0a8f1e2f/tests/ground-truth-proposal-remote.test.js sprints/08170843-kernel-0a8f1e2f/tests/derive-no-push-gate.test.js sprints/08170843-kernel-0a8f1e2f/tests/work-routing-base-repo-backfill.test.js >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'
  期望: OK

## BEHAVIOR 条目（五行剧本，autonomous — L2 服务端真验，manual:bash 内嵌单行命令）

- [ ] [BEHAVIOR] [L2] B-01: ground-truth 提案 remote 走 GitHub URL 不退 origin
  动作: 以 taskPayload={repo:'cecelia'}（无 base_repo）调 observeProposalBranch，注入 execCmd spy
  预期观察: ls-remote 命令串含 https://github.com/perfectuser21/cecelia.git，无裸 origin；proposalRemoteUnresolved=false
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/ground-truth-proposal-remote.test.js -t "命令串走 GitHub URL" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: remote 双空 → 不执行 ls-remote origin，proposalRemoteUnresolved=true
  动作: 以 taskPayload={}（base_repo 与 repo 皆空）调 observeProposalBranch，注入 execCmd spy
  预期观察: 无任何 ls-remote 调用；proposalRemoteUnresolved=true；proposeBranchRn=0
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/ground-truth-proposal-remote.test.js -t "不执行 ls-remote origin" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: 回归夹具 run 7a8e5319 复现 rn=0→rn=1 [接缝×2]
  动作: 注入假 ls-remote（对 GitHub URL 返两条 propose 分支、对 origin 返空）调 observeProposalBranch
  预期观察: 新码 proposeBranchRn===1，proposeBranch 命中最高 attempt 分支；对照 origin-only 假 exec → rn=0
  等待预算: 0s
  留证: vitest 输出末 5 行（含两条对照用例）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/ground-truth-proposal-remote.test.js -t "GitHub URL 返两条 propose 分支" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: derive crossCheckMismatch=true 不判 gan_no_push_streak
  动作: 构造 observed（counters.crossCheckMismatch=true, noPushStreak=MAX_NO_PUSH_STREAK）调 derive
  预期观察: 返回 reason !== 'gan_no_push_streak' 且 phase !== 'failed'（观测故障重新观测）
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/derive-no-push-gate.test.js -t "不判 gan_no_push_streak" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: derive proposalRemoteUnresolved=true → reason=proposal_remote_unresolved
  动作: 构造 observed.proposalRemoteUnresolved=true 调 derive
  预期观察: 返回 action='mark_failed'，reason='proposal_remote_unresolved'（独立 failure_reason，不记 gan_no_push_streak）
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/derive-no-push-gate.test.js -t "proposal_remote_unresolved" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-06: derive mismatch 连续 3 次 → reason=proposal_observation_mismatch
  动作: 构造 observed（crossCheckMismatch=true, proposalObservationMismatchStreak>=3）调 derive
  预期观察: 返回 action='mark_failed'，reason='proposal_observation_mismatch'
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/derive-no-push-gate.test.js -t "proposal_observation_mismatch" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-07: 建单口缺 base_repo 回填完整 GitHub URL
  动作: 用 fake client 调 createRoutedTask（coding_mutation, repo=cecelia, 不带 base_repo），捕获 INSERT INTO tasks 参数
  预期观察: 落库 payload.base_repo === 'https://github.com/perfectuser21/cecelia.git'；已带 base_repo 时不覆盖
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/work-routing-base-repo-backfill.test.js -t "为完整 GitHub URL" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] INV-1 [Brain URL 权威]: kernel 观测提案分支走 Brain 授权 GitHub URL，禁退本地 origin
  动作: 运行 ground-truth 冻结测试全量（remote 解析 + 回归夹具）
  预期观察: 全部 remote 解析走 GitHub URL / 不退 origin 的用例过
  等待预算: 0s
  留证: vitest 输出
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/ground-truth-proposal-remote.test.js >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] INV-3 [failure 归因]: 观测/基础设施故障不得记成 GAN 逻辑失败终态
  动作: 运行 derive 冻结测试全量（含零回归：crossCheckMismatch=false 仍判 gan_no_push_streak）
  预期观察: 观测故障走独立 failure_reason；真无 push（无 mismatch）仍照旧 gan_no_push_streak
  等待预算: 0s
  留证: vitest 输出
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/derive-no-push-gate.test.js >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- INV-2 [planner role branch]: N/A —— 本 sprint 不触及 planner 的 checkout/switch/PLANNER_BRANCH 逻辑。

## 铁律与历史约束映射

- 累积 FR: context-manifest unavailable（本 line 暂无历史 FR）；无需回退保护条目。
- Invariant: INV-1 / INV-3 见上 BEHAVIOR；INV-2 显式 N/A。

## 未覆盖真实链路清单

（本合同无 mock 豁免。ground-truth/work-routing 冻结测试用既有 `execCmd`/fake client seam 做依赖注入，非 mock 被改的边；真 PG 落库路径由 `## E2E 验收` local_api 脚本覆盖。N/A）
