# Contract DoD — One Session 编排门循环与 CI 合同闸 hotfix

- [x] [BEHAVIOR] Test Contract 覆盖检查按表头识别列，不再写死列序
  Test: manual:bash -c 'TMP=/tmp/check-test-coverage-hotfix-$$; mkdir -p "$TMP/sprints/s1/tests"; cat > "$TMP/sprints/s1/tests/Foo.test.ts" <<'"'"'EOF'"'"'\nimport { describe, it, expect } from '\''vitest'\'';\ndescribe('\''x'\'', () => { it('\''渲染 PrepPRD 全文'\'', () => { expect(1).toBe(1); }); });\nEOF\ncat > "$TMP/sprints/s1/contract-draft.md" <<'"'"'EOF'"'"'\n# Contract\n\n## Test Contract\n\n| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |\n|---|---|---|---|\n| Kernel durable resume | 渲染 | `tests/Foo.test.ts` | 当前实现缺失 |\nEOF\nnode packages/engine/scripts/devgate/check-test-coverage.cjs "$TMP/sprints/s1/contract-draft.md"'

- [x] [BEHAVIOR] test-pyramid-guard 在 PR 场景忽略当前 diff 命中的 sprint 目录
  Test: manual:bash scripts/__tests__/test-pyramid-guard.test.sh

- [x] [BEHAVIOR] Harness v5 Sprint Tests 实跑完整透传 DB/PG 环境并使用 `cecelia_test`
  Test: manual:bash -c 'node - <<'"'"'EOF'"'"'\nconst fs=require('\''fs'\'');\nconst y=fs.readFileSync('\''.github/workflows/harness-v5-checks.yml'\'','\''utf8'\'');\nconst checks=[\n  /POSTGRES_PASSWORD:\\s*\\$\\{\\{ secrets\\.CI_DB_PASSWORD \\}\\}/,\n  /POSTGRES_DB:\\s*cecelia_test/,\n  /Run sprint tests[\\s\\S]*DB_PASSWORD:\\s*\\$\\{\\{ secrets\\.CI_DB_PASSWORD \\}\\}/,\n  /Run sprint tests[\\s\\S]*PGPASSWORD:\\s*\\$\\{\\{ secrets\\.CI_DB_PASSWORD \\}\\}/,\n  /Run sprint tests[\\s\\S]*NODE_ENV:\\s*test/\n];\nprocess.exit(checks.every((re)=>re.test(y)) ? 0 : 1);\nEOF'

- [x] [BEHAVIOR] DoD 动态命令链完整透传 PG 环境
  Test: manual:bash -c 'node - <<'"'"'EOF'"'"'\nconst fs=require('\''fs'\'');\nconst y=fs.readFileSync('\''.github/workflows/ci.yml'\'','\''utf8'\'');\nconst checks=[\n  /执行 DoD BEHAVIOR 动态命令[\\s\\S]*PGHOST:\\s*localhost/,\n  /执行 DoD BEHAVIOR 动态命令[\\s\\S]*PGUSER:\\s*cecelia/,\n  /执行 DoD BEHAVIOR 动态命令[\\s\\S]*PGPASSWORD:\\s*\\$\\{\\{ secrets\\.CI_DB_PASSWORD \\}\\}/\n];\nprocess.exit(checks.every((re)=>re.test(y)) ? 0 : 1);\nEOF'
