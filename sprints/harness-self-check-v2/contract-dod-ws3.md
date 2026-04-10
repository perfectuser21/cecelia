# Contract DoD — Workstream 3: GAN 多轮演化与最终产物完整性

- [ ] [BEHAVIOR] GAN 至少经历 2 个完整轮次（git log 中至少 2 次 contract draft commit）
  Test: bash -c "COUNT=$(git log --all --oneline --grep='round-' -- sprints/harness-self-check-v2/contract-draft.md 2>/dev/null | wc -l | tr -d ' ');if [ \"$COUNT\" -lt 2 ];then echo \"FAIL: 轮次不足，实际=$COUNT\";exit 1;fi;echo \"PASS: $COUNT 轮 contract draft\""
- [ ] [ARTIFACT] sprint_dir 下 4 个核心产物文件全部存在且非空（sprint-prd.md / contract-draft.md / contract-review-feedback.md / sprint-contract.md）
  Test: node -e "const fs=require('fs');const dir='sprints/harness-self-check-v2';['sprint-prd.md','contract-draft.md','contract-review-feedback.md','sprint-contract.md'].forEach(f=>{const s=fs.statSync(dir+'/'+f);if(s.size<100)throw new Error('FAIL: '+f+' 太小 '+s.size+'B')});console.log('PASS: 4 个核心产物全部存在且非空')"
- [ ] [BEHAVIOR] 最终合同 sprint-contract.md 包含验证命令和 Workstreams 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');if(!c.includes('**验证命令**'))throw new Error('FAIL: 缺少验证命令');if(!c.includes('## Workstreams'))throw new Error('FAIL: 缺少 Workstreams');console.log('PASS: 最终合同结构完整')"
