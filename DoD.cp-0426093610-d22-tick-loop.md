# DoD: cp-0426093610-d22-tick-loop

- [x] [BEHAVIOR] tick-loop.js 含 runTickSafe / startTickLoop / stopTickLoop 三函数；Test: manual:node -e "const m=require('./packages/brain/src/tick-loop.js');const fs=['runTickSafe','startTickLoop','stopTickLoop'];for(const f of fs){if(typeof m[f]!=='function')process.exit(1)}"
- [x] [BEHAVIOR] tick.js 仍能 import 这 3 函数（backwards-compat re-export）；Test: manual:node -e "const m=require('./packages/brain/src/tick.js');const fs=['runTickSafe','startTickLoop','stopTickLoop'];for(const f of fs){if(typeof m[f]!=='function')process.exit(1)}"
- [x] [BEHAVIOR] tick.js 行数 < 600；Test: manual:bash -c "[ \$(wc -l < packages/brain/src/tick.js) -lt 600 ]"
- [x] [BEHAVIOR] tick.js 不再含 runTickSafe / startTickLoop / stopTickLoop 函数定义（仅 import + 中央 export）；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(/^(async\s+)?function\s+(runTickSafe|startTickLoop|stopTickLoop)/m.test(c))process.exit(1)"
- [x] [ARTIFACT] tick-loop.js 文件存在；Test: manual:node -e "require('fs').accessSync('packages/brain/src/tick-loop.js')"
