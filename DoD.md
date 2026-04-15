contract_branch: cp-harness-contract-ad3cd28b
workstream_index: 1
sprint_dir: sprints/harness-v7-docker-sandbox

## Feature 1: 子进程递归内存采集（FR-001 / US-003）

- [x] [BEHAVIOR] sampleProcess 函数体内包含 ppid 父子进程关联 + 递归/循环遍历子进程逻辑 + rss 累加
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/watchdog.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//'));const code=lines.join('\n');const fn=code.match(/function\s+sampleProcess[\s\S]*?\n\}/);if(!fn){console.log('FAIL: sampleProcess 未找到');process.exit(1);}const body=fn[0];if(!body.includes('ppid')){console.log('FAIL: 无 ppid');process.exit(1);}if(!/while|for|recur|queue|stack/.test(body)){console.log('FAIL: 无循环/递归');process.exit(1);}if(!/rss/.test(body)){console.log('FAIL: 无 rss');process.exit(1);}console.log('PASS');"

- [x] [BEHAVIOR] watchdog 单元测试通过，覆盖子进程递归采集场景（含 sampleProcess/recursive/child rss 命名）
  Test: tests/brain/watchdog.test.js

- [x] [BEHAVIOR] sampleProcess 对不存在的 PID 返回 null 不抛异常
  Test: tests/brain/watchdog.test.js
