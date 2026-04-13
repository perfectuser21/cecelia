# Contract DoD — Workstream 2: CI Harness 优化 + PR 自动 Merge

- [ ] [BEHAVIOR] CI 包含 harness 条件跳过逻辑（排除注释行后可见）
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 核心 job（brain-unit/brain-integration/eslint/secrets-scan/e2e-smoke）不被 harness skip 影响
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');const r=['brain-unit','brain-integration','eslint','secrets-scan','e2e-smoke'];for(const j of r){if(new RegExp(j+':[\\\\s\\\\S]{0,500}(harness.*skip|!contains.*harness)','i').test(lines))throw new Error('FAIL: '+j);}console.log('PASS')"
- [ ] [BEHAVIOR] ci-passed job 包含 `if: always()`，防止被跳过的 job 阻塞合并
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/ci-passed:[\s\S]{0,200}if:\s*always\(\)/.test(c))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] auto-merge step 存在且使用 gh pr merge，限定 harness label
  Test: node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/gh\s+pr\s+merge/.test(lines))throw new Error('FAIL: 无 gh pr merge');if(!/auto.merge[\s\S]{0,500}harness|harness[\s\S]{0,500}auto.merge/.test(lines))throw new Error('FAIL: 未限定 harness');console.log('PASS')"
