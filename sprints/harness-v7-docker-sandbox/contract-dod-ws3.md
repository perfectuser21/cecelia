# Contract DoD — Workstream 3: 内存调度 + 三池隔离

- [ ] [BEHAVIOR] slot-allocator.js 定义 TOTAL_CONTAINER_MEMORY_MB=12288 和三池（A=2048/B=6144/C=4096）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');if(!/TOTAL_CONTAINER_MEMORY_MB\s*=\s*12288/.test(c))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 任务派发前检查目标池可用内存 >= CONTAINER_SIZES[task_type]，不足时排队
  Test: npm test -- --testPathPattern=slot-allocator --reporter=verbose
- [ ] [BEHAVIOR] 池间隔离：一个池满载不影响其他池的派发
  Test: npm test -- --testPathPattern=slot-allocator --reporter=verbose
- [ ] [ARTIFACT] slot-allocator.test.js 包含三池隔离和内存不足排队的测试用例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/slot-allocator.test.js','utf8');if(!c.includes('pool')&&!c.includes('Pool')&&!c.includes('memory'))process.exit(1);console.log('OK')"
