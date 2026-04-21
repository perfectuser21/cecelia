# DoD — Harness v5 Sprint C: CI 硬校验上线（软门禁观察期）

## ARTIFACT 条目

- [x] [ARTIFACT] `.github/workflows/harness-v5-checks.yml` 存在且含 4 个 job
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/harness-v5-checks.yml','utf8');['dod-structure-purity','test-coverage-for-behavior','tdd-commit-order','tests-actually-pass'].forEach(j=>{if(!c.includes(j+':'))process.exit(1)})"

- [x] [ARTIFACT] workflow 4 个 job 都 continue-on-error: true（软门禁观察期）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/harness-v5-checks.yml','utf8');const cnt=(c.match(/continue-on-error:\s*true/g)||[]).length;if(cnt<4)process.exit(1)"

- [x] [ARTIFACT] workflow 含 paths 过滤（只 harness 改动触发）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/harness-v5-checks.yml','utf8');if(!/paths:/.test(c))process.exit(1);if(!/sprints/.test(c))process.exit(2);if(!/harness-contract|harness-generator/.test(c))process.exit(3)"

- [x] [ARTIFACT] check-dod-purity.cjs 存在并检测 [BEHAVIOR]
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/devgate/check-dod-purity.cjs','utf8');if(!c.includes('[BEHAVIOR]'))process.exit(1);if(!c.includes('contract-dod-ws'))process.exit(2);if(!/process\.exit\(1\)/.test(c))process.exit(3)"

- [x] [ARTIFACT] check-test-coverage.cjs 存在并解析 Test Contract 表
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/devgate/check-test-coverage.cjs','utf8');if(!c.includes('Test Contract'))process.exit(1);if(!c.includes('.test.ts'))process.exit(2)"

- [x] [ARTIFACT] check-tdd-commit-order.sh 存在并验证 commit 顺序
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/devgate/check-tdd-commit-order.sh','utf8');if(!/git\s+(log|show)/.test(c))process.exit(1);if(!/\(Red\)/.test(c))process.exit(2);if(!/\(Green\)/.test(c))process.exit(3);if(!/tests.*\.test\.ts|\.test\.ts.*tests/.test(c))process.exit(4)"

- [x] [ARTIFACT] 结构测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/skills/harness-v5-ci-checks.test.ts')"

- [x] [ARTIFACT] Learning 文件含根本原因 + 下次预防
  Test: manual:node -e "const fs=require('fs');const files=fs.readdirSync('docs/learnings').filter(f=>f.includes('harness-v5-sprint-c'));if(files.length===0)process.exit(1);const c=fs.readFileSync('docs/learnings/'+files[0],'utf8');if(!c.includes('### 根本原因'))process.exit(2);if(!c.includes('### 下次预防'))process.exit(3)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] 3 个 check 脚本干跑（无参数）应正常退出 0（跳过模式）
  Test: manual:bash -c "node packages/engine/scripts/devgate/check-dod-purity.cjs && node packages/engine/scripts/devgate/check-test-coverage.cjs && bash packages/engine/scripts/devgate/check-tdd-commit-order.sh"

## 结构测试（vitest 验证 workflow + 脚本）

见 `packages/engine/tests/skills/harness-v5-ci-checks.test.ts`（10 个 it 断言）。

运行：

```bash
cd packages/engine && npx vitest run tests/skills/harness-v5-ci-checks.test.ts --no-coverage
```

预期：`Tests  10 passed (10)`
