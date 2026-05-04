# DoD — CI Gate 彻底修复

task_id: c7af8b9e-0233-4f9d-8875-9753e1478b70

## 验收条目

- [x] [ARTIFACT] `.github/workflows/ci.yml` 已修改（5 处定点改动）
  Test: manual:node -e "require('fs').accessSync('.github/workflows/ci.yml')"

- [x] [BEHAVIOR] ci-passed 的 check() 调用包含 harness-contract-lint
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!c.includes('check \"harness-contract-lint\"')) process.exit(1)"

- [x] [BEHAVIOR] changes job 输出 dod 字段（DoD 文件变更检测）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('      - id: detect'); const seg=c.slice(idx,idx+1500); if(!seg.includes('dod=')) process.exit(1)"

- [x] [BEHAVIOR] dod-behavior-dynamic 含 needs: [changes] 条件
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('dod-behavior-dynamic:'); const seg=c.slice(idx,idx+400); if(!seg.includes('needs: [changes]')) process.exit(1)"

- [x] [BEHAVIOR] harness-dod-integrity 含 needs: [changes] 条件
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('harness-dod-integrity:'); const seg=c.slice(idx,idx+400); if(!seg.includes('needs: [changes]')) process.exit(1)"
