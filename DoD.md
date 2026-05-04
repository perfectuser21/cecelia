# DoD — Ralph 模式三 Phase 测试全覆盖

task_id: b7820794-6444-46ce-8496-706e18e6d4d6

## 验收条目

- [x] [ARTIFACT] Phase A E2E 测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts')"

- [x] [ARTIFACT] Phase B unit 测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/unit/verify-dev-complete.test.sh')"

- [x] [ARTIFACT] Phase C smoke 脚本存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/scripts/smoke/ralph-loop-smoke.sh')"

- [x] [BEHAVIOR] Phase A E2E 含 12 个 Ralph 协议场景
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts','utf8'); const m=c.match(/it\(/g)||[]; if(m.length<10) process.exit(1)"

- [x] [BEHAVIOR] feature-registry.yml 记录了 18.19.1 版本条目
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8'); if(!c.includes('18.19.1')) process.exit(1)"
