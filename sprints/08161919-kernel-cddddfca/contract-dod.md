---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 gan_no_push_streak 误判（提案分支观测退 origin + 缺 base_repo 不兜底）

**范围**: packages/brain/src/orchestrator/ground-truth.js（提案 remote 解析）、
packages/brain/src/orchestrator/derive.js（gan_no_push_streak 守卫 + 两新 failure_reason）、
packages/brain/src/work-routing-store.js（createRoutedTask base_repo 回填）+ 三点冻结单测 + 版本四处同步。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 三份冻结合同单测存在于 sprints/08161919-kernel-cddddfca/tests/（禁放 src/__tests__/）
  Test: node -e "const fs=require('fs');['ground-truth-proposal-remote','derive-gan-no-push-guard','work-routing-base-repo-backfill'].forEach(n=>fs.accessSync('sprints/08161919-kernel-cddddfca/tests/'+n+'.test.js'))"
  期望: exit 0

- [ ] [ARTIFACT] Brain 版本 semver bump 四处同步（DevGate check-version-sync 通过）
  Test: node -e "const fs=require('fs');const v=require('./packages/brain/package.json').version;const sc=fs.readFileSync('packages/brain/src/selfcheck.js','utf8');if(!sc.includes(v))process.exit(1)"
  期望: exit 0（package.json 版本号出现在 selfcheck.js）

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 提案 remote 用规范 GitHub URL 观测到真实分支 rn=1
  动作: 以 payload.repo=cecelia（缺 base_repo）调 collectGroundTruth，fake execCmd 对 GitHub URL 返回两条提案分支、对 origin 返回空
  预期观察: ls-remote 命令串含 github.com/perfectuser21/cecelia.git 且不含 `ls-remote --heads origin`，observed.proposeBranchRn===1
  等待预算: 0s
  留证: vitest 输出末 5 行（ground-truth-proposal-remote.test.js 全绿）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run --root sprints/08161919-kernel-cddddfca tests/ground-truth-proposal-remote.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: base_repo 与 repo 皆缺 → 不跑 ls-remote origin，proposalRemoteUnresolved=true
  动作: 以空 payload 调 collectGroundTruth
  预期观察: execCmd 无含 origin 的 ls-remote 调用，observed.proposalRemoteUnresolved===true 且 proposeBranchRn===0
  等待预算: 0s
  留证: vitest 输出（同 B-01 文件内第 2 用例）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run --root sprints/08161919-kernel-cddddfca tests/ground-truth-proposal-remote.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-03: derive crossCheckMismatch 守卫 + proposal_remote_unresolved 独立因
  动作: 对 deriveGan 可达 observed 分别注入 counters.crossCheckMismatch=true+noPushStreak>=上限、以及 proposalRemoteUnresolved=true，调纯函数 derive
  预期观察: 前者 reason!=='gan_no_push_streak' 且 phase!=='failed'；后者 {phase:'failed',action:'mark_failed',reason:'proposal_remote_unresolved'}
  等待预算: 0s
  留证: vitest 输出（derive-gan-no-push-guard.test.js 前两用例绿）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run --root sprints/08161919-kernel-cddddfca tests/derive-gan-no-push-guard.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-04: 零回归——crossCheckMismatch=false 且真无 push 仍触发 gan_no_push_streak
  动作: 对 deriveGan 可达 observed 注入 counters.crossCheckMismatch=false+noPushStreak>=上限，调 derive
  预期观察: {phase:'failed', reason:'gan_no_push_streak'} 原语义不变
  等待预算: 0s
  留证: vitest 输出（derive-gan-no-push-guard.test.js 第 3 用例绿）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run --root sprints/08161919-kernel-cddddfca tests/derive-gan-no-push-guard.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-05: createRoutedTask 缺 base_repo 时 payload 回填规范 clone URL（捕获 client）
  动作: 用捕获 client 调 createRoutedTask，request 不带 base_repo、repo_hint=cecelia、map_scope_hint=['F1']
  预期观察: INSERT INTO tasks 的 payload 参数 base_repo==='https://github.com/perfectuser21/cecelia.git'
  等待预算: 0s
  留证: vitest 输出（work-routing-base-repo-backfill.test.js 绿）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run --root sprints/08161919-kernel-cddddfca tests/work-routing-base-repo-backfill.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-06: 真 PG 落库回读——createRoutedTask 缺 base_repo 建单后 tasks.payload->>'base_repo' 是完整 URL（带时间窗）
  动作: 对 Fleet 注入的 $DB_URL 真库跑仓库 migration 后，node 调真 createRoutedTask 落一条 coding_mutation 任务（不带 base_repo），再 psql 回读
  预期观察: tasks.payload->>'base_repo'==='https://github.com/perfectuser21/cecelia.git' 且 created_at 在近 5 分钟内
  等待预算: 60s
  留证: node+psql 输出末行（OK: base_repo=... ; DB row created_at 时间窗命中）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && : "${DB_URL:?need DB_URL}" && SID="dod-b06-$(date +%s)" && node -e '"'"'const pg=require("pg");const{createRoutedTask}=require("./packages/brain/src/work-routing-store.js");(async()=>{const p=new pg.Pool({connectionString:process.env.DB_URL});const r=await createRoutedTask(p,{source:"api",source_id:process.env.SID,title:"b06",description:"b06 backfill",mutation_intent:"write",declared_change_kind:"bugfix",repo_hint:"cecelia",map_scope_hint:["F1"],branch:"cp-dod-b06",base_sha:"a".repeat(40)},[{scope_key:"cecelia",repo:"cecelia",aliases:["perfectuser21/cecelia"]}]);const q=await p.query("SELECT payload->>\x27base_repo\x27 b FROM tasks WHERE id=$1 AND created_at>NOW()-interval \x275 minutes\x27",[r.task_id]);const g=q.rows[0]&&q.rows[0].b;if(g!=="https://github.com/perfectuser21/cecelia.git"){console.error("FAIL base_repo="+g);process.exit(1);}console.log("OK: base_repo="+g);await p.end();})().catch(e=>{console.error("ERR",e.message);process.exit(2);})'"'"''