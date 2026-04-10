# Contract DoD — Workstream 2: Reviewer 对抗轮次执行 + 最终产物验证

- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-review-feedback.md` 存在，包含三元组（命令/最懒假实现/能否绕过）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');if(!c.includes('最懒假实现')||!c.includes('能否绕过'))throw new Error('FAIL: 三元组格式不完整');console.log('PASS')"
- [ ] [BEHAVIOR] Round 1 反馈中包含至少 1 个"能否绕过: YES"，证明证伪机制有效触发
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const n=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(n<1)throw new Error('FAIL: 无YES记录，证伪机制未触发');console.log('PASS: '+n+'个YES')"
- [ ] [ARTIFACT] `sprints/harness-self-check-v2/sprint-contract.md` 存在，内容 > 200 字节，包含 Workstreams 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');if(c.length<200||!c.includes('## Workstreams'))throw new Error('FAIL');console.log('PASS: 最终合同完整（'+c.length+'字节）')"
- [ ] [BEHAVIOR] 最终合同中所有命令均通过"能否绕过: NO"验证（有明确记录）
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md','utf8');const yes=(c.match(/能否绕过[：:]\s*YES/g)||[]).length;if(yes>0)throw new Error('FAIL: 最终合同仍含'+yes+'个YES，GAN未完成');console.log('PASS: 无YES记录，所有命令已通过证伪')"
