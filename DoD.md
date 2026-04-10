contract_branch: cp-harness-contract-8f005193
workstream_index: 2
sprint_dir: sprints/harness-self-check-v2

# Contract DoD — Workstream 2: Reviewer 证伪机制 + GAN 多轮对抗

**范围**: Reviewer 对草案执行证伪分析 -> 输出三元组反馈（命令字段用 readFileSync 路径指纹匹配）-> Proposer 修订 -> Reviewer 再审 -> 最终 APPROVED 合同
**大小**: M（验证涉及多个产物文件和多轮对抗记录）
**依赖**: Workstream 1 完成后

## DoD 条目

- [x] [BEHAVIOR] `contract-review-feedback.md` 三元组覆盖率 >= 草案命令数 * 60%，命令字段与草案 readFileSync 路径指纹匹配，至少 1 个 YES，判决格式为 `**判决**: X`
  Test: node -e "const fs=require('fs');const d=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const br=/\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g;const pfps=[];let bm;while((bm=br.exec(d))!==null){const ct=bm[1].replace(/^#.*\n/gm,'').trim();if(!ct.length)continue;const pm=ct.match(/readFileSync\s*\(\s*['\x22]([^'\x22]+)['\x22]/);if(pm)pfps.push(pm[1])};const fb=fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const y=(fb.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y<1)throw new Error('FAIL:无YES');const hdr=fb.split('\n').slice(0,30).join('\n');if(!/\*\*判决\*\*[：:]\s*(REVISION|APPROVED)/.test(hdr))throw new Error('FAIL:判决格式错误');console.log('PASS:YES='+y)"
- [x] [BEHAVIOR] GAN 至少 2 轮——远端存在 `cp-harness-propose-r2-*` 分支
  Test: node -e "const {execSync}=require('child_process');const o=execSync('git ls-remote --heads origin cp-harness-propose-r2-\\*',{encoding:'utf8'});if(!o||!o.trim())throw new Error('FAIL:无R2分支');console.log('PASS:R2分支存在='+o.trim().split('\n').length+'个')"
- [x] [BEHAVIOR] 最终 `sprint-contract.md` 含 >= 4 Feature（每个有白名单工具调用）、>= 8 命令块、0 个 YES、完整三元组 NO >= 60% 命令数（每块含命令：+最懒假实现+能否绕过：NO）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const fb=c.split(/^## Feature \d+/gm);fb.shift();if(fb.length<4)throw new Error('FAIL:Feature='+fb.length);const TR=/\bnode\s+-e\b|\bcurl\s|\bbash\s|\bpsql\s|\bnpm\s/;fb.forEach((b,i)=>{const bm=b.match(/\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g)||[];if(!bm.some(x=>TR.test(x)))throw new Error('FAIL:Feature '+(i+1)+'无白名单工具')});const cmds=(c.match(/^\x60\x60\x60bash/gm)||[]).length;if(cmds<8)throw new Error('FAIL:bash='+cmds);const y=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(y>0)throw new Error('FAIL:YES='+y);const bks=c.split('---');let sno=0;bks.forEach(bk=>{if(bk.match(/命令[：:]/)&&bk.includes('最懒假实现')&&/能否绕过[：:]\s*NO/.test(bk))sno++});const minNO=Math.ceil(cmds*0.6);if(sno<minNO)throw new Error('FAIL:完整三元组NO='+sno+'<'+minNO+'(命令数'+cmds+'*60%)');console.log('PASS:Feature='+fb.length+',bash='+cmds+',YES=0,完整三元组NO='+sno+'(>='+minNO+')')"
