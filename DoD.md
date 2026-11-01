# DoD：CI verification context 可信性能修复

以下为本地可执行合同；正式远端门禁与 main 基线读回以对应实际 SHA 的独立证据为准。

- [x] [BEHAVIOR] 同一次 context 构建中的普通输入与退休证明共享 report 摘要，输出及摘要逐字等价；新调用重新计算，不复用过期结果，不改变预算。
  Test: manual:node --test scripts/ci/__tests__/implementation-verification-context-digest.test.mjs
- [x] [BEHAVIOR] 当前 active 只认完整新32成员；未发布且超时的4ba在当前工具拒绝，固定D旧collector历史回放仍成功，1f的BC历史回放与已发布legacy资格保留。
  Test: manual:node -e "require('node:child_process').execFileSync(process.execPath,['../../node_modules/vitest/vitest.mjs','run','src/lib/__tests__/existing-ops-source-impact.test.js'],{cwd:'packages/brain',stdio:'inherit'});"
- [x] [BEHAVIOR] 五个普通blob的固定commit/tree/字节摘要可核，helper只处理数据与私有Git，显式已审collector self-import绑定自身16runtime；不执行workflow或应用。
  Test: manual:node --test scripts/ci/__tests__/fixed-local-git.test.mjs
- [x] [BEHAVIOR] 新readonly 0/1完整cohort实际扫树，已发布ABC/D全部组合逐字保留，缺项、篡改、混搭和未知消费仍拒绝。
  Test: manual:node -e "require('node:child_process').execFileSync(process.execPath,['../../node_modules/vitest/vitest.mjs','run','src/__tests__/claude-channel-retired.guard.test.js','src/__tests__/claude-channel-retired.reader-tuples.test.js'],{cwd:'packages/brain',stdio:'inherit'});"
- [x] [BEHAVIOR] 六版本同步98，source-only保留；旧CI91eb、Impact4e、marker0与16运行文件清单保持，生产晋级仍禁止。
  Test: manual:node -e "require('node:child_process').execFileSync('bash',['scripts/check-version-sync.sh'],{stdio:'inherit'});"
