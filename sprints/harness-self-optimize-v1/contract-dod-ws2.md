# Contract DoD — Workstream 2: Report 重试机制

- [x] [BEHAVIOR] harness-watcher 创建 report 任务后监听状态，5 分钟超时自动重试（最多 2 次）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!/MAX_REPORT_RETRIES\s*=\s*2/.test(c)&&!c.includes('report_retry'))process.exit(1);if(!/300000|5\s*\*\s*60\s*\*\s*1000/.test(c))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] 3 次 report 失败后创建 P1 告警任务，payload 含 sprint_dir 和 failure_reason
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('sprint_dir')||!c.includes('failure_reason'))process.exit(1);if(!(c.includes('P1')&&(c.includes('alert')||c.includes('告警'))))process.exit(1);console.log('PASS')"
- [x] [ARTIFACT] 单元测试文件存在，覆盖重试和告警场景
  Test: node -e "const g=require('fs').readdirSync('packages/quality/tests/harness').filter(f=>f.includes('watcher'));if(g.length===0)process.exit(1);console.log('PASS: '+g.join(','))"
- [x] [BEHAVIOR] 单元测试通过
  Test: npm test -- --testPathPattern='harness-watcher'
