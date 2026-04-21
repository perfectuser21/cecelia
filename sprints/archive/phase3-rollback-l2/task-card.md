# Task: Phase 3 — 回滚 L2 自创加固 + 补 upstream 同步

**Task ID**: 891a6164-695f-444c-8345-54310d2d8296
**Branch**: cp-0419115057-phase3-rollback-l2
**Version**: Engine 14.17.8 → 14.17.9

## DoD

### Round A: 回滚 L2 自创加固

- [x] [BEHAVIOR] implementer-prompt.md 恢复 Superpowers 原版 113 行
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md','utf8');if(c.includes('TDD Deliverables Contract'))process.exit(1)"

- [x] [BEHAVIOR] spec-reviewer-prompt.md 恢复 Superpowers 原版 61 行
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md','utf8');if(c.includes('Core Check #6'))process.exit(1)"

- [x] [BEHAVIOR] 本地 prompt sha256 与 Superpowers upstream 5.0.7 完全一致
  Test: manual:bash packages/engine/scripts/sync-from-upstream.sh

- [x] [BEHAVIOR] 02-code.md 无 record-evidence 插桩
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');if(c.includes('record-evidence'))process.exit(1)"

- [x] [BEHAVIOR] L2 evidence 脚本已删除
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/scripts/record-evidence.sh');process.exit(1)}catch{}try{fs.accessSync('packages/engine/scripts/devgate/check-pipeline-evidence.cjs');process.exit(1)}catch{}"

- [x] [BEHAVIOR] ci.yml 不再含 Pipeline Evidence Gate
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(c.includes('Pipeline Evidence Gate')||c.includes('check-pipeline-evidence'))process.exit(1)"

- [x] [BEHAVIOR] alignment.yaml 无 runtime_evidence 字段
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/contracts/superpowers-alignment.yaml','utf8');const lines=c.split('\\n').filter(l=>!l.trim().startsWith('#'));const joined=lines.join('\\n');if(/^\\s+runtime_evidence:/m.test(joined))process.exit(1)"

### Round B: 补 upstream 同步基础设施

- [x] [ARTIFACT] 3 个 upstream skill SKILL.md 本地副本
  Test: manual:node -e "['executing-plans','dispatching-parallel-agents','finishing-a-development-branch'].forEach(s=>require('fs').accessSync('packages/engine/skills/dev/prompts/'+s+'/SKILL.md'))"

- [x] [ARTIFACT] sync-from-upstream.sh 存在且可执行
  Test: manual:bash -c "test -x packages/engine/scripts/sync-from-upstream.sh"

- [x] [BEHAVIOR] sync-from-upstream 成功报告零 drift
  Test: manual:bash packages/engine/scripts/sync-from-upstream.sh

- [x] [BEHAVIOR] alignment.yaml 为 3 个 skill 补 local_prompt 条目
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/contracts/superpowers-alignment.yaml','utf8');['executing-plans','dispatching-parallel-agents','finishing-a-development-branch'].forEach(s=>{if(!c.includes('path: packages/engine/skills/dev/prompts/'+s+'/SKILL.md'))process.exit(1)})"

### 向后兼容 + 版本

- [x] [BEHAVIOR] L1 alignment gate 仍 pass
  Test: manual:node packages/engine/scripts/devgate/check-superpowers-alignment.cjs

- [x] [BEHAVIOR] L1 hygiene gate 仍 pass
  Test: manual:node packages/engine/scripts/devgate/check-engine-hygiene.cjs

- [x] [BEHAVIOR] 版本 6 处同步到 14.17.9
  Test: manual:node -e "const fs=require('fs');const v=fs.readFileSync('packages/engine/VERSION','utf8').trim();const pkg=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version;const hcv=fs.readFileSync('packages/engine/.hook-core-version','utf8').trim();const hv=fs.readFileSync('packages/engine/hooks/VERSION','utf8').trim();const skill=fs.readFileSync('packages/engine/skills/dev/SKILL.md','utf8').match(/^version:\s*(\S+)/m)[1];const reg=fs.readFileSync('packages/engine/regression-contract.yaml','utf8').match(/^version:\s*(\S+)/m)[1];if(![v,pkg,hcv,hv,skill,reg].every(x=>x==='14.17.9'))process.exit(1)"

- [x] [ARTIFACT] feature-registry 14.17.9 条目
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"14.17.9\"'))process.exit(1)"

- [x] [ARTIFACT] Learning 文件
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04191150-phase3-rollback-l2.md','utf8');if(!c.includes('## 根本原因')||!c.includes('## 下次预防'))process.exit(1)"
