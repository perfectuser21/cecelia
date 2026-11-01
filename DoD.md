# DoD

- [x] [BEHAVIOR] 只有固定 source/tooling 的完整4e旧consumer配对在真实原生PR身份下选择legacy格式；17d或任一侧漂移继续CI-first，坏CI证据致命，环境和CLI不能自选格式。
  Test: manual:node --test scripts/ci/__tests__/implementation-pr-baseline.test.mjs scripts/ci/__tests__/basic-ci-admission-resolver.test.mjs
- [x] [BEHAVIOR] typed输出允许resolver根级诊断，仍拒绝scope内同名文件、任意额外输出及嵌套裸snapshot。
  Test: manual:node --test scripts/ci/__tests__/factory-workflow-config-source.test.mjs
- [x] [BEHAVIOR] 原完整future来源与新guard/resolver完整32成员组合均可证明；逐成员篡改和混搭清空关系，新增readonly 0/1 cohort保留旧全部组合与执行防复活。
  Test: manual:node -e "require('node:child_process').execFileSync(process.execPath,['../../node_modules/vitest/vitest.mjs','run','src/lib/__tests__/existing-ops-source-impact.test.js','src/__tests__/claude-channel-retired.guard.test.js','src/__tests__/claude-channel-retired.reader-tuples.test.js'],{cwd:'packages/brain',stdio:'inherit'});"
- [x] [BEHAVIOR] 捕获数据为完整真实Git树的固定两blob增量，commit/blob摘要校验；普通Node真实消费资产，损坏和越界拒绝，不执行捕获源码。
  Test: manual:node --test scripts/ci/__tests__/fixed-local-git.test.mjs
- [x] [BEHAVIOR] 原CI91eb、Impact4e及marker0保持；六版本同步97，source-only仍禁止生产晋级。
  Test: manual:bash scripts/check-version-sync.sh
