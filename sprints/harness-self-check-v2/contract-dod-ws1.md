# Contract DoD — Workstream 1: Proposer 合同草案生成行为

## Workstream 信息

- **ID**: WS1
- **范围**: Proposer 读取 PRD → 输出 contract-draft.md（含 Feature 结构 + 实质验证命令 + Workstreams 区块）+ contract-dod-ws{N}.md 文件
- **大小**: S
- **依赖**: 无

---

## DoD 条目

- [x] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在且含 >= 4 个 Feature 标题，每个 Feature 块有实质 bash 命令（>= 2 行代码）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const fb=c.split(/(?=^## Feature \d+)/m).filter(b=>b.startsWith('## Feature'));if(fb.length<4)throw new Error('FAIL:Feature数='+fb.length);fb.forEach((b,i)=>{const bm=b.match(/\`\`\`bash\n([\s\S]*?)\`\`\`/g)||[];if(!bm.length)throw new Error('FAIL:Feature'+(i+1)+'无bash块');const ok=bm.some(m=>m.split('\n').filter(l=>l.trim()&&!l.includes('\`\`\`')).length>=2);if(!ok)throw new Error('FAIL:Feature'+(i+1)+'bash块空壳');});console.log('PASS:'+fb.length+'个Feature，每个含实质bash命令')"

- [x] [BEHAVIOR] 每个 contract-dod-ws 文件的 [BEHAVIOR] 条目在后 5 行内有非空 Test: 字段（不接受裸 [BEHAVIOR] 标签）
  Test: node -e "const fs=require('fs');const dir='sprints/harness-self-check-v2';const files=fs.readdirSync(dir).filter(f=>f.startsWith('contract-dod-ws')&&f.endsWith('.md'));if(!files.length)throw new Error('FAIL:无DoD文件');let allOk=true;files.forEach(f=>{const lines=fs.readFileSync(dir+'/'+f,'utf8').split('\n');for(let i=0;i<lines.length;i++){if(lines[i].includes('[BEHAVIOR]')){let found=false;for(let j=i+1;j<Math.min(i+6,lines.length);j++){if(/^\s*Test:\s*\S/.test(lines[j])){found=true;break;}}if(!found)throw new Error('FAIL:'+f+'第'+(i+1)+'行[BEHAVIOR]后无非空Test字段');}}});console.log('PASS:'+files.length+'个DoD文件，每个[BEHAVIOR]均有非空Test字段')"

- [x] [ARTIFACT] `contract-draft.md` 包含 `## Workstreams` 区块，workstream_count >= 2
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');if(!c.includes('## Workstreams'))throw new Error('FAIL:无Workstreams区块');const wc=(c.match(/### Workstream \d+/g)||[]).length;if(wc<2)throw new Error('FAIL:Workstream数='+wc+'，期望>=2');console.log('PASS:Workstreams区块存在，workstream数='+wc)"
