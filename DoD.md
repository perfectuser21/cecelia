contract_branch: cp-harness-contract-5c877fc3
workstream_index: 1
sprint_dir: sprints/harness-self-optimize-v1

- [x] [ARTIFACT] `scripts/harness-contract-lint.mjs` 存在且可执行
  Test: node -e "require('fs').accessSync('scripts/harness-contract-lint.mjs'); console.log('PASS')"
- [x] [BEHAVIOR] lint 脚本对白名单违规工具（grep/ls/cat/sed/echo）返回非零退出码
  Test: node -e "const fs=require('fs');const tmp='/tmp/test-lint-wl.md';fs.writeFileSync(tmp,'- [x] [BEHAVIOR] x\n  Test: grep -c foo bar');const{execSync}=require('child_process');try{execSync('node scripts/harness-contract-lint.mjs '+tmp,{stdio:'pipe'});console.log('FAIL');process.exit(1)}catch(e){console.log('PASS')}"
- [x] [BEHAVIOR] lint 脚本对空 Test 字段返回非零退出码
  Test: node -e "const fs=require('fs');const tmp='/tmp/test-lint-empty.md';fs.writeFileSync(tmp,'- [x] [BEHAVIOR] x\n  Test:');const{execSync}=require('child_process');try{execSync('node scripts/harness-contract-lint.mjs '+tmp,{stdio:'pipe'});console.log('FAIL');process.exit(1)}catch(e){console.log('PASS')}"
- [x] [BEHAVIOR] lint 脚本对未勾选条目返回非零退出码
  Test: node -e "const fs=require('fs');const tmp='/tmp/test-lint-uc.md';fs.writeFileSync(tmp,'- [ ] [BEHAVIOR] x\n  Test: curl -sf localhost:5221');const{execSync}=require('child_process');try{execSync('node scripts/harness-contract-lint.mjs '+tmp,{stdio:'pipe'});console.log('FAIL');process.exit(1)}catch(e){console.log('PASS')}"
- [x] [ARTIFACT] `.github/workflows/ci.yml` 包含 `harness-contract-lint` job，条件触发于 DoD/contract 文件变更
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('harness-contract-lint'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] Reviewer SKILL.md 覆盖率阈值 >= 80%，含 proof-of-falsification 格式要求
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!(c.includes('0.8')||c.includes('80%')))process.exit(1);if(!c.includes('proof-of-falsification'))process.exit(1);console.log('PASS')"
