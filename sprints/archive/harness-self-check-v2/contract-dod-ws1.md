# Contract DoD — Workstream 1: Proposer 合同草案生成行为

**范围**: Proposer 读取 PRD -> 输出 contract-draft.md（含 Feature 结构 + CI白名单验证命令 + Workstreams 区块）+ contract-dod-ws{N}.md 文件
**大小**: S（改动 <100 行，纯产出物验证）
**依赖**: 无

## DoD 条目

- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在且含 >= 4 个 Feature 标题，每个 Feature 的 bash 块含 CI 白名单工具调用
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const fb=c.split(/^## Feature \d+/gm);fb.shift();if(fb.length<4)throw new Error('FAIL:Feature='+fb.length);const TR=/\bnode\s+-e\b|\bcurl\s|\bbash\s|\bpsql\s|\bnpm\s/;fb.forEach((b,i)=>{const bm=b.match(/\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g)||[];if(!bm.some(x=>TR.test(x)))throw new Error('FAIL:Feature '+(i+1)+'无CI白名单工具调用')});console.log('PASS:'+fb.length+'个Feature均含CI白名单工具调用')"
- [ ] [BEHAVIOR] Proposer 输出的草案包含 >= 8 个 bash 命令块，且 contract-dod-ws 文件存在
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const b=(c.match(/^\x60\x60\x60bash/gm)||[]).length;if(b<8)throw new Error('FAIL:bash='+b);const dods=fs.readdirSync('sprints/harness-self-check-v2').filter(f=>f.startsWith('contract-dod-ws')&&f.endsWith('.md'));if(dods.length<2)throw new Error('FAIL:dod文件数='+dods.length);console.log('PASS:bash='+b+',dod文件='+dods.length)"
