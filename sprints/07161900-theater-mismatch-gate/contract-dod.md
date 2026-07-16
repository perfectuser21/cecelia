# Contract DoD — 建制W6: 戏院错配机械闸 + 元验证补丁

- task_id: b317ae29-9fbc-4d6f-abf0-016141d6c657
- sprint_dir: sprints/07161900-theater-mismatch-gate
- 日期: 2026-07-16

---

## [BEHAVIOR] 条目

- [BEHAVIOR] `theater_mismatch` 闸对 GP 含「微信真机发送」+ local_api 判 FAIL
  Test: manual:node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t1',worktreePath:'/tmp',sprintDir:'x',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. 微信真机发送消息\n';if(p.includes('contract'))return '[BEHAVIOR] cmd\nTest: adb shell send';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(!r.pass&&r.reasons.join().includes('theater_mismatch'))console.log('PASS');else{console.error('FAIL',r);process.exit(1);}}))"

- [BEHAVIOR] `theater_mismatch` 闸对 GP 含 adb + mac_web 判 FAIL
  Test: manual:node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t3',worktreePath:'/tmp',sprintDir:'x3',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. adb shell 真机截图\n';if(p.includes('contract'))return '[BEHAVIOR] adb screenshot';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'mac_web'}]})}}).then(r=>{if(!r.pass&&r.reasons.join().includes('theater_mismatch'))console.log('PASS');else{console.error('FAIL',r);process.exit(1);}}))"

- [BEHAVIOR] `meta_verification_gap` 闸对 smoke 类交付物无 L3 断言判 FAIL
  Test: manual:node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t2',worktreePath:'/tmp',sprintDir:'y',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '# Sprint PRD — smoke 验证脚本演习\n## Golden Path\n1. 验证脚本执行\n';if(p.includes('contract'))return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(!r.pass&&r.reasons.join().includes('meta_verification_gap'))console.log('PASS');else{console.error('FAIL',r);process.exit(1);}}))"

- [BEHAVIOR] `meta_verification_gap` 闸对「演习」类 PRD + contract 含 verification_level: L3 不误判
  Test: manual:node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t5',worktreePath:'/tmp',sprintDir:'y5',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '# Sprint PRD — 验证脚本演习\n## Golden Path\n1. 演习场景\n';if(p.includes('contract'))return '[BEHAVIOR] adb check\nverification_level: L3\nTest: manual:adb check';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(r.pass)console.log('PASS');else{console.error('FAIL',JSON.stringify(r));process.exit(1);}}))"

- [BEHAVIOR] 正常 local_api 服务端合同不被误伤（回归保护）
  Test: manual:node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t3',worktreePath:'/tmp',sprintDir:'z',brainResult:{verdict:'PASS',behavior_tests:[{command:'npm test',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. 调用 API 返回 200\n';if(p.includes('contract'))return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(r.pass)console.log('PASS');else{console.error('FAIL',JSON.stringify(r));process.exit(1);}}))"

- [BEHAVIOR] `THEATER_KEYWORDS_EXTRA` env 可扩展：追加「海外渠道」关键词后触发 theater_mismatch
  Test: manual:THEATER_KEYWORDS_EXTRA=海外渠道 node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t7',worktreePath:'/tmp',sprintDir:'z7',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. 海外渠道投放消息\n';if(p.includes('contract'))return '[BEHAVIOR] push msg';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(!r.pass&&r.reasons.join().includes('theater_mismatch'))console.log('PASS');else{console.error('FAIL',r);process.exit(1);}}))"

---

## DoD 检查清单

- [x] `THEATER_REAL_MACHINE_KEYWORDS` 常量已添加到 `harness-judge.js`，默认含 8 个关键词
- [x] `THEATER_KEYWORDS_EXTRA` env 扩展支持（逗号分隔）已实现
- [x] `runMechanicalGate` 新增戏院错配闸（FR-02），读取 sprint-prd GP 段 + contract BEHAVIOR 文本
- [x] `runMechanicalGate` 新增元验证补丁（FR-03），检测 smoke/验证脚本/演习类标题
- [x] 两闸均不调 AI，耗时 < 5ms
- [x] 关键词匹配大小写不敏感
- [x] `packages/brain/src/__tests__/harness-judge-theater.test.js` failing test 先提交（TDD）
- [x] 所有 [BEHAVIOR] 验收命令通过（`PASS` 输出）
- [x] brain-ci.yml 回归中 `harness-judge-theater.test.js` 会自动被扫描
- [x] `THEATER_REAL_MACHINE_KEYWORDS` 常量若作为新导出需登记 smoke-allowlist.txt

---

## 验收环境

- target_environment: local_api
- 执行机: 本地 / CI runner（不依赖真机）
- 测试框架: vitest（ESM）
