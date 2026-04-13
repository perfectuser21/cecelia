# Contract DoD — Workstream 2: 数据传递统一 + Skill 更新 + Pipeline 清理

- [ ] [BEHAVIOR] execution-callback 从 tasks.result 提取分支名，不通过 git clone/checkout 读取分支文件
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('extractBranchFromResult'))throw new Error('FAIL');if(/git\s+clone.*report_branch|git\s+checkout.*review_branch/.test(c))throw new Error('FAIL: 仍依赖git');console.log('PASS')"
- [ ] [ARTIFACT] 所有 harness skill（proposer/reviewer/generator/report）包含 curl PATCH Brain API 回写指令
  Test: node -e "const fs=require('fs');const p=require('path');const ss=['harness-contract-proposer','harness-contract-reviewer','harness-generator','harness-report'];const m=[];for(const s of ss){const sp=p.join(process.env.HOME,'.claude-account1/skills',s,'SKILL.md');if(!fs.existsSync(sp)){m.push(s+' (missing)');continue}const c=fs.readFileSync(sp,'utf8');if(!c.includes('curl')&&!c.includes('PATCH'))m.push(s)}if(m.length>0)throw new Error('FAIL: '+m.join(', '));console.log('PASS')"
- [ ] [BEHAVIOR] harness-report skill 包含 pipeline 清理步骤（worktree prune + cp-harness-* 分支 + /tmp 清理）
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-report/SKILL.md');if(!fs.existsSync(sp))throw new Error('FAIL');const c=fs.readFileSync(sp,'utf8');if(!c.includes('worktree')&&!c.includes('prune'))throw new Error('FAIL: 缺少worktree prune');if(!c.includes('cp-harness'))throw new Error('FAIL: 缺少cp-harness清理');console.log('PASS')"
- [ ] [BEHAVIOR] 清理仅匹配 cp-harness-* 模式，不误删其他 cp-* 分支
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-report/SKILL.md');if(!fs.existsSync(sp))throw new Error('FAIL');const c=fs.readFileSync(sp,'utf8');if(!c.match(/cp-harness[-*]/))throw new Error('FAIL: 无 cp-harness 模式');console.log('PASS')"
