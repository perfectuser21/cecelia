# Contract DoD — Workstream 1: 子进程递归内存采集修复（Round 2）

- [ ] [BEHAVIOR] watchdog 的 sampleProcess 函数体内含递归/循环遍历子进程逻辑（ppid 关联 + while/for 循环 + rss 累加）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/watchdog.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//'));const code=lines.join('\n');const fn=code.match(/function\s+sampleProcess[\s\S]*?\n\}/);if(!fn){console.log('FAIL: 无 sampleProcess');process.exit(1)}const body=fn[0];if(!body.includes('ppid')){console.log('FAIL: 函数体内无 ppid');process.exit(1)}if(!/while|for|recur|queue|stack/.test(body)){console.log('FAIL: 无递归遍历');process.exit(1)}if(!/rss/.test(body)){console.log('FAIL: 无 rss 累加');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] watchdog 单元测试通过且覆盖子进程采集场景（测试名含 sampleProcess/recursive/child）
  Test: npm test -- --testPathPattern=watchdog --reporter=verbose 2>&1 | node -e "const out=require('fs').readFileSync('/dev/stdin','utf8');if(/Tests:.*failed/.test(out)){console.log('FAIL');process.exit(1)}if(!/Tests:.*\d+ passed/.test(out)||/Tests:.*0 passed/.test(out)){console.log('FAIL: 无通过测试');process.exit(1)}if(!/sampleProcess|recursive|child.*rss/i.test(out)){console.log('FAIL: 测试未覆盖子进程采集');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] sampleProcess 对不存在的 PID 返回 null 不抛异常（失败路径）
  Test: npm test -- --testPathPattern=watchdog --testNamePattern="not exist|invalid pid|null|nonexist" --reporter=verbose 2>&1 | node -e "const out=require('fs').readFileSync('/dev/stdin','utf8');if(/Tests:.*failed/.test(out)){console.log('FAIL');process.exit(1)}if(!/Tests:.*\d+ passed/.test(out)||/Tests:.*0 passed/.test(out)){console.log('FAIL: 无 PID 不存在场景测试');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] watchdog.test.js 包含子进程 RSS 累加的测试用例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/watchdog.test.js','utf8');if(!c.includes('child')&&!c.includes('recursive')&&!c.includes('子进程'))process.exit(1);console.log('OK')"
