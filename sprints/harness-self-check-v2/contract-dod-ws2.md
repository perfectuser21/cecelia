# Contract DoD — Workstream 2: Reviewer 证伪机制 + GAN 多轮对抗

## Workstream 信息

- **ID**: WS2
- **范围**: Reviewer 对草案执行证伪分析（三元组全覆盖）→ 标准格式判决 → Proposer 修订 → Reviewer 再审 → 最终 APPROVED 合同
- **大小**: M
- **依赖**: WS1 完成后

---

## DoD 条目

- [x] [BEHAVIOR] `contract-review-feedback.md` 三元组数量 >= contract-draft.md bash 命令数，且 R1 至少 1 个 YES（证伪机制触发）
  Test: node -e "const fs=require('fs');const d=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const dc=(d.match(/\`\`\`bash/g)||[]).length;const fb=fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const blocks=fb.split('---');let t=0;blocks.forEach(b=>{if(b.includes('命令：')&&b.includes('最懒假实现：')&&/能否绕过[：:]\s*(YES|NO)/.test(b))t++;});if(t<dc)throw new Error('FAIL:三元组='+t+'<草案命令='+dc);const y=(fb.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y<1)throw new Error('FAIL:无YES，证伪机制未触发');console.log('PASS:三元组='+t+'>=草案命令='+dc+'，YES='+y)"

- [x] [BEHAVIOR] 反馈文件判决以 `**判决**: REVISION/APPROVED` 标准格式声明（R1 为 REVISION，最终轮为 APPROVED）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const h=c.split('\n').slice(0,30).join('\n');const m=h.match(/\*\*判决\*\*\s*[:：]\s*(REVISION|APPROVED)/);if(!m)throw new Error('FAIL:前30行无**判决**: REVISION/APPROVED标准格式');console.log('PASS:判决格式=**判决**: '+m[1])"

- [x] [BEHAVIOR] GAN 至少 2 轮——远端存在 `cp-harness-propose-r2-*` 分支（Proposer 实际执行了第 2 轮）
  Test: node -e "const {execSync}=require('child_process');const o=execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*',{encoding:'utf8'});if(!o||!o.trim())throw new Error('FAIL:远端无cp-harness-propose-r2-*分支，R2未执行');const cnt=o.trim().split('\n').length;console.log('PASS:远端存在'+cnt+'个R2分支，GAN多轮已确认')"

- [x] [BEHAVIOR] 最终 sprint-contract.md 含 >= 4 个实质 Feature（每个有 bash 块）、无 YES 残留；反馈最终轮 YES=0
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const fb=c.split(/(?=^## Feature \d+)/m).filter(b=>b.startsWith('## Feature'));if(fb.length<4)throw new Error('FAIL:Feature数='+fb.length);fb.forEach((b,i)=>{const bm=b.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g)||[];if(!bm.length)throw new Error('FAIL:Feature'+(i+1)+'无bash块');});const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y>0)throw new Error('FAIL:最终合同YES='+y);const fbc=fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const rb=fbc.split(/(?=^# Contract Review Feedback \(Round \d+\))/m).filter(b=>b.trim());const lr=rb[rb.length-1];const ly=(lr.match(/能否绕过[：:]\s*YES/g)||[]).length;if(ly>0)throw new Error('FAIL:最终轮YES='+ly);console.log('PASS:Feature='+fb.length+'，合同YES='+y+'，最终轮YES='+ly)"
