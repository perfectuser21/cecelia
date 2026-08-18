---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 gan_no_push_streak 误判（提案 remote 兜底链 + fail-closed）

**范围**: `packages/brain/src/orchestrator/ground-truth.js` 提案 remote 解析补 `?? taskPayload.repo` 兜底链（与 `discoverPrFromGithub` 对齐）+ 无法解析 GitHub slug 时对致盲 origin 盲查 fail-closed；新增回归测试永久保留。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] ground-truth.js 提案 remote 解析走 base_repo→repo 兜底链（含 `taskPayload.repo`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!/parseBaseRepo\(\s*taskPayload\.base_repo\s*\?\?\s*taskPayload\.repo\s*\)/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 本 sprint 回归测试文件存在且含根因锚点断言
  Test: node -e "const c=require('fs').readFileSync('sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts','utf8');if(!c.includes('ls-remote --heads origin')||!c.includes('collectGroundTruth'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 永久回归同源落进 brain 包内 orchestrator 测试（brain-CI 常驻，带唯一 marker 防假绿）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/ground-truth.test.js','utf8');if(!c.includes('gan_no_push_streak-fallback-regression'))process.exit(1)"
  期望: exit 0（generator 必须新增一条 it() 断言「缺 base_repo 有 repo → 打 GitHub remote 不退 origin」，其名或体含唯一 marker gan_no_push_streak-fallback-regression；既有 base_repo 用例已含 base_repo 字样，故用 marker 强制新增，杜绝假绿）

## BEHAVIOR 条目（五行剧本；Test 单行 manual:bash -c；target_environment=local_api，postgres 不参与）

- [ ] [BEHAVIOR] [L2] B-01: 缺 base_repo 但含 repo，ls-remote 打真实 GitHub remote 不退 origin
  动作: 构造 taskPayload 缺 base_repo、含 repo:"cecelia"，注入可记录命令的 fake execCmd，调 collectGroundTruth
  预期观察: 实际下发的 ls-remote 命令目标为 https://github.com/perfectuser21/cecelia.git，不含 "ls-remote --heads origin"
  等待预算: 0s
  留证: vitest reporter 输出（B-01 用例 PASS 行）+ 断言的命令字符串
  Test: manual:bash -c '(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t "B-01")'

- [ ] [BEHAVIOR] [L2] B-02: 缺 base_repo 但含 repo 且已推分支，observed.proposeBranchRn>=1
  动作: 同 B-01 场景，ls-remote 输出含一条已推 cp-harness-propose 分支，调 collectGroundTruth
  预期观察: observed.proposeBranchRn >= 1，observed.proposeBranch === 已推分支名（真提案被观测到，非恒 0）
  等待预算: 0s
  留证: vitest reporter 输出（B-02 用例 PASS 行）
  Test: manual:bash -c '(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t "B-02")'

- [ ] [BEHAVIOR] [L2] B-03: base_repo 与 repo 均不可解析，fail-closed 不发出 ls-remote --heads origin [接缝×2]
  动作: 构造 taskPayload 缺 base_repo 且缺 repo（均不可解析 GitHub slug），调 collectGroundTruth
  预期观察: execCmd.calls 中不存在匹配 /ls-remote --heads origin\b/ 的命令（origin 空结果永不成为「未推送」权威输入）
  等待预算: 0s
  留证: vitest reporter 输出（B-03 用例 PASS 行）+ 记录的 execCmd.calls 列表
  Test: manual:bash -c '(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t "B-03")'

- [ ] [BEHAVIOR] [L2] B-04: 回归 base_repo 正常可解析，仍打 GitHub remote 不退 origin
  动作: 构造 taskPayload base_repo="https://github.com/perfectuser21/cecelia.git" + repo="cecelia"，调 collectGroundTruth
  预期观察: ls-remote 命令目标仍为 https://github.com/perfectuser21/cecelia.git，行为逐字节不变（零回归红线）
  等待预算: 0s
  留证: vitest reporter 输出（B-04 用例 PASS 行）
  Test: manual:bash -c '(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t "B-04")'

- [ ] [BEHAVIOR] [L2] B-05: derive 后果——正确观测不产生 gan_no_push_streak，致盲观测才误判（根因锚点）
  动作: 用真 deriveCounters + 真 derive，喂两轮真推进 proposer 决策日志；正确观测 proposeBranchMaxRn=2，致盲观测=0
  预期观察: 正确观测 noPushStreak=0 且 derive().reason!='gan_no_push_streak'、action!='mark_failed'；致盲观测 noPushStreak>=2（误判条件成立，作对照锚点）
  等待预算: 0s
  留证: vitest reporter 输出（B-05 用例 PASS 行）
  Test: manual:bash -c '(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t "B-05")'

- [ ] [BEHAVIOR] [L2] INV-1 [观测真相]: 本地 origin 空结果不得作「未推送」权威累积 noPushStreak
  动作: 执行 B-03（均不可解析）与 B-01（缺 base_repo 有 repo）两路，核对无一路把 origin 盲查空结果当权威
  预期观察: 两路均不出现 ls-remote --heads origin 权威盲查（缺 base_repo 有 repo → 打 GitHub；均不可解析 → 不发盲查）
  等待预算: 0s
  留证: vitest reporter 输出（B-01 + B-03 均 PASS）
  Test: manual:bash -c '(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t "B-0(1|3)")'

- [ ] [BEHAVIOR] [L2] INV-2 [nightly-red 归因]: N/A——本 sprint 不触及 nightly job 失败归因逻辑，无回退面（显式 N/A）
  动作: N/A（铁律覆盖模块与本单无交集）
  预期观察: N/A
  等待预算: 0s
  留证: 本行显式 N/A 声明
  Test: manual:bash -c 'true # INV-2 N/A：本 sprint 不改 nightly-red 归因模块'

- [ ] [BEHAVIOR] [L2] B-06: 永久回归 + 零回归——brain 包内 orchestrator 测试全绿（含新增用例）
  动作: 用 packages/brain 自身 vitest 配置跑 ground-truth / counters / derive 测试（子 shell，禁从仓库根跑 src/**）
  预期观察: 三个测试文件全绿，既有用例（含「跨仓库任务从 payload.base_repo 查询」）不回退，新增 base_repo→repo 兜底用例通过
  等待预算: 0s
  留证: brain vitest reporter 输出（passed，无 failed）
  Test: manual:bash -c '(cd /workspace/packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/ground-truth.test.js ./src/orchestrator/__tests__/counters.test.js ./src/orchestrator/__tests__/derive.test.js)'
