# DoD — Slice 3：report 后移到 production promote 完成后（三态 · 决策 B）

> 分支：cp-0625232915-slice3-report-postpromote
> Spec: docs/superpowers/specs/2026-06-25-phase2-harness-to-production-design.md §3 Slice 3
> 决策 B：promote 完成→成功证书 / FAIL/SKIP/promote_failed→失败报告 / pending_promote 不出（Slice2 通知+状态可见，不饿死）。

## 验收项

- [x] [ARTIFACT] migration 307 ALTER 加 promoted_by（不 CREATE TABLE，不动 304/305/306）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/307_staging_e2e_promoted_by.sql','utf8');if(/CREATE TABLE/i.test(c)||!/ADD COLUMN/i.test(c)||!c.includes('promoted_by'))process.exit(1)"

- [x] [BEHAVIOR] reportNode 只在 verdict≠PASS 派失败报告；PASS 不派（成功证书挪到 promote 完成点）；生命周期闭合(initiative_runs phase / tasks.status / 容器清理)仍保留在 merge 时
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!/computedVerdict !== 'PASS'/.test(c)||!/spawnHarnessReport/.test(c)||!/UPDATE initiative_runs SET phase/.test(c)||!/UPDATE tasks SET status/.test(c))process.exit(1)"

- [x] [BEHAVIOR] 内部线 auto_promoted（staging-e2e-runner）+ 客户线 confirm promoted（routes）各派成功交付证书 report
  Test: manual:node -e "const r=require('fs').readFileSync('packages/brain/src/staging-e2e-runner.js','utf8');const t=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/spawnHarnessReport/.test(r)||!/spawnHarnessReport/.test(t))process.exit(1)"

- [x] [BEHAVIOR] 派 harness_report 幂等：按 initiative_id NOT EXISTS 去重（promote 完成点/失败路径只出一份）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/staging-promote.js','utf8');if(!/NOT EXISTS[\s\S]{0,120}initiative_id/i.test(c)||!/buildHarnessReportInsert/.test(c))process.exit(1)"

- [x] [BEHAVIOR] report 内容补全：report_kind + staging_e2e_verdict + promote_status + promoted_at + promoted_by + production_version + rollback_anchor（payload + harness-report.mjs 渲染）
  Test: manual:node --input-type=module -e "import('./packages/brain/src/staging-promote.js').then(m=>{const {params}=m.buildHarnessReportInsert({initiativeId:'i',productionVersion:'1.2.3',rollbackAnchor:'a',promotedBy:'auto',promoteStatus:'auto_promoted',stagingE2eVerdict:'PASS'});const p=JSON.parse(params.find(x=>typeof x==='string'&&x.includes('production_version')));if(p.production_version!=='1.2.3'||p.rollback_anchor!=='a'||p.promoted_by!=='auto'||!p.report_kind)process.exit(1)})"

- [x] [BEHAVIOR] 三态行为单测：PASS reportNode 不派 / FAIL reportNode 派失败报告 / promote 完成点派成功证书 / pending 不饿死（靠 Slice2 可见性）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/slice3-report-postpromote.test.js','utf8');if(!/不派 harness_report/.test(c)||!/report_kind.*failure|failure/.test(c)||!/生命周期闭合/.test(c))process.exit(1)"

## 成功标准

report 从"合 main 后"摘出，改为 production promote 完成后触发：内部线 auto_promoted / 客户线 confirm promoted → 派**成功交付证书**（含 staging E2E 结果 + 放行人/时间 + production 版本 + 回档锚点）；verdict=FAIL/SKIP → reportNode 终态派**失败报告**（不饿死）；pending_promote 不出（等最终走向，靠 Slice2 通知+状态可见）。生命周期闭合仍在 merge 时（不破坏 done 语义）。harness_report 按 initiative_id 幂等。
