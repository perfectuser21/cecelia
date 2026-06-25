# DoD — Slice 2：人工放行闸 + production promote

> 分支：cp-0625230344-slice2-promote-gate
> Spec: docs/superpowers/specs/2026-06-25-phase2-harness-to-production-design.md §3 Slice 2
> 建立在 Slice1 的 staging_e2e verdict 上。决策1：跨repo边界保持（本repo只到 pending+通知+回流接口）；决策2：base_repo 缺失→保守 pending。

## 验收项

- [x] [ARTIFACT] migration 306 在已合表上 ALTER 加 promote_status 列 + CHECK 约束（不 CREATE TABLE，不动 304/305）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/306_staging_e2e_promote_status.sql','utf8');if(/CREATE TABLE/i.test(c)||!/ADD COLUMN/i.test(c)||!c.includes('promote_status'))process.exit(1)"

- [x] [BEHAVIOR] 客户线(zenithjoy)/内部线(cecelia) 判定 + base_repo 缺失保守 pending（决策2）
  Test: manual:node --input-type=module -e "import('./packages/brain/src/staging-promote.js').then(m=>{if(m.resolveLine('x/zenithjoy-workspace')!=='customer'||m.resolveLine('x/cecelia')!=='internal'||m.resolveLine('')!=='unknown')process.exit(1);if(m.decidePromote({verdict:'PASS',baseRepo:''}).action!=='pending')process.exit(1)})"

- [x] [BEHAVIOR] 内部线 auto-promote 必须注入 promoteExec（fail-safe：无注入拒绝跑真脚本，绝不误打 :5211 live）
  Test: manual:node --input-type=module -e "import('./packages/brain/src/staging-promote.js').then(async m=>{const r=await m.runInternalPromote({});if(r.ok!==false||r.promoteStatus!=='promote_failed')process.exit(1)})"

- [x] [BEHAVIOR] runStagingE2E PASS 后接 handlePromote 分流；mergePrNode payload 带 base_repo
  Test: manual:node -e "const r=require('fs').readFileSync('packages/brain/src/staging-e2e-runner.js','utf8');if(!/handlePromote/.test(r)||!/base_repo/.test(r))process.exit(1);const g=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');const i=g.indexOf('async function _spawnStagingE2eTask');const h=g.slice(i,g.indexOf('export async function mergePrNode',i));if(!/base_repo/.test(h))process.exit(1)"

- [x] [BEHAVIOR] 回流接口 POST /promote/:resultId 幂等状态机（仅 pending_promote 可放行，否则 409；不存在 404；非法 uuid 400）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/promote/:resultId')||!/pending_promote/.test(c)||!/409/.test(c)||!/404/.test(c))process.exit(1)"

- [x] [BEHAVIOR] 内部线 auto-promote 集成测试用 mock，证明绝不打真生产（promoteExec 被调但是 mock）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/staging-e2e-runner-promote.test.js','utf8');if(!/promoteExec/.test(c)||!/auto_promoted/.test(c)||!/not.toHaveBeenCalled/.test(c))process.exit(1)"

## 成功标准

staging E2E PASS 后：内部线(cecelia) 自动 promote（in-repo promote-dashboard.sh，测试必 mock）→ auto_promoted；客户线(zenithjoy)/base_repo缺失 → pending_promote + 飞书通知主理人（DB 状态行挂起、不碰 interrupt）→ 主理人 POST /promote/:resultId confirm → promoted（决策1：不跨 repo 打 zenithjoy 真生产）。promote_status 状态机 + 回流接口校验防重复 promote。
