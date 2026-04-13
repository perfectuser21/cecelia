# Contract DoD — Workstream 2: /dev Harness 极简路径 + CI 优化

- [ ] [BEHAVIOR] 04-ship.md 包含 harness_mode 条件分支，跳过 Learning 文件生成
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!/harness_mode|harness.mode|HARNESS_MODE/.test(c))throw new Error('FAIL: 无检测');if(!/harness[\s\S]{0,300}(skip|跳过)[\s\S]{0,100}(learning|Learning)/i.test(c)&&!/if.*harness[\s\S]{0,200}learning/i.test(c))throw new Error('FAIL: 无跳过分支');console.log('PASS')"
- [ ] [BEHAVIOR] 非 harness 模式 Learning 流程完整保留
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!/docs\/learnings/.test(c))throw new Error('FAIL: Learning 路径被删');if(!/fire-learnings-event/.test(c))throw new Error('FAIL: event 调用被删');console.log('PASS')"
- [ ] [BEHAVIOR] CI 至少 1 个非必要 job 有 harness PR 条件跳过
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/if:[\s\S]{0,100}(harness|contains.*label)/.test(c)&&!/harness[\s\S]{0,50}skip|skip[\s\S]{0,50}harness/.test(c))throw new Error('FAIL');console.log('PASS')"
