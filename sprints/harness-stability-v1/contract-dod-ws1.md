# Contract DoD — Workstream 1: CI 白名单 — playwright 加入

- [ ] [ARTIFACT] `scripts/devgate/check-manual-cmd-whitelist.cjs` 中 ALLOWED_COMMANDS 非注释代码包含 `'playwright'`
  Test: node -e "const c=require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(!code.includes(\"'playwright'\")&&!code.includes('\"playwright\"')){console.log('FAIL');process.exit(1)}console.log('PASS: ALLOWED_COMMANDS 包含 playwright')"
- [ ] [BEHAVIOR] 白名单脚本语法正确可解析
  Test: node -e "try{const c=require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs','utf8');new Function(c);console.log('PASS')}catch(e){console.log('FAIL: '+e.message);process.exit(1)}"
