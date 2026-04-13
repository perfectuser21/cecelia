# Contract DoD — Workstream 3: /dev Skill Harness 极简路径 + 失败回写

- [ ] [BEHAVIOR] 04-ship.md 包含 harness_mode 变量检测 + 跳过 Learning 路径 + 保留非 harness 完整 Learning 流程
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!/harness_mode|harness.mode|HARNESS_MODE/.test(c))throw new Error('FAIL: 无检测');const skip=/harness[\s\S]{0,500}(skip|跳过|不执行|省略|omit)[\s\S]{0,200}(learning|Learning)/i.test(c);const normal=/docs\/learnings/.test(c)&&/fire-learnings-event/.test(c);if(!skip)throw new Error('FAIL: 无跳过指令');if(!normal)throw new Error('FAIL: 非harness路径不完整');console.log('PASS')"
- [ ] [BEHAVIOR] harness 模式明确跳过 fire-learnings-event 调用
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(!/harness[\s\S]{0,500}(skip|跳过|省略|omit)[\s\S]{0,200}fire-learnings-event/i.test(c)&&!/harness[\s\S]{0,500}(skip|跳过|省略|omit)[\s\S]{0,200}(learning|Learning)[\s\S]{0,200}fire-learnings/i.test(c))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] devloop-check.sh（排除注释后）包含 harness 模式检测
  Test: node -e "const lines=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] devloop-check.sh harness 失败回写 Brain（curl PATCH 在 _harness_mode 守卫内，2000 字符窗口）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,200}api\/brain\/tasks/.test(c))throw new Error('FAIL: 无PATCH');const i=c.indexOf('PATCH');const b=c.substring(Math.max(0,i-2000),i);if(!/_harness_mode.*==.*true|harness_mode.*true/.test(b))throw new Error('FAIL: 无守卫');console.log('PASS')"
- [ ] [BEHAVIOR] stop.sh（排除注释后）包含 harness 模式检测
  Test: node -e "const lines=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/harness.*mode|_harness_mode|HARNESS_MODE/.test(lines))throw new Error('FAIL');console.log('PASS')"
