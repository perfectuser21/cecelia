# Task: Phase 1 模式统一 Round 1 — Orphan PR Worker + Standard 弃用通告

**Task ID**: 3611ea6e-87bd-43df-9df6-9d0ce16e46b6
**Branch**: cp-0418205229-phase1-unification
**Version**: Engine 14.17.6 → 14.17.7
**Mode**: harness_mode=false (manual /dev, not Brain harness pipeline)
**Depends on**: PR #2406 (L1), #2408 (L2)

## DoD

### Brain Orphan PR Worker

- [x] [ARTIFACT] orphan-pr-worker.js 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/orphan-pr-worker.js')"

- [x] [ARTIFACT] 单元测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/orphan-pr-worker.test.js')"

- [x] [BEHAVIOR] orphan-pr-worker 13 test cases 全绿
  Test: manual:npx vitest run packages/brain/src/__tests__/orphan-pr-worker.test.js

- [x] [BEHAVIOR] tick.js 集成 orphan-pr-worker (非阻塞 Promise)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes('orphan-pr-worker.js')||!c.includes('_lastOrphanPrWorkerTime')||!c.includes('ORPHAN_PR_WORKER_INTERVAL_MS'))process.exit(1)"

- [x] [BEHAVIOR] ORPHAN_PR_WORKER_INTERVAL_MS 默认 30 分钟
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes('30 * 60 * 1000'))process.exit(1)"

- [x] [BEHAVIOR] 遵守 MINIMAL_MODE (默认 minimal 不跑)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const idx=c.indexOf('orphan-pr-worker');const block=c.substring(idx-200,idx+200);if(!block.includes('!MINIMAL_MODE'))process.exit(1)"

### SKILL.md Standard 弃用通告

- [x] [BEHAVIOR] SKILL.md 含 Standard 弃用警示
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(!c.includes('Standard 模式不再推荐')&&!c.includes('已弃用'))process.exit(1)"

- [x] [BEHAVIOR] SKILL.md frontmatter 明确 autonomous 为唯一推荐默认
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(!c.includes('autonomous')||!c.includes('唯一推荐默认'))process.exit(1)"

### 版本 + 向后兼容

- [x] [BEHAVIOR] 版本 6 处同步到 14.17.7
  Test: manual:node -e "const fs=require('fs');const v=fs.readFileSync('packages/engine/VERSION','utf8').trim();const pkg=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version;const hcv=fs.readFileSync('packages/engine/.hook-core-version','utf8').trim();const hv=fs.readFileSync('packages/engine/hooks/VERSION','utf8').trim();const skill=fs.readFileSync('packages/engine/skills/dev/SKILL.md','utf8').match(/^version:\s*(\S+)/m)[1];const reg=fs.readFileSync('packages/engine/regression-contract.yaml','utf8').match(/^version:\s*(\S+)/m)[1];if(![v,pkg,hcv,hv,skill,reg].every(x=>x==='14.17.7'))process.exit(1)"

- [x] [ARTIFACT] feature-registry 14.17.7 条目
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"14.17.7\"'))process.exit(1)"

- [x] [BEHAVIOR] L1 alignment gate 仍 pass
  Test: manual:node packages/engine/scripts/devgate/check-superpowers-alignment.cjs

- [x] [BEHAVIOR] L1 hygiene gate 仍 pass
  Test: manual:node packages/engine/scripts/devgate/check-engine-hygiene.cjs

- [x] [BEHAVIOR] L2 evidence gate 仍 pass (no file → skip)
  Test: manual:node packages/engine/scripts/devgate/check-pipeline-evidence.cjs

### Learning

- [x] [ARTIFACT] Learning 文件存在且格式合规
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04182052-phase1-unification.md','utf8');if(!c.includes('## 根本原因')||!c.includes('## 下次预防'))process.exit(1)"
