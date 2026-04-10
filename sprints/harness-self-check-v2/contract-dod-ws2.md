# Contract DoD — Workstream 2: Reviewer 对抗证伪机制验证

- [ ] [BEHAVIOR] Reviewer 输出的 feedback 包含完整证伪分析区块，每条命令有 `命令：/最懒假实现：/能否绕过：/理由：` 四元组
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const cmds=(c.match(/命令：/g)||[]).length;const fakes=(c.match(/最懒假实现：/g)||[]).length;const bypasses=(c.match(/能否绕过：/g)||[]).length;const reasons=(c.match(/理由：/g)||[]).length;if(cmds<2||cmds!==fakes||cmds!==bypasses||cmds!==reasons)throw new Error('FAIL: 四元组不完整 cmd='+cmds+' fake='+fakes+' bypass='+bypasses+' reason='+reasons);console.log('PASS: '+cmds+' 组完整四元组')"
- [ ] [BEHAVIOR] 第 1 轮 Reviewer 至少发现 1 条 `能否绕过：YES` 并整体判定 REVISION
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md','utf8');const yes=(c.match(/能否绕过：\s*YES/gi)||[]).length;if(yes<1)throw new Error('FAIL: 无 YES 判定');if(!c.includes('REVISION'))throw new Error('FAIL: 缺少 REVISION 判定');console.log('PASS: '+yes+' 条 YES + REVISION')"
