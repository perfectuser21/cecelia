# Contract DoD — Workstream 2: Reviewer 证伪机制 + GAN 多轮对抗

- [x] [BEHAVIOR] `contract-review-feedback.md` 包含 >= 3 个完整三元组块，且至少 1 个 YES（R1 证伪触发）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const blocks=c.split('---');let t=0;blocks.forEach(b=>{if(b.includes('命令：')&&b.includes('最懒假实现：')&&/能否绕过[：:]\s*(YES|NO)/.test(b))t++;});if(t<3)throw new Error('FAIL:三元组='+t);const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y<1)throw new Error('FAIL:无YES');console.log('PASS:三元组='+t+'，YES='+y)"
- [x] [BEHAVIOR] GAN 至少 2 轮——远端存在 `cp-harness-propose-r2-*` 分支
  Test: node -e "const {execSync}=require('child_process');const o=execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*',{encoding:'utf8'});if(!o||!o.trim())throw new Error('FAIL:无R2分支');console.log('PASS:R2分支存在='+o.trim().split('\n').length+'个')"
- [x] [BEHAVIOR] 最终 `sprint-contract.md` 含 >= 4 个 Feature、>= 8 命令块、0 个 YES、>= 1 个 NO
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const f=(c.match(/^## Feature \d+/gm)||[]).length;const b=(c.match(/^\`\`\`bash/gm)||[]).length;const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;const n=(c.match(/能否绕过[：:]\s*NO/g)||[]).length;if(f<4)throw new Error('FAIL:Feature='+f);if(b<8)throw new Error('FAIL:bash='+b);if(y>0)throw new Error('FAIL:仍有'+y+'个YES');if(n<1)throw new Error('FAIL:无NO记录');console.log('PASS:Feature='+f+'，bash='+b+'，YES='+y+'，NO='+n)"
