# DoD: Tier 0 止血 — CI 真有牙 + 闭环回写

- [x] [ARTIFACT] ci.yml real-env-smoke 已删 continue-on-error
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const m=c.match(/real-env-smoke:[\s\S]{0,500}/);if(!m)process.exit(1);if(m[0].includes('continue-on-error'))process.exit(1)"

- [x] [ARTIFACT] harness-v5-checks.yml 4 处 continue-on-error: true 已删（顶部注释里 mention 历史不算）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/harness-v5-checks.yml','utf8');if(c.match(/^\s*continue-on-error:\s*true/m))process.exit(1)"

- [x] [ARTIFACT] callback-brain-task.sh 已新建并 chmod +x
  Test: manual:node -e "const fs=require('fs');const p='packages/engine/skills/dev/scripts/callback-brain-task.sh';fs.accessSync(p);const st=fs.statSync(p);if(!(st.mode&0o111))process.exit(1)"

- [x] [BEHAVIOR] callback-brain-task.sh dry-run 输出含 PATCH URL + payload
  Test: manual:bash packages/engine/skills/dev/scripts/callback-brain-task.sh --dry-run --task-id test-abc --pr 9999 --branch cp-test 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(!s.includes('would PATCH')||!s.includes('test-abc'))process.exit(1)})"

- [x] [BEHAVIOR] callback-brain-task.sh 无 task_id 时静默 skip exit 0
  Test: manual:bash -c "cd /tmp && bash /Users/administrator/perfect21/cecelia/packages/engine/skills/dev/scripts/callback-brain-task.sh 2>&1 | grep -q 'skip'"
