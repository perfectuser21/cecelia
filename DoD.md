# DoD — 阶段2 Slice 1：harness merge 后 staging 部署 + 自动 E2E（verdict 落库）

> Brain Task: 312fb32b-c7c4-470c-ade5-753200480278
> Spec: docs/superpowers/specs/2026-06-25-phase2-harness-to-production-design.md §3 Slice 1
> 范围：只到 verdict 落库。**不碰**人工放行/promote/production、**不动** report 位置（Slice 2/3）。

## 验收项

- [x] [ARTIFACT] migration 304 建 staging_e2e_results 表，pr_url 加 UNIQUE 约束（DB 级幂等防 tick 重入竞态）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/304_staging_e2e_results.sql','utf8');if(!c.includes('uniq_staging_e2e_results_pr_url')||!/UNIQUE INDEX/i.test(c))process.exit(1)"

- [x] [BEHAVIOR] 皇冠断言：staging E2E target 钉死 staging:5222，绝不退回 production:5221 或 PR 分支活宿主（根治 silent-success）
  Test: manual:node --input-type=module -e "import('./packages/brain/src/staging-e2e-runner.js').then(m=>{const t=m.resolveStagingTarget({id:'x',payload:{}});if(m.STAGING_PORT!==5222||!t.brainUrl.includes(':5222')||t.brainUrl.includes(':5221'))process.exit(1)})"

- [x] [BEHAVIOR] mergePrNode 两条 merged 分支（正常 merge + 已被外部合并幂等分支）都 best-effort 建 staging_e2e 任务，且 try/catch 永不 throw（staging 建失败绝不让 merge 倒）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');const n=(c.match(/_spawnStagingE2eTask\(state, opts\)/g)||[]).length;if(n<2)process.exit(1);const i=c.indexOf('async function _spawnStagingE2eTask');const f=c.slice(i,i+700);if(!/try/.test(f)||!/catch/.test(f)||/  throw /.test(f))process.exit(1)"

- [x] [BEHAVIOR] executor 有 staging_e2e 内部 handler 分支（同步执行、不派 agent、不碰 interrupt），且排在 retired 短路块之前不被拦截
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');const s=c.indexOf(\"task.task_type === 'staging_e2e'\");const r=c.indexOf('if (_RETIRED_HARNESS_TYPES.has(task.task_type)) {');if(s<0||r<0||s>r)process.exit(1)"

- [x] [BEHAVIOR] runStagingE2e 编排：部署 staging → 跑 E2E → verdict(pass/fail/skipped) 落 staging_e2e_results（ON CONFLICT DO NOTHING），staging 不可用优雅降级 skipped 不抛错
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/staging-e2e-runner.js','utf8');if(!/ON CONFLICT.*pr_url.*DO NOTHING/is.test(c)||!c.includes(\"verdict = 'skipped'\")||!c.includes('runStagingE2e'))process.exit(1)"

- [x] [BEHAVIOR] staging_e2e 是合法 task_type（task-router VALID_TASK_TYPES 含 staging_e2e，不被 invalid 拒绝）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes(\"'staging_e2e'\"))process.exit(1)"

## 成功标准

合一个候选 → mergePrNode 自动建 staging_e2e 任务 → 部署 :5222 staging → E2E 在真 staging 实例跑（target=staging:5222）→ verdict 落 staging_e2e_results。silent-success（合了但真环境坏）被本片挡住。全程不碰 interrupt、不建平行系统。
