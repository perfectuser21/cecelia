# DoD: T2 orchestrator 骨架（reconcile loop + 路由/门禁纯函数）

sprint_dir: docs/superpowers/specs/2026-07-04-orchestrator-skeleton-design.md

- [x] [ARTIFACT] orchestrator 模块 8 文件齐全（constants/derive/gates/counters/decision-log/heartbeat/ground-truth/loop/run）
  Test: manual:node -e "const fs=require('fs');for(const f of ['constants','derive','gates','counters','decision-log','heartbeat','ground-truth','loop','run'])if(!fs.existsSync('packages/brain/src/orchestrator/'+f+'.js'))process.exit(1)"
- [x] [BEHAVIOR] 路由/门禁是确定性纯函数：derive.js/gates.js/counters.js 源码不含 Date.now/Math.random/new Date(（DoD F2 的可测形式）
  Test: manual:node -e "const fs=require('fs');for(const f of ['derive','gates','counters']){const c=fs.readFileSync('packages/brain/src/orchestrator/'+f+'.js','utf8');if(/Date\.now\(|Math\.random\(|new Date\(/.test(c))process.exit(1)}"
- [x] [BEHAVIOR] merge 硬门禁存在且 SHA 锚定：gates.js 含 mergeGate 且拒绝 stale verdict（evaluate/judge 双 PASS + sha 匹配才放行）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/gates.js','utf8');if(!/mergeGate/.test(c)||!/pr_head_sha/.test(c))process.exit(1)"
- [x] [BEHAVIOR] selfcheck EXPECTED_SCHEMA_VERSION 已 bump 312（T1 承诺兑现：首个依赖 312 列的代码）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!/EXPECTED_SCHEMA_VERSION = '312'/.test(c))process.exit(1)"
- [x] [BEHAVIOR] T3 写入契约集中声明：constants.js 含 LOG_ACTION（verdict:*）与 ACTION 枚举
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/constants.js','utf8');if(!/LOG_ACTION/.test(c)||!/verdict:evaluate/.test(c)||!/persist_contract_approval/.test(c))process.exit(1)"
- [x] [ARTIFACT] 全分支单测在 repo（derive/gates/counters/decision-log/loop/ground-truth/determinism 7 个测试文件）
  Test: manual:node -e "const fs=require('fs');for(const f of ['derive','gates','counters','decision-log','loop','ground-truth','determinism'])if(!fs.existsSync('packages/brain/src/orchestrator/__tests__/'+f+'.test.js'))process.exit(1)"
