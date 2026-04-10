# Contract DoD — Workstream 1: CI 白名单 — playwright 加入

- [ ] [ARTIFACT] `scripts/devgate/check-manual-cmd-whitelist.cjs` 中 ALLOWED_COMMANDS 包含 `'playwright'`
  Test: node -e "const c=require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs','utf8');if(!c.includes(\"'playwright'\")&&!c.includes('\"playwright\"')){console.log('FAIL: ALLOWED_COMMANDS 中未找到 playwright');process.exit(1)}console.log('PASS: ALLOWED_COMMANDS 包含 playwright')"
- [ ] [BEHAVIOR] 白名单脚本语法正确可解析
  Test: node -e "try{const c=require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs','utf8');new Function(c);console.log('PASS: 语法正确')}catch(e){console.log('FAIL: '+e.message);process.exit(1)}"
