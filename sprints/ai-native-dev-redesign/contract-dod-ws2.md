# Contract DoD — Workstream 2: CI Harness 优化 + PR 自动 Merge

- [ ] [BEHAVIOR] CI 包含 harness 条件跳过逻辑（排除注释行后可见）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 核心 job（brain-unit/brain-integration/eslint/secrets-scan/e2e-smoke）不被 harness skip 影响
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');const r=['brain-unit','brain-integration','eslint','secrets-scan','e2e-smoke'];for(const j of r){if(new RegExp(j+':[\\\\s\\\\S]{0,500}(harness.*skip|!contains.*harness)','i').test(lines))throw new Error('FAIL: '+j);}console.log('PASS')"
- [ ] [BEHAVIOR] ci-passed job 包含 `if: always()`，防止被跳过的 job 阻塞合并
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/ci-passed:[\s\S]{0,200}if:\s*always\(\)/.test(c))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] auto-merge step 存在且使用 gh pr merge，限定 harness label
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/gh\s+pr\s+merge/.test(lines))throw new Error('FAIL: 无 gh pr merge');if(!/auto.merge[\s\S]{0,500}harness|harness[\s\S]{0,500}auto.merge/.test(lines))throw new Error('FAIL: 未限定 harness');console.log('PASS')"
- [ ] [BEHAVIOR] auto-merge 包含重试机制（至少 1 次重试）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/retry|RETRY|attempt|ATTEMPT|for\s+i\s+in|while.*merge/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] merge 失败时回写 Brain 任务状态（curl PATCH 在 auto-merge failure 路径内）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/auto.merge[\s\S]{0,2000}curl[\s\S]{0,100}(PATCH|patch)[\s\S]{0,200}(brain|tasks)/.test(lines)&&!/auto.merge[\s\S]{0,2000}(fail|error)[\s\S]{0,500}(brain|tasks)/.test(lines))throw new Error('FAIL');console.log('PASS')"
