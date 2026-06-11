# DoD — 同步 harness-generator 快照至 SSOT 7.5.0

**范围**: 用 scripts/sync-skills-snapshot.sh 把 harness-generator SKILL.md 从 SSOT 刷到 monorepo 快照（7.4.0 → 7.5.0）。纯快照刷新。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] generator 快照刷到 7.5.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('version: 7.5.0'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] generator 快照含 7.5.0 changelog（删自合并红线）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('禁止执行任何'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 6 个 harness skill 快照版本号同时为 SSOT 最新版（一条命令校验全部，防漏同步）
  Test: manual:node -e "const fs=require('fs');const m={'harness-evaluator':'1.15.0','harness-contract-proposer':'9.1.0','harness-contract-reviewer':'9.1.0','harness-generator':'7.5.0','harness-planner':'8.10.0','harness-report':'6.2.0'};for(const[s,v]of Object.entries(m)){const c=fs.readFileSync('packages/workflows/skills/'+s+'/SKILL.md','utf8');if(!c.includes('version: '+v)){console.error('MISMATCH '+s);process.exit(1)}}console.log('OK')"

- [x] [BEHAVIOR] generator 快照不再含可执行的 `gh pr merge "$PR...` 自合并命令（红线已落地，仅保留红线说明文字）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(c.includes('gh pr merge \"$PR')){console.error('仍含可执行自合并命令');process.exit(1)}console.log('OK')"
