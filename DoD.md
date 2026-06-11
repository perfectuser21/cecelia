# DoD — 同步 harness skill 快照至 SSOT 最新版

**范围**: 用 scripts/sync-skills-snapshot.sh 把 6 个 harness skill SKILL.md 从 SSOT(cc8e65f) 刷到 monorepo 快照。纯快照刷新。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] evaluator 快照刷到 1.15.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('version: 1.15.0'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] contract-proposer 快照刷到 9.1.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('version: 9.1.0'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] contract-reviewer 快照刷到 9.1.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('version: 9.1.0'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] generator 快照刷到 7.4.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('version: 7.4.0'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] planner 快照刷到 8.10.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('version: 8.10.0'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] report 快照刷到 6.2.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-report/SKILL.md','utf8');if(!c.includes('version: 6.2.0'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 6 个 harness skill 快照版本号同时为 SSOT 最新版（一条命令校验全部，防漏同步）
  Test: manual:node -e "const fs=require('fs');const m={'harness-evaluator':'1.15.0','harness-contract-proposer':'9.1.0','harness-contract-reviewer':'9.1.0','harness-generator':'7.4.0','harness-planner':'8.10.0','harness-report':'6.2.0'};for(const[s,v]of Object.entries(m)){const c=fs.readFileSync('packages/workflows/skills/'+s+'/SKILL.md','utf8');if(!c.includes('version: '+v)){console.error('MISMATCH '+s);process.exit(1)}}console.log('OK')"
