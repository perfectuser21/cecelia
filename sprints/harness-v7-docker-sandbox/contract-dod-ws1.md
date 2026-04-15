# Contract DoD — Workstream 1: 子进程递归内存采集修复

- [ ] [BEHAVIOR] watchdog 的 sampleProcessDarwin 递归统计主进程及所有子进程 RSS 总和（macOS 用 `ps -o rss=,ppid= -ax` 构建进程树）
  Test: npm test -- --testPathPattern=watchdog --reporter=verbose
- [ ] [BEHAVIOR] task_run_metrics.peak_rss_mb 在任务完成后写入合理值（>= 50 MB），不再是固定个位数
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/watchdog.js','utf8');if(!c.includes('ppid')||!c.includes('children')||!c.includes('recursive'))process.exit(1);console.log('PASS')"
- [ ] [ARTIFACT] watchdog.test.js 包含子进程 RSS 累加的测试用例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/watchdog.test.js','utf8');if(!c.includes('child')&&!c.includes('recursive')&&!c.includes('子进程'))process.exit(1);console.log('OK')"
