# DoD — Slice1 修正（决策 C）：per-merge 触发 + pr_url 幂等

> 分支：cp-0625223242-staging-e2e-permerge-fix
> 修正对象：#3425（已合 main）的 per-initiative reportNode 无去重派生
> Spec: docs/superpowers/specs/2026-06-25-phase2-harness-to-production-design.md §3 Slice 1
> 范围：只到 verdict 落库。不碰人工放行/promote/report（Slice2/3）。复用 #3425 的 runner 骨架。

## 验收项

- [x] [ARTIFACT] migration 305 在已合 304 表上 ALTER 加 pr_url UNIQUE（不 CREATE TABLE，migration 只一份原则）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/305_staging_e2e_pr_url_unique.sql','utf8');if(/CREATE TABLE/i.test(c)||!/UNIQUE/i.test(c)||!c.includes('pr_url'))process.exit(1)"

- [x] [BEHAVIOR] reportNode 不再派生 staging_e2e（移除 per-initiative 无去重裸 INSERT，回归守卫防复活）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/export async function reportNode[\s\S]*?\n}\n/);if(m&&/INSERT INTO tasks[\s\S]{0,200}'staging_e2e'/.test(m[0]))process.exit(1)"

- [x] [BEHAVIOR] mergePrNode per-merge 派生 staging_e2e（两条 merged 分支都建，spec §3 "sub_task 合并后"原义），best-effort try/catch 永不 throw
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');const n=(c.match(/_spawnStagingE2eTask\(state, opts\)/g)||[]).length;if(n<2)process.exit(1);const i=c.indexOf('async function _spawnStagingE2eTask');const h=c.slice(i,c.indexOf('export async function mergePrNode',i));if(!/try/.test(h)||!/catch/.test(h)||/\bthrow\b/.test(h))process.exit(1)"

- [x] [BEHAVIOR] mergePrNode 派生幂等：INSERT 按 pr_url NOT EXISTS 去重（防 tick 重入重复建任务）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');const i=c.indexOf('async function _spawnStagingE2eTask');const h=c.slice(i,c.indexOf('export async function mergePrNode',i));if(!/NOT EXISTS|ON CONFLICT/i.test(h)||!/pr_url/.test(h))process.exit(1)"

- [x] [BEHAVIOR] recordResult 落 verdict 幂等：INSERT staging_e2e_results 用 ON CONFLICT(pr_url) DO NOTHING（per-merge 重入不抛错、不覆盖既有 verdict）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/staging-e2e-runner.js','utf8');if(!/INSERT INTO staging_e2e_results[\s\S]{0,400}ON CONFLICT[\s\S]{0,40}pr_url[\s\S]{0,40}DO NOTHING/i.test(c))process.exit(1)"

- [x] [BEHAVIOR] 皇冠断言保留：staging E2E target 钉死 :5222（STAGING_PORT=5222，runStagingCommand 把 :5221→:5222），不退回 production
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/staging-e2e-runner.js','utf8');if(!/STAGING_PORT\s*=\s*5222/.test(c)||!/5221/.test(c))process.exit(1)"

## 成功标准

harness sub_task 合并后（per-merge），mergePrNode 自动建 staging_e2e 任务（两条 merged 分支、pr_url 幂等）→ 复用 #3425 runner 部署 :5222 + 真 staging 实例跑 contract E2E → verdict 落 staging_e2e_results（ON CONFLICT 幂等）。reportNode 不再 per-initiative 无去重派生。silent-success 被挡住，且不会重复派任务。
