# DoD: H7 entrypoint.sh tee stdout 到 STDOUT_FILE

## 验收清单

- [x] [BEHAVIOR] entrypoint.sh harness 路径下 claude stdout 写入 STDOUT_FILE，可 tail 读
  Test: tests/docker/entrypoint-stdout-tee.test.js

- [x] [BEHAVIOR] run_claude 退出码 = claude 真实退出码（不被 tee 吃掉）
  Test: tests/docker/entrypoint-stdout-tee.test.js

- [x] [ARTIFACT] entrypoint.sh run_claude 函数含 tee STDOUT_FILE 和 PIPESTATUS[0]
  Test: manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8');if(!/tee \"\\$STDOUT_FILE\"/.test(c))process.exit(1);if(!c.includes('PIPESTATUS[0]'))process.exit(1)"

- [x] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/docker/entrypoint-stdout-tee.test.js')"

## Learning

文件: docs/learnings/cp-0509133354-h7-entrypoint-stdout-tee.md

## 测试命令

```bash
npx vitest run tests/docker/entrypoint-stdout-tee.test.js
```
