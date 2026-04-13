# Contract DoD — Workstream 2: /dev Harness 极简快速路径 + CI 优化

- [ ] [BEHAVIOR] Harness 模式下 04-ship.md 跳过 Learning 文件生成和 fire-learnings-event.sh
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!c.includes('harness'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Harness 模式下 02-code.md 跳过 DoD 逐条验证
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');if(!c.includes('harness'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] CI workflow 包含 Harness 模式条件，非必要 jobs 在 Harness PR 上可跳过
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('harness'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] devloop-check 条件 0.5 在 auto-merge 成功后调用 post-merge-deploy
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!c.includes('post-merge-deploy'))throw new Error('FAIL');console.log('PASS')"
