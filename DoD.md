# DoD

- [x] [BEHAVIOR] 只有固定 source/tooling 的完整4e旧consumer配对在真实原生PR身份下选择legacy格式；17d或任一侧漂移继续CI-first，坏CI证据致命，环境和CLI不能自选格式。
  Test: manual:node -e "const{execFileSync:x}=require('node:child_process');x('npm',['ci','--include-workspace-root','--workspace','packages/brain','--workspace','packages/engine','--ignore-scripts','--no-audit','--no-fund'],{stdio:'inherit'});x(process.execPath,['--test','scripts/ci/__tests__/implementation-pr-baseline.test.mjs','scripts/ci/__tests__/basic-ci-admission-resolver.test.mjs'],{stdio:'inherit'});"
- [x] [BEHAVIOR] typed输出允许resolver根级诊断，仍拒绝scope内同名文件、任意额外输出及嵌套裸snapshot。
  Test: manual:node --test scripts/ci/__tests__/factory-workflow-config-source.test.mjs
- [x] [BEHAVIOR] 已发布历史readonly/legacy组合保留，未发布坏active1f拒绝；新guard/resolver完整32成员及自身collector组合可证明，逐成员篡改和混搭清空关系，新增readonly 0/1 cohort保留执行防复活。
  Test: manual:node -e "require('node:child_process').execFileSync(process.execPath,['../../node_modules/vitest/vitest.mjs','run','src/lib/__tests__/existing-ops-source-impact.test.js','src/__tests__/claude-channel-retired.guard.test.js','src/__tests__/claude-channel-retired.reader-tuples.test.js'],{cwd:'packages/brain',stdio:'inherit'});"
- [x] [BEHAVIOR] 捕获数据为完整真实Git树的固定四个普通blob增量，commit/blob摘要校验；helper仅处理数据与私有Git重建，普通Node真实消费并拒绝损坏和越界；已审collector的显式self-import由第3项验证，不执行workflow或应用。
  Test: manual:node --test scripts/ci/__tests__/fixed-local-git.test.mjs
- [x] [BEHAVIOR] 原CI91eb、Impact4e及marker0保持；六版本同步97，source-only仍禁止生产晋级。
  Test: manual:node -e "require('node:child_process').execFileSync('bash',['scripts/check-version-sync.sh'],{stdio:'inherit'});"
